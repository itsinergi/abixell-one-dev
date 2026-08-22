#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import {
  commandName,
  validateDocumentArchive,
  validateDocumentTree,
} from "./lib/backup-safety.mjs";
import { withPostgresConnection } from "./lib/postgres-connection.mjs";

const required = [
  "DATABASE_URL",
  "BACKUP_ROOT",
  "FILE_STORAGE_ROOT",
  "DEPLOYMENT_ENVIRONMENT",
  "APPLICATION_RELEASE",
  "BACKUP_API_IMAGE",
  "BACKUP_OPERATIONS_IMAGE",
  "BACKUP_WEB_IMAGE",
];
for (const name of required) {
  if (!process.env[name]) fail(`Missing required environment variable: ${name}`);
}
if (!["staging", "production"].includes(process.env.DEPLOYMENT_ENVIRONMENT)) {
  fail("DEPLOYMENT_ENVIRONMENT must be staging or production");
}
for (const name of [
  "BACKUP_API_IMAGE",
  "BACKUP_OPERATIONS_IMAGE",
  "BACKUP_WEB_IMAGE",
]) {
  if (!/@sha256:[a-f0-9]{64}$/.test(process.env[name])) {
    fail(`${name} must use an immutable sha256 digest`);
  }
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

if (!/^[A-Za-z0-9._-]+$/.test(backupId)) {
  fail("BACKUP_ID may contain only letters, numbers, dot, underscore, and hyphen");
}
await mkdir(backupRoot, { recursive: true, mode: 0o700 });
await assertPathAbsent(finalDir, "Final backup path already exists");
await createExclusiveDirectory(partialDir);

try {
  await access(documentRoot);
  const documentFiles = await validateDocumentTree(
    documentRoot,
  );
  await runDatabase("pg_dump", databaseUrl, [
    "--format=custom",
    "--compress=zstd:6",
    "--no-owner",
    "--no-privileges",
    "--file",
    databaseArchive,
  ]);
  await run("pg_restore", ["--list", databaseArchive]);

  await createDocumentsArchive(documentRoot, documentsArchive);
  await validateDocumentArchive(documentsArchive);
  const databaseSha256 = await sha256(databaseArchive);
  const documentsSha256 = await sha256(documentsArchive);
  const migrationHead = await queryScalar(
    databaseUrl,
    "SELECT COALESCE(max(name), '') FROM pgmigrations",
  );
  const databaseVersion = await queryScalar(databaseUrl, "SHOW server_version");
  const manifest = {
    formatVersion: 2,
    backupId,
    createdAt: new Date().toISOString(),
    sourceEnvironment: process.env.DEPLOYMENT_ENVIRONMENT,
    applicationRelease: process.env.APPLICATION_RELEASE,
    images: {
      api: process.env.BACKUP_API_IMAGE,
      operations: process.env.BACKUP_OPERATIONS_IMAGE,
      web: process.env.BACKUP_WEB_IMAGE,
    },
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
      archiveRoot: ".",
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(partialDir, finalDir);
  process.stdout.write(`Backup completed: ${finalDir}\n`);
} catch (error) {
  await rm(partialDir, { recursive: true, force: true });
  fail(error instanceof Error ? error.message : "Backup failed");
}

async function createDocumentsArchive(root, archivePath) {
  const tar = spawn(commandName("tar"), ["-cf", "-", "-C", root, "."], {
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });
  const completion = exitCode(tar).then((code) => {
    if (code !== 0) throw new Error(`tar exited with code ${code}`);
  });
  await Promise.all([
    pipeline(
      tar.stdout,
      createGzip({ level: 6 }),
      createWriteStream(archivePath, { mode: 0o600 }),
    ),
    completion,
  ]);
}

async function queryScalar(url, sql) {
  const result = await runDatabase(
    "psql",
    url,
    ["--no-psqlrc", "--tuples-only", "--no-align", "--command", sql],
    true,
  );
  return result.trim();
}

async function runDatabase(command, url, args, capture = false) {
  return withPostgresConnection(
    url,
    ({ databaseArgument, environment }) => {
      const commandArgs =
        command === "pg_dump"
          ? ["--dbname", databaseArgument, ...args]
          : [...args, "--dbname", databaseArgument];
      return run(
        command,
        commandArgs,
        capture,
        environment,
      );
    },
  );
}

async function run(command, args, capture = false, extraEnv = {}) {
  const child = spawn(commandName(command), args, {
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    windowsHide: true,
    env: { ...process.env, ...extraEnv },
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

async function sha256(path) {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function assertPathAbsent(path, message) {
  try {
    await stat(path);
    fail(message);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function createExclusiveDirectory(path) {
  try {
    await mkdir(path, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail(`Backup ${basename(path, ".partial")} is already active or has a partial set`);
    }
    throw error;
  }
}

function utcBackupId(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\./g, "-");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
