#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const envFile = resolve(
  process.argv[2] ??
    process.env.DEPLOYMENT_ENV_FILE ??
    "infra/deployment/.env",
);
const content = await readFile(envFile, "utf8").catch(() =>
  fail(`Cannot read deployment environment file: ${envFile}`),
);
const values = parseEnv(content);
const required = [
  "DEPLOYMENT_ENVIRONMENT",
  "COMPOSE_PROJECT_NAME",
  "API_IMAGE",
  "API_OPERATIONS_IMAGE",
  "WEB_IMAGE",
  "POSTGRES_IMAGE",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "DATABASE_URL",
  "JWT_ACCESS_SECRET",
  "PLATFORM_BOOTSTRAP_KEY",
  "CORS_ORIGINS",
  "BACKUP_ROOT",
  "APPLICATION_RELEASE",
];

for (const name of required) {
  if (!values[name]?.trim()) {
    fail(`Missing required deployment variable: ${name}`);
  }
}
if (
  !new Set(["staging", "production"]).has(
    values.DEPLOYMENT_ENVIRONMENT,
  )
) {
  fail("DEPLOYMENT_ENVIRONMENT must be staging or production");
}
for (const [name, value] of Object.entries(values)) {
  if (
    /replace-|change-me|example\.invalid|dev-only|abixell_dev_password/i.test(
      value,
    )
  ) {
    fail(`${name} still contains a template/development value`);
  }
}
for (const name of [
  "API_IMAGE",
  "API_OPERATIONS_IMAGE",
  "WEB_IMAGE",
  "POSTGRES_IMAGE",
]) {
  requireDigest(values[name], name);
}
if (!/postgres(?:ql)?(?:[-/:@]|$)/i.test(values.POSTGRES_IMAGE)) {
  fail("POSTGRES_IMAGE must reference a PostgreSQL image");
}
if (
  values.JWT_ACCESS_SECRET.length < 32 ||
  values.PLATFORM_BOOTSTRAP_KEY.length < 32
) {
  fail(
    "JWT_ACCESS_SECRET and PLATFORM_BOOTSTRAP_KEY must each be at least 32 characters",
  );
}
if (/localhost|127\.0\.0\.1/i.test(values.CORS_ORIGINS)) {
  fail(
    "CORS_ORIGINS must not use local-development origins in staging/production",
  );
}

let databaseUrl;
try {
  databaseUrl = new URL(values.DATABASE_URL);
} catch {
  fail("DATABASE_URL is not a valid URL");
}
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
  fail("DATABASE_URL must use PostgreSQL");
}
if (databaseUrl.hostname !== "postgres") {
  fail("Compose DATABASE_URL host must be the internal 'postgres' service");
}
if (
  decodeURIComponent(databaseUrl.username) !==
  values.POSTGRES_USER
) {
  fail("DATABASE_URL username must match POSTGRES_USER");
}
if (
  decodeURIComponent(databaseUrl.password) !==
  values.POSTGRES_PASSWORD
) {
  fail("DATABASE_URL password must match POSTGRES_PASSWORD");
}
if (
  decodeURIComponent(
    databaseUrl.pathname.replace(/^\//, ""),
  ) !== values.POSTGRES_DB
) {
  fail("DATABASE_URL database name must match POSTGRES_DB");
}

if (process.platform !== "win32") {
  const mode = (await stat(envFile)).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    fail(
      "Deployment environment file permissions must be 0600 or stricter",
    );
  }
}

const rendered = await runCompose([
  "--env-file",
  envFile,
  "-f",
  "infra/deployment/compose.yml",
  "config",
  "--format",
  "json",
], true);
const model = JSON.parse(rendered);
assertRenderedValue(
  model.services?.postgres?.environment?.POSTGRES_PASSWORD,
  values.POSTGRES_PASSWORD,
  "POSTGRES_PASSWORD",
);
assertRenderedValue(
  model.services?.api?.environment?.DATABASE_URL,
  values.DATABASE_URL,
  "DATABASE_URL",
);
assertRenderedValue(
  model.services?.api?.environment?.JWT_ACCESS_SECRET,
  values.JWT_ACCESS_SECRET,
  "JWT_ACCESS_SECRET",
);
assertRenderedValue(
  model.services?.api?.environment?.PLATFORM_BOOTSTRAP_KEY,
  values.PLATFORM_BOOTSTRAP_KEY,
  "PLATFORM_BOOTSTRAP_KEY",
);
assertRenderedValue(
  model.services?.api?.environment?.CORS_ORIGINS,
  values.CORS_ORIGINS,
  "CORS_ORIGINS",
);
process.stdout.write(
  `Deployment environment validation PASS: ${values.DEPLOYMENT_ENVIRONMENT}\n`,
);

function parseEnv(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) {
      fail("Invalid environment line (expected NAME=value)");
    }
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function requireDigest(value, name) {
  if (!/@sha256:[a-f0-9]{64}$/.test(value)) {
    fail(`${name} must use an immutable sha256 digest`);
  }
}

function assertRenderedValue(actual, expected, name) {
  if (actual !== expected) {
    fail(
      `${name} changes during Docker Compose interpolation; single-quote values containing a literal $`,
    );
  }
}

async function runCompose(args, capture = false) {
  const child = spawn(
    process.platform === "win32" ? "docker.exe" : "docker",
    ["compose", ...args],
    {
      stdio: capture
        ? ["ignore", "pipe", "inherit"]
        : "inherit",
      windowsHide: true,
    },
  );
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
    fail(
      `docker compose config validation exited with code ${code}`,
    );
  }
  return output;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
