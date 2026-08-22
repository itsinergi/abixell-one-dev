#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const envFile = resolve(process.argv[2] ?? process.env.DEPLOYMENT_ENV_FILE ?? "infra/deployment/.env");
const values = parseEnv(await readFile(envFile, "utf8"));
const bindAddress = values.WEB_BIND_ADDRESS === "0.0.0.0" ? "127.0.0.1" : (values.WEB_BIND_ADDRESS ?? "127.0.0.1");
const port = values.WEB_PORT ?? "8080";
const origin = process.env.DEPLOYMENT_SMOKE_ORIGIN ?? `http://${bindAddress}:${port}`;

for (const path of ["/healthz", "/api/health", "/api/health/db"]) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) fail(`${path} returned HTTP ${response.status}`);
}
const db = await fetch(`${origin}/api/health/db`, { signal: AbortSignal.timeout(10_000) }).then((response) => response.json());
if (db.status !== "ok" || db.database !== "connected") fail("Database readiness payload is invalid");
process.stdout.write(`Deployment smoke PASS: ${origin}\n`);

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#") && line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
  }));
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
