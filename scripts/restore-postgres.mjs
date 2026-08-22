#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

for (const name of ["RESTORE_BACKUP_DIR", "RESTORE_DATABASE_URL", "RESTORE_FILE_STORAGE_ROOT"]) {
  if (!process.env[name]) fail(`Missing required environment variable: ${name}`);
}
if (process.env.RESTORE_CONFIRM !== "RESTORE") {
  fail("Set RESTORE_CONFIRM=RESTORE to acknowledge this destructive operation");
}

const backupDir = resolve(process.env.RESTORE_BACKUP_DIR);
const targetDatabaseUrl = process.env.RESTORE_DATABASE_URL;
const documentRoot = resolve(process.env.RESTORE_FILE_STORAGE_ROOT);
const databaseArchive = join(backupDir, "database.dump");
const documentsArchive = join(backupDir, "documents.tar.gz");
const manifest = JSON.parse(await readFile(join(backupDir, "manifest.json"), "utf8"));
const stagingRoot = `${documentRoot}.restore-staging`;
const priorRoot = `${documentRoot}.pre-restore`;

await verifyFile(databaseArchive, manifest.database.sha256);
await verifyFile(documentsArchive, manifest.documents.sha256);
await run("pg_restore", ["--list", databaseArchive]);
await ensureEmptyDatabase(targetDatabaseUrl);

try {
  await run("pg_restore", [
    "--dbname", targetDatabaseUrl,
    "--exit-on-error",
    "--no-owner",
    "--no-privileges",
    databaseArchive,
  ]);
  const restoredHead = await queryScalar(targetDatabaseUrl, "SELECT COALESCE(max(name), '') FROM pgmigrations");
  if (restoredHead !== manifest.database.migrationHead) {
    throw new Error(`Migration head mismatch: expected ${manifest.database.migrationHead}, got ${restoredHead}`);
  }

  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  await run("tar", ["-xzf", documentsArchive, "-C", stagingRoot]);
  const extractedRoot = join(stagingRoot, basename(documentRoot));
  await access(extractedRoot);

  await rm(priorRoot, { recursive: true, force: true });
  try {
    await rename(documentRoot, priorRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    await mkdir(dirname(documentRoot), { recursive: true });
    await rename(extractedRoot, documentRoot);
  } catch (error) {
    try { await rename(priorRoot, documentRoot); } catch {}
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }

  process.stdout.write(
    `Restore completed for backup ${manifest.backupId}. Prior documents retained at ${priorRoot}.\n`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : "Restore failed");
}

async function ensureEmptyDatabase(url) {
  const count = Number(await queryScalar(url, "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"));
  if (count !== 0) fail("Target database is not empty; restore only into a fresh database");
}

async function verifyFile(path, expected) {
  await access(path);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const actual = hash.digest("hex");
  if (actual !== expected) fail(`Checksum mismatch for ${basename(path)}`);
}

async function queryScalar(url, sql) {
  return (await run("psql", ["--dbname", url, "--no-psqlrc", "--tuples-only", "--no-align", "--command", sql], true)).trim();
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
