#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseEnv } from "./env-utils.mjs";

const args = process.argv.slice(2);
const envFileArg = args.find((arg) => !arg.startsWith("--"));
const expectedRelease =
  readFlag(args, "--expected-release") ??
  process.env.APPLICATION_RELEASE ??
  null;

const envFile = resolve(
  envFileArg ?? process.env.DEPLOYMENT_ENV_FILE ?? "infra/deployment/.env",
);
const values = parseEnv(await readFile(envFile, "utf8"));
const bindAddress =
  values.WEB_BIND_ADDRESS === "0.0.0.0"
    ? "127.0.0.1"
    : values.WEB_BIND_ADDRESS ?? "127.0.0.1";
const port = values.WEB_PORT ?? "8080";
const origin =
  process.env.DEPLOYMENT_SMOKE_ORIGIN ?? `http://${bindAddress}:${port}`;

for (const path of ["/healthz"]) {
  const response = await fetch(`${origin}${path}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) fail(`${path} returned HTTP ${response.status}`);
}

let health;
try {
  const healthResponse = await fetch(`${origin}/api/health`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!healthResponse.ok) fail(`/api/health returned HTTP ${healthResponse.status}`);
  health = await healthResponse.json();
} catch (error) {
  if (error?.name === "SyntaxError") {
    fail("API /api/health returned non-JSON response");
  }
  fail(`Failed to fetch /api/health: ${error?.message ?? error}`);
}

if (health?.status !== "ok") {
  fail(`API status is "${health?.status}", expected "ok"`);
}
if (expectedRelease && health.release !== expectedRelease) {
  fail(
    `API reports release "${health.release}", expected "${expectedRelease}"`,
  );
}

let db;
try {
  const dbResponse = await fetch(`${origin}/api/health/db`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!dbResponse.ok) fail(`/api/health/db returned HTTP ${dbResponse.status}`);
  db = await dbResponse.json();
} catch (error) {
  if (error?.name === "SyntaxError") {
    fail("API /api/health/db returned non-JSON response");
  }
  fail(`Failed to fetch /api/health/db: ${error?.message ?? error}`);
}

if (db?.status !== "ok" || db?.database !== "connected") {
  fail("Database readiness payload is invalid");
}

const releaseSuffix = expectedRelease ? ` release=${expectedRelease}` : "";
process.stdout.write(`Deployment smoke PASS: ${origin}${releaseSuffix}\n`);

function readFlag(args, name) {
  const prefix = `${name}=`;
  const withValue = args.find((arg) => arg.startsWith(prefix));
  if (withValue) return withValue.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  return null;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
