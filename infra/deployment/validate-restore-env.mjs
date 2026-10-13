#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import { parseEnv, isDigest, isTemplateValue } from "./env-utils.mjs";

const envFile = resolve(
  process.argv[2] ??
    process.env.RESTORE_ENV_FILE ??
    "infra/deployment/.env.restore",
);
const content = await readFile(envFile, "utf8").catch(() =>
  fail(`Cannot read restore environment file: ${envFile}`),
);
const values = parseEnv(content);
const required = [
  "COMPOSE_PROJECT_NAME",
  "RESTORE_OPERATIONS_IMAGE",
  "RESTORE_API_IMAGE",
  "RESTORE_WEB_IMAGE",
  "RESTORE_POSTGRES_IMAGE",
  "RESTORE_BACKUP_DIR",
  "RESTORE_POSTGRES_USER",
  "RESTORE_POSTGRES_PASSWORD",
  "RESTORE_POSTGRES_DB",
  "RESTORE_DATABASE_URL",
  "RESTORE_FILE_STORAGE_PARENT",
  "RESTORE_CONFIRM",
  "RESTORE_APPLICATION_RELEASE",
  "RESTORE_HEALTH_URL",
  "RESTORE_DB_HEALTH_URL",
  "JWT_ACCESS_SECRET",
  "PLATFORM_BOOTSTRAP_KEY",
  "CORS_ORIGINS",
];

for (const name of required) {
  if (!values[name]?.trim()) {
    fail(`Missing required restore variable: ${name}`);
  }
}
for (const name of [
  "RESTORE_OPERATIONS_IMAGE",
  "RESTORE_API_IMAGE",
  "RESTORE_WEB_IMAGE",
  "RESTORE_POSTGRES_IMAGE",
]) {
  if (!isDigest(values[name])) {
    fail(`${name} must use an immutable sha256 digest`);
  }
}
if (!/postgres(?:ql)?(?:[-/:@]|$)/i.test(values.RESTORE_POSTGRES_IMAGE)) {
  fail("RESTORE_POSTGRES_IMAGE must reference PostgreSQL");
}
if (values.RESTORE_CONFIRM !== "RESTORE") {
  fail("RESTORE_CONFIRM must be RESTORE");
}
if (
  values.JWT_ACCESS_SECRET.length < 32 ||
  values.PLATFORM_BOOTSTRAP_KEY.length < 32
) {
  fail(
    "JWT_ACCESS_SECRET and PLATFORM_BOOTSTRAP_KEY must each be at least 32 characters",
  );
}
for (const [name, value] of Object.entries(values)) {
  if (isTemplateValue(value)) {
    fail(`${name} still contains a template/development value`);
  }
}
let databaseUrl;
try {
  databaseUrl = new URL(values.RESTORE_DATABASE_URL);
} catch {
  fail("RESTORE_DATABASE_URL is not a valid URL");
}
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
  fail("RESTORE_DATABASE_URL must use PostgreSQL");
}
if (databaseUrl.hostname !== "recovery-postgres") {
  fail(
    "RESTORE_DATABASE_URL host must be the isolated 'recovery-postgres' service",
  );
}
if (
  decodeURIComponent(databaseUrl.username) !==
  values.RESTORE_POSTGRES_USER
) {
  fail(
    "RESTORE_DATABASE_URL username must match RESTORE_POSTGRES_USER",
  );
}
if (
  decodeURIComponent(databaseUrl.password) !==
  values.RESTORE_POSTGRES_PASSWORD
) {
  fail(
    "RESTORE_DATABASE_URL password must match RESTORE_POSTGRES_PASSWORD",
  );
}
if (
  decodeURIComponent(
    databaseUrl.pathname.replace(/^\//, ""),
  ) !== values.RESTORE_POSTGRES_DB
) {
  fail(
    "RESTORE_DATABASE_URL database name must match RESTORE_POSTGRES_DB",
  );
}
for (const [name, path] of [
  ["RESTORE_HEALTH_URL", "/api/health"],
  ["RESTORE_DB_HEALTH_URL", "/api/health/db"],
]) {
  let url;
  try {
    url = new URL(values[name]);
  } catch {
    fail(`${name} is not a valid URL`);
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "recovery-web" ||
    url.port !== "8080" ||
    url.pathname !== path ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    fail(
      `${name} must use in-Compose recovery-web service DNS at http://recovery-web:8080${path}`,
    );
  }
}
if (/localhost|127\.0\.0\.1/i.test(values.CORS_ORIGINS)) {
  fail(
    "CORS_ORIGINS must describe the isolated recovery Web origin, not a local-development origin",
  );
}

const manifestPath = resolve(
  values.RESTORE_BACKUP_DIR,
  "manifest.json",
);
const manifest = JSON.parse(
  await readFile(manifestPath, "utf8").catch(() =>
    fail(`Cannot read restore manifest: ${manifestPath}`),
  ),
);
if (![1, 2].includes(manifest.formatVersion)) {
  fail(
    `Unsupported backup manifest format: ${manifest.formatVersion}`,
  );
}
if (
  manifest.applicationRelease !==
  values.RESTORE_APPLICATION_RELEASE
) {
  fail(
    "RESTORE_APPLICATION_RELEASE does not match the selected backup manifest",
  );
}
if (manifest.images) {
  for (const [name, manifestName] of [
    ["RESTORE_OPERATIONS_IMAGE", "operations"],
    ["RESTORE_API_IMAGE", "api"],
    ["RESTORE_WEB_IMAGE", "web"],
  ]) {
    if (manifest.images[manifestName] !== values[name]) {
      fail(
        `${name} does not match the selected backup manifest`,
      );
    }
  }
} else {
  process.stderr.write(
    "Warning: legacy backup manifest has no immutable image identities; operator release retention evidence is required.\n",
  );
}

if (process.platform !== "win32") {
  const mode = (await stat(envFile)).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    fail(
      "Restore environment file permissions must be 0600 or stricter",
    );
  }
}

