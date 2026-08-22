#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { spawn } from "node:child_process";
import {
  commandName,
  loadBackupSet,
  validateDocumentArchive,
  validateDocumentTree,
} from "./lib/backup-safety.mjs";
import { withPostgresConnection } from "./lib/postgres-connection.mjs";

for (const name of [
  "RESTORE_BACKUP_DIR",
  "RESTORE_DATABASE_URL",
  "RESTORE_FILE_STORAGE_ROOT",
  "RESTORE_HEALTH_URL",
  "RESTORE_DB_HEALTH_URL",
]) {
  if (!process.env[name]) {
    fail(`Missing required environment variable: ${name}`);
  }
}

const backupSet = await loadBackupSet(
  process.env.RESTORE_BACKUP_DIR,
).catch((error) => fail(error.message));
const {
  manifest,
  databaseArchive,
  documentsArchive,
} = backupSet;
const databaseUrl = process.env.RESTORE_DATABASE_URL;
const documentRoot = resolve(
  process.env.RESTORE_FILE_STORAGE_ROOT,
);

await verifyFile(
  databaseArchive,
  manifest.database.sha256,
);
await verifyFile(
  documentsArchive,
  manifest.documents.sha256,
);
await run("pg_restore", ["--list", databaseArchive]);
await validateDocumentArchive(documentsArchive).catch(
  (error) => fail(error.message),
);

const databaseHead = await queryScalar(
  "SELECT COALESCE(max(name), '') FROM pgmigrations",
);
if (databaseHead !== manifest.database.migrationHead) {
  fail(
    `Migration head mismatch: expected ${manifest.database.migrationHead}, got ${databaseHead}`,
  );
}
const tenantCount = Number(
  await queryScalar("SELECT count(*) FROM tenants"),
);
const activeDocuments = await queryRows(
  `SELECT storage_path, checksum
     FROM documents
    WHERE deleted_at IS NULL
    ORDER BY created_at`,
);
const canonicalDocumentRoot = await realpath(
  documentRoot,
).catch(() =>
  fail("Restored document root is missing"),
);
const restoredFileCount = await validateDocumentTree(
  canonicalDocumentRoot,
).catch((error) => fail(error.message));

for (const document of activeDocuments) {
  const storagePath = document.storage_path;
  if (
    !storagePath ||
    storagePath.includes("\\") ||
    isAbsolute(storagePath)
  ) {
    fail(
      "Active document has an invalid absolute, empty, or non-portable storage path",
    );
  }
  const documentPath = resolve(
    canonicalDocumentRoot,
    storagePath,
  );
  assertContained(canonicalDocumentRoot, documentPath);
  const info = await lstat(documentPath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) {
    fail(
      `Active document is missing or is not a regular file: ${storagePath}`,
    );
  }
  const canonicalPath = await realpath(documentPath);
  assertContained(canonicalDocumentRoot, canonicalPath);
  const restoredChecksum = await sha256(canonicalPath);
  if (restoredChecksum !== document.checksum) {
    fail(
      `Active document checksum does not match database metadata: ${storagePath}`,
    );
  }
}

if (restoredFileCount !== manifest.documents.fileCount) {
  fail(
    `Restored document file count mismatch: expected ${manifest.documents.fileCount}, got ${restoredFileCount}`,
  );
}

await verifyHealth(
  process.env.RESTORE_HEALTH_URL,
  "Health",
  (payload) =>
    payload.status === "ok" &&
    payload.service === "abixell-one-api" &&
    payload.release === manifest.applicationRelease,
);
await verifyHealth(
  process.env.RESTORE_DB_HEALTH_URL,
  "Database health",
  (payload) =>
    payload.status === "ok" &&
    payload.database === "connected",
);

process.stdout.write(
  `Restore verification PASS: backup=${manifest.backupId}, release=${manifest.applicationRelease}, tenants=${tenantCount}, activeDocumentRows=${activeDocuments.length}, restoredFiles=${restoredFileCount}, migration=${databaseHead}\n`,
);

async function verifyFile(path, expected) {
  if ((await sha256(path)) !== expected) {
    fail(`Checksum mismatch for ${path}`);
  }
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function assertContained(root, candidate) {
  const nested = relative(root, candidate);
  if (
    nested === ".." ||
    nested.startsWith(`..${sep}`) ||
    isAbsolute(nested)
  ) {
    fail(
      "Active document storage path escapes the restored document root",
    );
  }
}

async function verifyHealth(url, label, validate) {
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  } catch (error) {
    fail(`${label} verification request failed: ${error.message}`);
  }
  if (!response.ok) {
    fail(
      `${label} verification failed with HTTP ${response.status}`,
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    fail(`${label} verification returned invalid JSON`);
  }
  if (!validate(payload)) {
    fail(`${label} verification payload is invalid`);
  }
}

async function queryScalar(sql) {
  return (
    await runDatabase(
      "psql",
      [
        "--no-psqlrc",
        "--tuples-only",
        "--no-align",
        "--command",
        sql,
      ],
      true,
    )
  ).trim();
}

async function queryRows(sql) {
  const output = await runDatabase(
    "psql",
    [
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--field-separator",
      "\t",
      "--command",
      sql,
    ],
    true,
  );
  return output
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const [storagePath, checksum] = line.split("\t");
      return { storage_path: storagePath, checksum };
    });
}

async function runDatabase(
  command,
  args,
  capture = false,
) {
  return withPostgresConnection(
    databaseUrl,
    ({ databaseArgument, environment }) =>
      run(
        command,
        ["--dbname", databaseArgument, ...args],
        capture,
        environment,
      ),
  );
}

async function run(
  command,
  args,
  capture = false,
  extraEnv = {},
) {
  const child = spawn(commandName(command), args, {
    stdio: capture
      ? ["ignore", "pipe", "inherit"]
      : "inherit",
    windowsHide: true,
    env: { ...process.env, ...extraEnv },
  });
  let output = "";
  if (capture) {
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
  }
  const code = await new Promise((resolveCode, reject) => {
    child.once("error", reject);
    child.once("close", resolveCode);
  });
  if (code !== 0) {
    throw new Error(`${command} exited with code ${code}`);
  }
  return output;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
