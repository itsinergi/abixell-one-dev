#!/usr/bin/env node

import {
  mkdir,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const envFile = resolve(
  process.argv[2] ??
    process.env.DEPLOYMENT_ENV_FILE ??
    "infra/deployment/.env",
);
const composeFile = resolve(
  "infra/deployment/compose.yml",
);
const env = parseEnv(await readFile(envFile, "utf8"));
const projectName = safeProjectName(
  env.COMPOSE_PROJECT_NAME,
);
const stateRoot = resolve(
  process.env.DEPLOYMENT_STATE_ROOT ??
    process.env.DEPLOYMENT_STATE_DIR ??
    defaultStateRoot(),
);
const stateDir = resolve(stateRoot, projectName);
const lockPath = resolve(stateDir, "deploy.lock");
const successPath = resolve(
  stateDir,
  "last-success.json",
);
await mkdir(stateDir, {
  recursive: true,
  mode: 0o700,
});
const lock = await acquireLock(lockPath);

try {
  await runNode([
    "infra/deployment/validate-env.mjs",
    envFile,
  ]);
  await verifyCosignSignatures();
  await compose([
    "--profile",
    "operations",
    "pull",
    "postgres",
    "migrate",
    "sync-permissions",
    "backup",
    "api",
    "web",
  ]);
  await scanImagesTrivy();
  await compose(["up", "-d", "postgres"]);
  await waitForService("postgres", 120_000);

  if (await databaseHasApplicationTables()) {
    await quiesceApi();
    await runPreMigrationBackup();
  }

  await compose([
    "--profile",
    "operations",
    "run",
    "--rm",
    "migrate",
  ]);
  await compose([
    "--profile",
    "operations",
    "run",
    "--rm",
    "sync-permissions",
  ]);
  await compose([
    "up",
    "-d",
    "--remove-orphans",
    "api",
    "web",
  ]);
  await waitForService("api", 180_000);
  await waitForService("web", 120_000);
  await runNode([
    "infra/deployment/smoke.mjs",
    envFile,
  ]);

  await writeFile(
    successPath,
    `${JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        environment:
          env.DEPLOYMENT_ENVIRONMENT,
        applicationRelease:
          env.APPLICATION_RELEASE,
        apiImage: env.API_IMAGE,
        apiOperationsImage:
          env.API_OPERATIONS_IMAGE,
        webImage: env.WEB_IMAGE,
        postgresImage: env.POSTGRES_IMAGE,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  process.stdout.write(
    "Deployment completed and smoke verification passed.\n",
  );
} finally {
  await lock.close();
  await rm(lockPath, { force: true });
}

async function runPreMigrationBackup() {
  const prior = await readPriorSuccess();
  if (!prior?.applicationRelease) {
    fail(
      `Existing deployment has no prior release state at ${successPath}; take an operator-labelled quiesced backup before deployment`,
    );
  }
  const backupId = `predeploy-${safeBackupPart(
    prior.applicationRelease,
  )}-${utcBackupId(new Date())}`;
  await compose(
    [
      "--profile",
      "operations",
      "run",
      "--rm",
      "-e",
      `APPLICATION_RELEASE=${prior.applicationRelease}`,
      "-e",
      `BACKUP_API_IMAGE=${requiredPriorValue(prior, "apiImage")}`,
      "-e",
      `BACKUP_OPERATIONS_IMAGE=${requiredPriorValue(prior, "apiOperationsImage")}`,
      "-e",
      `BACKUP_WEB_IMAGE=${requiredPriorValue(prior, "webImage")}`,
      "-e",
      `BACKUP_ID=${backupId}`,
      "backup",
    ],
  );
}

async function readPriorSuccess() {
  try {
    return JSON.parse(
      await readFile(successPath, "utf8"),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function requiredPriorValue(prior, name) {
  if (!prior?.[name]) {
    fail(
      `Prior deployment state has no ${name}; take an operator-labelled quiesced backup before deployment`,
    );
  }
  return prior[name];
}

async function quiesceApi() {
  const apiId = (
    await composeCapture(["ps", "-q", "api"])
  ).trim();
  const webId = (
    await composeCapture(["ps", "-q", "web"])
  ).trim();
  if (webId) {
    await compose(["stop", "web"]);
  }
  if (apiId) {
    await compose(["stop", "api"]);
  }
}

async function verifyCosignSignatures() {
  const images = supplyChainImages();
  const identityRegex =
    process.env.DEPLOY_COSIGN_IDENTITY_REGEX ??
    "^https://github\\.com/itsinergi/abixell-one-dev/\\.github/workflows/build-images\\.yml@refs/";
  const issuer =
    process.env.DEPLOY_COSIGN_OIDC_ISSUER ??
    "https://token.actions.githubusercontent.com";
  process.stdout.write(
    `Verifying ${images.length} image signatures via cosign...\n`,
  );
  for (const image of images) {
    await run("cosign", [
      "verify",
      "--certificate-identity-regexp",
      identityRegex,
      "--certificate-oidc-issuer",
      issuer,
      image,
    ]);
  }
}

async function scanImagesTrivy() {
  const images = supplyChainImages();
  process.stdout.write(
    `Scanning ${images.length} images via trivy (HIGH,CRITICAL, fixed-only)...\n`,
  );
  for (const image of images) {
    await run("trivy", [
      "image",
      "--severity",
      "HIGH,CRITICAL",
      "--ignore-unfixed",
      "--exit-code",
      "1",
      "--no-progress",
      image,
    ]);
  }
}

function supplyChainImages() {
  const images = [
    env.API_IMAGE,
    env.API_OPERATIONS_IMAGE,
    env.WEB_IMAGE,
  ];
  for (const image of images) {
    if (!image || !image.includes("@sha256:")) {
      fail(
        `Supply chain verification requires immutable digests; got "${image}"`,
      );
    }
  }
  return images;
}

async function acquireLock(path) {
  try {
    const handle = await open(path, "wx", 0o600);
    await handle.write(`${process.pid}\n`);
    return handle;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  const existingPid = Number.parseInt(
    (
      await readFile(path, "utf8").catch(
        () => "",
      )
    ).trim(),
    10,
  );
  if (
    Number.isInteger(existingPid) &&
    isProcessAlive(existingPid)
  ) {
    fail(
      `Another deployment appears active (${path}, pid=${existingPid})`,
    );
  }

  await rm(path, { force: true });
  try {
    const handle = await open(path, "wx", 0o600);
    await handle.write(`${process.pid}\n`);
    return handle;
  } catch {
    fail(
      `Another deployment acquired the lock (${path})`,
    );
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function databaseHasApplicationTables() {
  const output = (
    await composeCapture([
      "exec",
      "-T",
      "postgres",
      "sh",
      "-c",
      "psql --no-psqlrc --tuples-only --no-align -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -c \"SELECT count(*) FROM pg_tables WHERE schemaname = 'public'\"",
    ])
  ).trim();
  return Number(output) > 0;
}

async function waitForService(
  service,
  timeoutMs,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const id = (
      await composeCapture(["ps", "-q", service])
    ).trim();
    if (id) {
      const status = (
        await dockerCapture([
          "inspect",
          "--format",
          "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
          id,
        ])
      ).trim();
      if (
        status === "healthy" ||
        status === "running"
      ) {
        return;
      }
      if (
        ["unhealthy", "exited", "dead"].includes(
          status,
        )
      ) {
        throw new Error(
          `${service} entered ${status} state`,
        );
      }
    }
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, 2_000),
    );
  }
  throw new Error(
    `Timed out waiting for ${service}`,
  );
}

function compose(args, extraEnv = {}) {
  return run(
    "docker",
    [
      "compose",
      "--env-file",
      envFile,
      "-f",
      composeFile,
      ...args,
    ],
    false,
    extraEnv,
  );
}

function composeCapture(args) {
  return run(
    "docker",
    [
      "compose",
      "--env-file",
      envFile,
      "-f",
      composeFile,
      ...args,
    ],
    true,
  );
}

function dockerCapture(args) {
  return run("docker", args, true);
}

function runNode(args) {
  return run("node", args);
}

async function run(
  command,
  args,
  capture = false,
  extraEnv = {},
) {
  const child = spawn(
    process.platform === "win32"
      ? `${command}.exe`
      : command,
    args,
    {
      stdio: capture
        ? ["ignore", "pipe", "inherit"]
        : "inherit",
      windowsHide: true,
      env: { ...process.env, ...extraEnv },
    },
  );
  let output = "";
  if (capture) {
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
  }
  const code = await new Promise(
    (resolveCode, reject) => {
      child.once("error", reject);
      child.once("close", resolveCode);
    },
  );
  if (code !== 0) {
    throw new Error(
      `${command} exited with code ${code}`,
    );
  }
  return output;
}

function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter(
        (line) =>
          line &&
          !line.trim().startsWith("#") &&
          line.includes("="),
      )
      .map((line) => {
        const index = line.indexOf("=");
        return [
          line.slice(0, index).trim(),
          line
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
}

function defaultStateRoot() {
  if (process.platform === "win32") {
    return resolve(
      process.env.ProgramData ??
        "C:/ProgramData",
      "AbixellOne/deployments",
    );
  }
  return "/var/lock/abixell-one";
}

function safeProjectName(value) {
  if (
    !value ||
    !/^[a-z0-9][a-z0-9_-]*$/.test(value)
  ) {
    fail(
      "COMPOSE_PROJECT_NAME must contain only lowercase letters, numbers, underscore, and hyphen",
    );
  }
  return value;
}

function safeBackupPart(value) {
  return value
    .replace(/@sha256:/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .slice(0, 80);
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