const rendered = await runCompose([
  "--env-file",
  envFile,
  "-f",
  "infra/deployment/compose.restore.yml",
  "--profile",
  "operations",
  "config",
  "--format",
  "json",
]);
const model = JSON.parse(rendered);
assertRenderedValue(
  model.services?.restore?.environment?.RESTORE_DATABASE_URL,
  values.RESTORE_DATABASE_URL,
  "RESTORE_DATABASE_URL",
);
assertRenderedValue(
  model.services?.["recovery-postgres"]?.environment
    ?.POSTGRES_PASSWORD,
  values.RESTORE_POSTGRES_PASSWORD,
  "RESTORE_POSTGRES_PASSWORD",
);
assertRenderedValue(
  model.services?.["verify-restore"]?.environment
    ?.RESTORE_HEALTH_URL,
  values.RESTORE_HEALTH_URL,
  "RESTORE_HEALTH_URL",
);
assertRenderedValue(
  model.services?.["verify-restore"]?.environment
    ?.RESTORE_DB_HEALTH_URL,
  values.RESTORE_DB_HEALTH_URL,
  "RESTORE_DB_HEALTH_URL",
);
assertRenderedValue(
  model.services?.["recovery-api"]?.environment?.JWT_ACCESS_SECRET,
  values.JWT_ACCESS_SECRET,
  "JWT_ACCESS_SECRET",
);
assertRenderedValue(
  model.services?.["recovery-api"]?.environment
    ?.PLATFORM_BOOTSTRAP_KEY,
  values.PLATFORM_BOOTSTRAP_KEY,
  "PLATFORM_BOOTSTRAP_KEY",
);
assertRenderedValue(
  model.services?.["recovery-api"]?.environment?.CORS_ORIGINS,
  values.CORS_ORIGINS,
  "CORS_ORIGINS",
);
assertRenderedValue(
  model.services?.["recovery-api"]?.environment
    ?.APPLICATION_RELEASE,
  values.RESTORE_APPLICATION_RELEASE,
  "RESTORE_APPLICATION_RELEASE",
);
process.stdout.write("Restore environment validation PASS\n");

function assertRenderedValue(actual, expected, name) {
  if (actual !== expected) {
    fail(
      `${name} changes during Docker Compose interpolation; single-quote values containing a literal $`,
    );
  }
}

async function runCompose(args) {
  const child = spawn(
    process.platform === "win32" ? "docker.exe" : "docker",
    ["compose", ...args],
    {
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true,
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const code = await new Promise((resolveCode, reject) => {
    child.once("error", reject);
    child.once("close", resolveCode);
  });
  if (code !== 0) {
    fail(
      `docker compose restore config validation exited with code ${code}`,
    );
  }
  return output;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
