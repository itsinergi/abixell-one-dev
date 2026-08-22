#!/usr/bin/env node

import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const envFile = resolve(process.argv[2] ?? process.env.DEPLOYMENT_ENV_FILE ?? "infra/deployment/.env");
const composeFile = resolve("infra/deployment/compose.yml");
const stateDir = resolve(process.env.DEPLOYMENT_STATE_DIR ?? "infra/deployment/.state");
const lockPath = `${stateDir}/deploy.lock`;
await mkdir(stateDir, { recursive: true, mode: 0o700 });
let lock;
try {
  lock = await open(lockPath, "wx", 0o600);
  await lock.write(`${process.pid}\n`);
} catch {
  fail(`Another deployment appears active (${lockPath})`);
}

try {
  await runNode(["infra/deployment/validate-env.mjs", envFile]);
  await compose(["--profile", "operations", "pull", "postgres", "migrate", "sync-permissions", "backup", "api", "web"]);
  await compose(["up", "-d", "postgres"]);
  await waitForService("postgres", 120_000);
  await compose(["--profile", "operations", "run", "--rm", "migrate"]);
  await compose(["--profile", "operations", "run", "--rm", "sync-permissions"]);
  await compose(["up", "-d", "--remove-orphans", "api", "web"]);
  await waitForService("api", 180_000);
  await waitForService("web", 120_000);
  await runNode(["infra/deployment/smoke.mjs", envFile]);

  const env = parseEnv(await readFile(envFile, "utf8"));
  await writeFile(
    `${stateDir}/last-success.json`,
    `${JSON.stringify({
      completedAt: new Date().toISOString(),
      environment: env.DEPLOYMENT_ENVIRONMENT,
      apiImage: env.API_IMAGE,
      apiOperationsImage: env.API_OPERATIONS_IMAGE,
      webImage: env.WEB_IMAGE,
      postgresImage: env.POSTGRES_IMAGE,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  process.stdout.write("Deployment completed and smoke verification passed.\n");
} finally {
  await lock?.close();
  await rm(lockPath, { force: true });
}

async function waitForService(service, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const id = (await composeCapture(["ps", "-q", service])).trim();
    if (id) {
      const status = (await dockerCapture(["inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}", id])).trim();
      if (status === "healthy" || status === "running") return;
      if (status === "unhealthy" || status === "exited" || status === "dead") {
        throw new Error(`${service} entered ${status} state`);
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
  throw new Error(`Timed out waiting for ${service}`);
}

function compose(args) {
  return run("docker", ["compose", "--env-file", envFile, "-f", composeFile, ...args]);
}
function composeCapture(args) {
  return run("docker", ["compose", "--env-file", envFile, "-f", composeFile, ...args], true);
}
function dockerCapture(args) {
  return run("docker", args, true);
}
function runNode(args) {
  return run("node", args);
}

async function run(command, args, capture = false) {
  const child = spawn(process.platform === "win32" ? `${command}.exe` : command, args, {
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
