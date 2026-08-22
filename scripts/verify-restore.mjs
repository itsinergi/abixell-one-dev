#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

for (const name of ["RESTORE_BACKUP_DIR", "RESTORE_DATABASE_URL", "RESTORE_FILE_STORAGE_ROOT"]) {
  if (!process.env[name]) fail(`Missing required environment variable: ${name}`);
}

const backupDir = resolve(process.env.RESTORE_BACKUP_DIR);
const databaseUrl = process.env.RESTORE_DATABASE_URL;
const documentRoot = resolve(process.env.RESTORE_FILE_STORAGE_ROOT);
const manifest = JSON.parse(await readFile(join(backupDir, "manifest.json"), "utf8"));
const archivePath = join(backupDir, manifest.database.archive);
const documentsArchive = join(backupDir, manifest.documents.archive);

await verifyFile(archivePath, manifest.database.sha256);
await verifyFile(documentsArchive, manifest.documents.sha256);
await run("pg_restore", ["--list", archivePath]);

const databaseHead = await queryScalar("SELECT COALESCE(max(name), '') FROM pgmigrations");
if (databaseHead !== manifest.database.migrationHead) {
  fail(`Migration head mismatch: expected ${manifest.database.migrationHead}, got ${databaseHead}`);
}
const tenantCount = Number(await queryScalar("SELECT count(*) FROM tenants"));
const documentRows = Number(await queryScalar("SELECT count(*) FROM documents WHERE deleted_at IS NULL"));
const missingDocuments = Number(
  await queryScalar(`SELECT count(*) FROM documents WHERE deleted_at IS NULL AND storage_path IS NULL`),
);
if (missingDocuments !== 0) fail("Restored database contains active document rows without storage paths");
await access(documentRoot);
const representativeDocument = await queryRow(
  `SELECT storage_path, checksum
     FROM documents
    WHERE deleted_at IS NULL
    ORDER BY created_at
    LIMIT 1`,
);
if (representativeDocument) {
  const storagePath = representativeDocument.storage_path;
  if (!storagePath || isAbsolute(storagePath)) {
    fail("Representative document has an invalid absolute or empty storage path");
  }
  const documentPath = resolve(documentRoot, storagePath);
  const relativePath = relative(documentRoot, documentPath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    fail("Representative document storage path escapes the restored document root");
  }
  const restoredChecksum = await sha256(documentPath);
  if (restoredChecksum !== representativeDocument.checksum) {
    fail("Representative restored document checksum does not match database metadata");
  }
}

if (process.env.RESTORE_HEALTH_URL) {
  const response = await fetch(process.env.RESTORE_HEALTH_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) fail(`Health verification failed with HTTP ${response.status}`);
}
if (process.env.RESTORE_DB_HEALTH_URL) {
  const response = await fetch(process.env.RESTORE_DB_HEALTH_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) fail(`Database health verification failed with HTTP ${response.status}`);
}

process.stdout.write(
  `Restore verification PASS: backup=${manifest.backupId}, tenants=${tenantCount}, activeDocumentRows=${documentRows}, migration=${databaseHead}\n`,
);

async function verifyFile(path, expected) {
  if ((await sha256(path)) !== expected) fail(`Checksum mismatch for ${basename(path)}`);
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function queryScalar(sql) {
  return (await run("psql", ["--dbname", databaseUrl, "--no-psqlrc", "--tuples-only", "--no-align", "--command", sql], true)).trim();
}

async function queryRow(sql) {
  const output = await run(
    "psql",
    [
      "--dbname",
      databaseUrl,
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
  const line = output.trim();
  if (!line) return null;
  const [storagePath, checksum] = line.split("\t");
  return { storage_path: storagePath, checksum };
}

async function run(command, args, capture = false) {
  const child = spawn(commandName(command), args, {
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    windowsHide: true,
  });
  let output = "";
  if (capture) child.stdout.on("data", (chunk) => { output += chunk; });
  const code = await new Promise((resolveCode, reject) => {
    child.once("error", reject);
    child.once("close", resolveCode);
  });
  if (code !== 0) throw new Error(`${command} exited with code ${code}`);
  return output;
}

function commandName(command) {
  return process.platform === "win32" ? `${command}.exe` : command;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
