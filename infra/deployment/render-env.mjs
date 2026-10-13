#!/usr/bin/env node

/**
 * Render staging.env from template (.env.example) + image digests + GitHub Environment secrets.
 *
 * GitHub Environment passes secrets as STAGING_<NAME> env vars (e.g., STAGING_POSTGRES_PASSWORD).
 * CLI args supply image digests and release. Template provides safe defaults for non-secrets.
 *
 * Validation: rejects unresolved placeholders, missing required secrets.
 * Output: 0600, never printed to logs.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  parseEnv,
  serializeEnv,
  isTemplateValue,
  isDigest,
} from "./env-utils.mjs";

const args = process.argv.slice(2);
const templatePath = readFlag(args, "--template");
const outputPath = readFlag(args, "--output");
const release = readFlag(args, "--release");
const apiImage = readFlag(args, "--api-image");
const apiOperationsImage = readFlag(
  args,
  "--api-operations-image",
);
const webImage = readFlag(args, "--web-image");
const postgresImage = readFlag(args, "--postgres-image");

if (!templatePath) fail("--template is required");
if (!outputPath) fail("--output is required");
if (!release) fail("--release is required");
if (!apiImage) fail("--api-image is required");
if (!apiOperationsImage) fail("--api-operations-image is required");
if (!webImage) fail("--web-image is required");
if (!postgresImage) fail("--postgres-image is required");

for (const [name, value] of [
  ["--api-image", apiImage],
  ["--api-operations-image", apiOperationsImage],
  ["--web-image", webImage],
  ["--postgres-image", postgresImage],
]) {
  if (!isDigest(value)) {
    fail(`${name} must be an immutable image reference ending in @sha256:<64 hex>`);
  }
}

const templateContent = await readFile(templatePath, "utf8");
const templateValues = parseEnv(templateContent);

// Extract allowlist: variable names from template
const allowlist = new Set(Object.keys(templateValues));

// Map secrets from GitHub Environment STAGING_* vars to template names.
// These must come from GitHub Secrets (never echoed); non-secret config comes
// from Environment variables.
const secretMapping = {
  POSTGRES_PASSWORD: "STAGING_POSTGRES_PASSWORD",
  DATABASE_URL: "STAGING_DATABASE_URL",
  JWT_ACCESS_SECRET: "STAGING_JWT_ACCESS_SECRET",
  PLATFORM_BOOTSTRAP_KEY: "STAGING_PLATFORM_BOOTSTRAP_KEY",
  CORS_ORIGINS: "STAGING_CORS_ORIGINS",
};

// Build rendered values
const rendered = {};

// Copy all template defaults first
Object.assign(rendered, templateValues);

// Override with CLI args
rendered.API_IMAGE = apiImage;
rendered.API_OPERATIONS_IMAGE = apiOperationsImage;
rendered.WEB_IMAGE = webImage;
rendered.POSTGRES_IMAGE = postgresImage;
rendered.APPLICATION_RELEASE = release;
rendered.DEPLOYMENT_ENVIRONMENT = "staging";

// Override with GitHub Environment secrets
for (const [name, envVar] of Object.entries(secretMapping)) {
  const value = process.env[envVar];
  if (!value) {
    fail(
      `Missing required GitHub Environment secret: ${envVar} (renders as ${name})`,
    );
  }
  rendered[name] = value;
}

// Allow STAGING_* overrides for non-secret template variables
for (const key of allowlist) {
  if (key === "DEPLOYMENT_ENVIRONMENT") continue; // immutable
  if (key.match(/IMAGE|RELEASE/)) continue; // CLI/secret args only
  const envVar = `STAGING_${key}`;
  if (process.env[envVar]) {
    rendered[key] = process.env[envVar];
  }
}

// Validate: no placeholders remain. Never echo the value — a secret could
// match a placeholder pattern by coincidence and leak into logs.
for (const name of Object.keys(rendered)) {
  if (isTemplateValue(rendered[name])) {
    fail(
      `${name} still contains a placeholder value; provide STAGING_${name} environment variable`,
    );
  }
}

// Validate: only allowlisted variables
for (const name of Object.keys(rendered)) {
  if (!allowlist.has(name)) {
    fail(
      `Variable ${name} is not in the template allowlist; template: ${templatePath}`,
    );
  }
}

// Write output atomically (temp + rename)
await mkdir(resolve(outputPath, ".."), { recursive: true, mode: 0o700 });
const tmpPath = `${outputPath}.tmp`;
const content = serializeEnv(rendered);
await writeFile(tmpPath, content, { mode: 0o600 });
await rename(tmpPath, outputPath);

process.stdout.write(`Environment rendered: ${outputPath} (0600)\n`);

function readFlag(flagArgs, name) {
  const prefix = `${name}=`;
  const withValue = flagArgs.find((arg) => arg.startsWith(prefix));
  if (withValue) return withValue.slice(prefix.length);
  const index = flagArgs.indexOf(name);
  if (index >= 0 && index + 1 < flagArgs.length) {
    return flagArgs[index + 1];
  }
  return null;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
