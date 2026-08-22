#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const envFile = resolve(process.argv[2] ?? process.env.DEPLOYMENT_ENV_FILE ?? "infra/deployment/.env");
const content = await readFile(envFile, "utf8").catch(() => fail(`Cannot read deployment environment file: ${envFile}`));
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
];

for (const name of required) {
  if (!values[name]?.trim()) fail(`Missing required deployment variable: ${name}`);
}
if (!new Set(["staging", "production"]).has(values.DEPLOYMENT_ENVIRONMENT)) {
  fail("DEPLOYMENT_ENVIRONMENT must be staging or production");
}
for (const [name, value] of Object.entries(values)) {
  if (/replace-|change-me|example\.invalid|dev-only|abixell_dev_password/i.test(value)) {
    fail(`${name} still contains a template/development value`);
  }
}
for (const name of ["API_IMAGE", "API_OPERATIONS_IMAGE", "WEB_IMAGE"]) {
  const image = values[name];
  if (/:latest(?:$|@)/.test(image) || (!image.includes("@sha256:") && !/:[A-Za-z0-9._-]{7,}$/.test(image))) {
    fail(`${name} must use an immutable digest or explicit release tag`);
  }
}
if (!/^postgres:16\.\d+-alpine\d+\.\d+(?:@sha256:[a-f0-9]{64})?$/.test(values.POSTGRES_IMAGE)) {
  fail("POSTGRES_IMAGE must pin PostgreSQL 16 patch and Alpine versions (optionally a digest)");
}
if (values.JWT_ACCESS_SECRET.length < 32 || values.PLATFORM_BOOTSTRAP_KEY.length < 32) {
  fail("JWT_ACCESS_SECRET and PLATFORM_BOOTSTRAP_KEY must each be at least 32 characters");
}
if (/localhost|127\.0\.0\.1/i.test(values.CORS_ORIGINS)) {
  fail("CORS_ORIGINS must not use local-development origins in staging/production");
}
let databaseUrl;
try { databaseUrl = new URL(values.DATABASE_URL); } catch { fail("DATABASE_URL is not a valid URL"); }
if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) fail("DATABASE_URL must use PostgreSQL");
if (databaseUrl.hostname !== "postgres") fail("Compose DATABASE_URL host must be the internal 'postgres' service");

if (process.platform !== "win32") {
  const mode = (await stat(envFile)).mode & 0o777;
  if ((mode & 0o077) !== 0) fail("Deployment environment file permissions must be 0600 or stricter");
}

await runCompose(["--env-file", envFile, "-f", "infra/deployment/compose.yml", "config", "--quiet"]);
process.stdout.write(`Deployment environment validation PASS: ${values.DEPLOYMENT_ENVIRONMENT}\n`);

function parseEnv(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) fail("Invalid environment line (expected NAME=value)");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

async function runCompose(args) {
  const child = spawn(process.platform === "win32" ? "docker.exe" : "docker", ["compose", ...args], {
    stdio: "inherit",
    windowsHide: true,
  });
  const code = await new Promise((resolveCode, reject) => {
    child.once("error", reject);
    child.once("close", resolveCode);
  });
  if (code !== 0) fail(`docker compose config validation exited with code ${code}`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
