import { realpath, lstat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const ARCHIVE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export async function loadBackupSet(inputDirectory) {
  const requestedRoot = resolve(inputDirectory);
  const rootInfo = await lstat(requestedRoot).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Backup set path must be a real directory");
  }
  const root = await realpath(requestedRoot);
  const manifestPath = await resolveRegularFile(
    root,
    "manifest.json",
    "manifest",
    true,
  );
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error("Backup manifest is not valid JSON");
  }
  validateManifest(manifest);

  const databaseArchive = await resolveRegularFile(
    root,
    manifest.database.archive,
    "database archive",
  );
  const documentsArchive = await resolveRegularFile(
    root,
    manifest.documents.archive,
    "document archive",
  );
  if (databaseArchive === documentsArchive) {
    throw new Error(
      "Database and document archives must be distinct files",
    );
  }
  return {
    root,
    manifest,
    manifestPath,
    databaseArchive,
    documentsArchive,
  };
}

export async function validateDocumentArchive(archivePath) {
  const namesOutput = await runTar([
    "--list",
    "--gzip",
    "--file",
    archivePath,
    "--quoting-style=escape",
  ]);
  const verboseOutput = await runTar([
    "--list",
    "--verbose",
    "--numeric-owner",
    "--gzip",
    "--file",
    archivePath,
    "--quoting-style=escape",
  ]);
  const names = outputLines(namesOutput);
  const verbose = outputLines(verboseOutput);
  if (names.length === 0 || names.length !== verbose.length) {
    throw new Error(
      "Document archive listing is empty or internally inconsistent",
    );
  }

  const seen = new Set();
  for (let index = 0; index < names.length; index += 1) {
    const type = verbose[index][0];
    if (type !== "-" && type !== "d") {
      throw new Error(
        `Document archive contains unsupported entry type '${type}'`,
      );
    }
    const canonical = validateArchivePath(names[index]);
    if (seen.has(canonical)) {
      throw new Error(
        `Document archive contains a duplicate path: ${canonical}`,
      );
    }
    seen.add(canonical);
  }
}

export async function validateDocumentTree(root) {
  const rootInfo = await lstat(root).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error(
      "Document root must be a real directory, not a symbolic link",
    );
  }
  const canonicalRoot = await realpath(root);
  return walkDocumentTree(canonicalRoot, canonicalRoot);
}

export async function extractDocumentArchive(
  archivePath,
  targetDirectory,
) {
  await runTar(
    [
      "--extract",
      "--gzip",
      "--file",
      archivePath,
      "--directory",
      targetDirectory,
      "--no-same-owner",
      "--no-same-permissions",
      "--delay-directory-restore",
    ],
    false,
  );
}

export function commandName(command) {
  return process.platform === "win32"
    ? `${command}.exe`
    : command;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Backup manifest must be an object");
  }
  if (![1, 2].includes(manifest.formatVersion)) {
    throw new Error(
      `Unsupported backup manifest format: ${manifest.formatVersion}`,
    );
  }
  if (
    typeof manifest.backupId !== "string" ||
    !ARCHIVE_NAME.test(manifest.backupId)
  ) {
    throw new Error("Backup manifest has an invalid backupId");
  }
  if (
    typeof manifest.applicationRelease !== "string" ||
    !manifest.applicationRelease
  ) {
    throw new Error(
      "Backup manifest has no application release identity",
    );
  }
  if (manifest.images !== undefined) {
    for (const name of ["api", "operations", "web"]) {
      if (
        typeof manifest.images?.[name] !== "string" ||
        !/@sha256:[a-f0-9]{64}$/.test(
          manifest.images[name],
        )
      ) {
        throw new Error(
          `Backup manifest has an invalid ${name} image identity`,
        );
      }
    }
  }
  validateArchiveName(
    manifest.database?.archive,
    "database archive",
  );
  validateArchiveName(
    manifest.documents?.archive,
    "document archive",
  );
  if (
    manifest.database.archive === manifest.documents.archive
  ) {
    throw new Error(
      "Database and document archive names must be distinct",
    );
  }
  if (!SHA256.test(manifest.database?.sha256 ?? "")) {
    throw new Error("Database archive checksum is invalid");
  }
  if (!SHA256.test(manifest.documents?.sha256 ?? "")) {
    throw new Error("Document archive checksum is invalid");
  }
  if (
    typeof manifest.database?.migrationHead !== "string"
  ) {
    throw new Error("Database migration head is invalid");
  }
  if (
    !Number.isSafeInteger(manifest.documents?.fileCount) ||
    manifest.documents.fileCount < 0
  ) {
    throw new Error("Document file count is invalid");
  }
}

function validateArchiveName(entry, label) {
  if (
    typeof entry !== "string" ||
    !ARCHIVE_NAME.test(entry) ||
    entry.toLowerCase() === "manifest.json"
  ) {
    throw new Error(
      `Manifest ${label} must use a portable, non-reserved filename`,
    );
  }
}

async function resolveRegularFile(
  root,
  entry,
  label,
  allowManifest = false,
) {
  if (!allowManifest) {
    validateArchiveName(entry, label);
  }
  const candidate = join(root, entry);
  const info = await lstat(candidate).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) {
    throw new Error(`Manifest ${label} must be a regular file`);
  }
  const canonical = await realpath(candidate);
  assertContained(root, canonical, `Manifest ${label} escapes the backup set`);
  return canonical;
}

function validateArchivePath(entry) {
  if (
    !entry ||
    entry.includes("\\") ||
    /[\0\r\n]/.test(entry) ||
    isAbsolute(entry) ||
    entry.startsWith("/") ||
    /^[A-Za-z]:/.test(entry)
  ) {
    throw new Error(
      "Document archive contains a non-portable or absolute path",
    );
  }
  let canonical = entry;
  while (canonical.startsWith("./")) {
    canonical = canonical.slice(2);
  }
  canonical = canonical.replace(/\/+$/, "");
  if (!canonical) canonical = ".";
  if (
    canonical !== "." &&
    canonical.split("/").some(
      (segment) => !segment || segment === "." || segment === "..",
    )
  ) {
    throw new Error(
      "Document archive contains a traversal or ambiguous path",
    );
  }
  return canonical;
}

async function walkDocumentTree(root, directory) {
  let count = 0;
  const entries = await readdir(directory);
  for (const name of entries) {
    const path = join(directory, name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      throw new Error(
        "Restored document tree contains a symbolic link",
      );
    }
    if (info.isDirectory()) {
      count += await walkDocumentTree(root, path);
      continue;
    }
    if (!info.isFile()) {
      throw new Error(
        "Restored document tree contains an unsupported file type",
      );
    }
    const canonical = await realpath(path);
    assertContained(
      root,
      canonical,
      "Restored document file escapes the target root",
    );
    count += 1;
  }
  return count;
}

function assertContained(root, candidate, message) {
  const nested = relative(root, candidate);
  if (
    nested === ".." ||
    nested.startsWith(`..${sep}`) ||
    isAbsolute(nested)
  ) {
    throw new Error(message);
  }
}

function outputLines(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

async function runTar(args, capture = true) {
  const child = spawn(commandName("tar"), args, {
    stdio: capture
      ? ["ignore", "pipe", "inherit"]
      : "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      LC_ALL: "C",
    },
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
    throw new Error(`tar exited with code ${code}`);
  }
  return output;
}
