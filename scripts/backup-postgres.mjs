#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";

const required = ["DATABASE_URL", "BACKUP_ROOT", "FILE_STORAGE_ROOT"];
for (const name of required) {
  if (!process.env[name]) fail(`Missing required environment variable: ${name}`);
}

const databaseUrl = process.env.DATABASE_URL;
const backupRoot = resolve(process.env.BACKUP_ROOT);
const documentRoot = resolve(process.env.FILE_STORAGE_ROOT);
const backupId = process.env.BACKUP_ID || utcBackupId(new Date());
const partialDir = join(backupRoot, `${backupId}.partial`);
const finalDir = join(backupRoot, backupId);
const databaseArchive = join(partialDir, "database.dump");
const documentsArchive = join(partialDir, "documents.tar.gz");
const manifestPath = join(partialDir, "manifest.json");

if (!/^[A-Za-z0-9._-]+$/.test(backupId)) fail("BACKUP_ID may contain only letters, numbers, dot, underscore, and hyphen");
await assertPathAbsent(finalDir, "Final backup path already exists");
await rm(partialDir, { recursive: true, force: true });
await mkdir(partialDir, { recursive: true, mode: 0o700 });

try {
  await access(documentRoot);
  await run("pg_dump", [
    "--dbname", databaseUrl,
    "--format=custom",
    "--compress=zstd:6",
    "--no-owner",
    "--no-privileges",
    "--file", databaseArchive,
  ]);
  await run("pg_restore", ["--list", databaseArchive]);

  await createDocumentsArchive(documentRoot, documentsArchive);
  const databaseSha256 = await sha256(databaseArchive);
  const documentsSha256 = await sha256(documentsArchive);
  const migrationHead = await queryScalar(databaseUrl, "SELECT COALESCE(max(name), '') FROM pgmigrations");
  const databaseVersion = await queryScalar(databaseUrl, "SHOW server_version");
  const documentFiles = await countFiles(documentRoot);
  const manifest = {
    formatVersion: 1,
    backupId,
    createdAt: new Date().toISOString(),
    sourceEnvironment: process.env.DEPLOYMENT_ENVIRONMENT ?? "unspecified",
    applicationRelease: process.env.APPLICATION_RELEASE ?? "unrecorded",
    database: {
      archive: basename(databaseArchive),
      sha256: databaseSha256,
      serverVersion: databaseVersion,
      migrationHead,
    },
    documents: {
      archive: basename(documentsArchive),
      sha256: documentsSha256,
      fileCount: documentFiles,
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(partialDir, finalDir);
  process.stdout.write(`Backup completed: ${finalDir}\n`);
} catch (error) {
  await rm(partialDir, { recursive: true, force: true });
  fail(error instanceof Error ? error.message : "Backup failed");
}

async function createDocumentsArchive(root, archivePath) {
  const parent = dirname(root);
  const folder = basename(root);
  const tar = spawn(commandName("tar"), ["-cf", "-", "-C", parent, folder], {
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });
  const completion = exitCode(tar).then((code) => {
    if (code !== 0) throw new Error(`tar exited with code ${code}`);
  });
  await Promise.all([
    pipeline(tar.stdout, createGzip({ level: 6 }), createWriteStream(archivePath, { mode: 0o600 })),
    completion,
  ]);
}

async function queryScalar(url, sql) {
  const result = await run("psql", ["--dbname", url, "--no-psqlrc", "--tuples-only", "--no-align", "--command", sql], true);
  return result.trim();
}

async function run(command, args, capture = false) {
  const child = spawn(commandName(command), args, {
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    windowsHide: true,
  });
  let output = "";
  if (capture) child.stdout.on("data", (chunk) => { output += chunk; });
  const code = await exitCode(child);
  if (code !== 0) throw new Error(`${command} exited with code ${code}`);
  return output;
}

function exitCode(child) {
  return new Promise((resolveCode, reject) => {
    child.once("error", reject);
    child.once("close", resolveCode);
  });
}

function commandName(command) {
  return process.platform === "win32" ? `${command}.exe` : command;
}

async function sha256(path) {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function countFiles(root) {
  let count = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) count += await countFiles(join(root, entry.name));
    else if (entry.isFile()) count += 1;
  }
  return count;
}

async function assertPathAbsent(path, message) {
  try {
    await stat(path);
    fail(message);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function utcBackupId(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
