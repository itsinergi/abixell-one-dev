#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  commandName,
  extractDocumentArchive,
  loadBackupSet,
  validateDocumentArchive,
  validateDocumentTree,
} from "./lib/backup-safety.mjs";
import { withPostgresConnection } from "./lib/postgres-connection.mjs";

for (const name of [
  "RESTORE_BACKUP_DIR",
  "RESTORE_DATABASE_URL",
  "RESTORE_FILE_STORAGE_ROOT",
]) {
  if (!process.env[name]) {
    fail(`Missing required environment variable: ${name}`);
  }
}
if (process.env.RESTORE_CONFIRM !== "RESTORE") {
  fail(
    "Set RESTORE_CONFIRM=RESTORE to acknowledge this destructive operation",
  );
}

const backupSet = await loadBackupSet(
  process.env.RESTORE_BACKUP_DIR,
).catch((error) => fail(error.message));
const {
  manifest,
  databaseArchive,
  documentsArchive,
} = backupSet;
const targetDatabaseUrl = process.env.RESTORE_DATABASE_URL;
const documentRoot = resolve(
  process.env.RESTORE_FILE_STORAGE_ROOT,
);
const stagingRoot = `${documentRoot}.restore-staging`;
const priorRoot = `${documentRoot}.pre-restore`;

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
await prepareDocumentStaging();
await ensureEmptyDatabase(targetDatabaseUrl);

try {
  await runDatabase(
    "pg_restore",
    targetDatabaseUrl,
    [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      databaseArchive,
    ],
  );
  const restoredHead = await queryScalar(
    targetDatabaseUrl,
    "SELECT COALESCE(max(name), '') FROM pgmigrations",
  );
  if (restoredHead !== manifest.database.migrationHead) {
    throw new Error(
      `Migration head mismatch: expected ${manifest.database.migrationHead}, got ${restoredHead}`,
    );
  }

  await rm(priorRoot, { recursive: true, force: true });
  try {
    await rename(documentRoot, priorRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    await mkdir(dirname(documentRoot), {
      recursive: true,
    });
    const extractedRoot =
      manifest.formatVersion === 1
        ? await resolveLegacyDocumentRoot(stagingRoot)
        : stagingRoot;
    await rename(extractedRoot, documentRoot);
  } catch (error) {
    try {
      await rename(priorRoot, documentRoot);
    } catch {}
    throw error;
  } finally {
    await rm(stagingRoot, {
      recursive: true,
      force: true,
    });
  }

  process.stdout.write(
    `Restore completed for backup ${manifest.backupId}. Prior documents retained at ${priorRoot}.\n`,
  );
} catch (error) {
  await rm(stagingRoot, { recursive: true, force: true });
  fail(error instanceof Error ? error.message : "Restore failed");
}

async function prepareDocumentStaging() {
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, {
    recursive: true,
    mode: 0o700,
  });
  try {
    await extractDocumentArchive(
      documentsArchive,
      stagingRoot,
    );
    const extractedRoot =
      manifest.formatVersion === 1
        ? await resolveLegacyDocumentRoot(stagingRoot)
        : stagingRoot;
    await access(extractedRoot);
    const fileCount = await validateDocumentTree(
      extractedRoot,
    );
    if (fileCount !== manifest.documents.fileCount) {
      throw new Error(
        `Extracted document file count mismatch: expected ${manifest.documents.fileCount}, got ${fileCount}`,
      );
    }
  } catch (error) {
    await rm(stagingRoot, {
      recursive: true,
      force: true,
    });
    throw error;
  }
}

async function resolveLegacyDocumentRoot(root) {
  const entries = await readdir(root, {
    withFileTypes: true,
  });
  const directories = entries.filter(
    (entry) => entry.isDirectory(),
  );
  if (entries.length !== 1 || directories.length !== 1) {
    throw new Error(
      "Format-1 document archive must contain exactly one top-level directory",
    );
  }
  return join(root, directories[0].name);
}

async function ensureEmptyDatabase(url) {
  const objectCount = Number(
    await queryScalar(
      url,
      `SELECT
         (SELECT count(*)
            FROM pg_namespace
           WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public')
             AND nspname !~ '^pg_toast')
         +
         (SELECT count(*)
            FROM pg_class object
            JOIN pg_namespace namespace ON namespace.oid = object.relnamespace
           WHERE namespace.nspname = 'public')
         +
         (SELECT count(*)
            FROM pg_proc object
            JOIN pg_namespace namespace ON namespace.oid = object.pronamespace
           WHERE namespace.nspname = 'public')
         +
         (SELECT count(*)
            FROM pg_type object
            JOIN pg_namespace namespace ON namespace.oid = object.typnamespace
           WHERE namespace.nspname = 'public'
             AND object.typtype IN ('d', 'e', 'm', 'r'))
         +
         (SELECT count(*)
            FROM pg_extension
           WHERE extname <> 'plpgsql')
         +
         (SELECT count(*)
            FROM pg_database
           WHERE datname = current_database()
             AND datacl IS NOT NULL)
         +
         (SELECT count(*) FROM pg_publication)
         +
         (SELECT count(*) FROM pg_subscription)
         +
         (SELECT count(*) FROM pg_event_trigger)
         +
         (SELECT count(*) FROM pg_foreign_data_wrapper)
         +
         (SELECT count(*) FROM pg_foreign_server)
         +
         (SELECT count(*) FROM pg_default_acl)`,
    ),
  );
  if (objectCount !== 0) {
    fail(
      "Target database is not pristine; restore only into a fresh database with no user schemas, objects, or database ACL changes",
    );
  }
}

async function verifyFile(path, expected) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  const actual = hash.digest("hex");
  if (actual !== expected) {
    fail(`Checksum mismatch for ${path}`);
  }
}

async function queryScalar(url, sql) {
  return (
    await runDatabase(
      "psql",
      url,
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

async function runDatabase(
  command,
  url,
  args,
  capture = false,
) {
  return withPostgresConnection(
    url,
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
