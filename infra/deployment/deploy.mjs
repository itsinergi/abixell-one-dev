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
import { randomUUID } from "node:crypto";

import { DeploymentState } from "./deployment-state.mjs";
import { AuditLog } from "./audit-log.mjs";
import { parseEnv, serializeEnv } from "./env-utils.mjs";
import { recoverPriorRelease } from "./recovery.mjs";

const envFile = resolve(
  process.argv[2] ??
    process.env.DEPLOYMENT_ENV_FILE ??
    "infra/deployment/.env",
);
const composeFile = resolve("infra/deployment/compose.yml");
const env = parseEnv(await readFile(envFile, "utf8"));
const projectName = safeProjectName(env.COMPOSE_PROJECT_NAME);
const deploymentId = randomUUID();
const stateRoot = resolve(
  process.env.DEPLOYMENT_STATE_ROOT ??
    process.env.DEPLOYMENT_STATE_DIR ??
    defaultStateRoot(),
);
const stateDir = resolve(stateRoot, projectName);
const lockPath = resolve(stateDir, "deploy.lock");
const auditLogPath = resolve(
  process.env.DEPLOYMENT_AUDIT_LOG_PATH ??
    resolve(stateDir, "deploy-audit.log"),
);

const state = new DeploymentState(stateDir);
const audit = new AuditLog(auditLogPath);

await state.init();
await audit.init();

const lock = await acquireLock(lockPath);

try {
  await audit.record({
    deploymentId,
    phase: "DEPLOYMENT_ACCEPTED",
    environment: env.DEPLOYMENT_ENVIRONMENT,
    applicationRelease: env.APPLICATION_RELEASE,
  });

  await validateDeployment();
  await verifyImages();
  await lockAcquired();
  await pullImages();
  await scanImages();
  await ensurePostgres();

  const hasApplicationTables = await databaseHasApplicationTables();
  let needsRecovery = false;

  if (hasApplicationTables) {
    try {
      await quiesce();
      await createPreMigrationBackup();
    } catch (error) {
      needsRecovery = true;
      process.stderr.write(
        `Pre-migration phase failed: ${error.message}\n`,
      );
      await audit.record({
        deploymentId,
        phase: "PRE_MIGRATION_BACKUP",
        outcome: "failed",
        reason: String(error?.message ?? error),
      });
    }
  }

  if (needsRecovery) {
    const recovered = await performRecovery();
    if (recovered) {
      process.stdout.write(
        "Pre-migration recovery PASS; prior release restored.\n",
      );
      await audit.record({
        deploymentId,
        phase: "PRE_MIGRATION_RECOVERY",
        outcome: "success",
      });
      process.exit(1);
    } else {
      fail(
        "Pre-migration phase failed and recovery unavailable; deployment failed closed",
      );
    }
  }

  if (hasApplicationTables) {
    await state.markMigrationStarted(deploymentId);
    await audit.record({
      deploymentId,
      phase: "MIGRATION_STARTED",
      outcome: "marker-written",
    });
  }

  try {
    await runMigration();
    await syncPermissions();
    await startRelease();
    await smokeExpectedRelease();
    await writeSuccess();

    await audit.record({
      deploymentId,
      phase: "DEPLOYMENT_SUCCEEDED",
      outcome: "complete",
      applicationRelease: env.APPLICATION_RELEASE,
    });

    process.stdout.write(
      "Deployment completed and smoke verification passed.\n",
    );
  } catch (error) {
    await audit.record({
      deploymentId,
      phase: "DEPLOYMENT_FAILED",
      outcome: "failed-closed",
      reason: String(error?.message ?? error),
      migrationStarted: true,
    });
    fail(
      `Deployment failed after migration started (fail-closed): ${error.message}`,
    );
  }
} finally {
  await lock.close();
  await rm(lockPath, { force: true });
}

async function validateDeployment() {
  await audit.record({
    deploymentId,
    phase: "VALIDATING",
    outcome: "started",
  });
  try {
    await runNode([
      "infra/deployment/validate-env.mjs",
      envFile,
    ]);
    await audit.record({
      deploymentId,
      phase: "VALIDATING",
      outcome: "passed",
    });
  } catch (error) {
    await audit.record({
      deploymentId,
      phase: "VALIDATING",
      outcome: "failed",
      reason: String(error?.message ?? error),
    });
    throw error;
  }
}

async function verifyImages() {
  try {
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
    await audit.record({
      deploymentId,
      phase: "IMAGE_VERIFICATION",
      outcome: "passed",
    });
  } catch (error) {
    await audit.record({
      deploymentId,
      phase: "IMAGE_VERIFICATION",
      outcome: "failed",
      reason: String(error?.message ?? error),
    });
    throw error;
  }
}

async function lockAcquired() {
  await audit.record({
    deploymentId,
    phase: "PRE_FLIGHT_CHECKS_PASSED",
    outcome: "passed",
  });
}

async function pullImages() {
  try {
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
  } catch (error) {
    await audit.record({
      deploymentId,
      phase: "PULLING_IMAGES",
      outcome: "failed",
      reason: String(error?.message ?? error),
    });
    throw error;
  }
}

async function scanImages() {
  try {
    const images = supplyChainImages();
    // Also scan Postgres image for supply-chain gates (excluded from cosign
    // because it's not signed by our org, but Trivy finds unfixed CVEs in
    // public Postgres images).
    const allImages = [...images, env.POSTGRES_IMAGE];
    process.stdout.write(
      `Scanning ${allImages.length} images via trivy (HIGH,CRITICAL, fixed-only)...\n`,
    );
    for (const image of allImages) {
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
  } catch (error) {
    await audit.record({
      deploymentId,
      phase: "SCANNING_IMAGES",
      outcome: "failed",
      reason: String(error?.message ?? error),
    });
    throw error;
  }
}

async function ensurePostgres() {
  try {
    await compose(["up", "-d", "postgres"]);
    await waitForService("postgres", 120_000);
    await audit.record({
      deploymentId,
      phase: "POSTGRES_READY",
      outcome: "ready",
    });
  } catch (error) {
    await audit.record({
      deploymentId,
      phase: "POSTGRES_READY",
      outcome: "failed",
      reason: String(error?.message ?? error),
    });
    throw error;
  }
}

async function quiesce() {
  try {
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
    await audit.record({
      deploymentId,
      phase: "QUIESCING",
      outcome: "quiesced",
    });
  } catch (error) {
    await audit.record({
      deploymentId,
      phase: "QUIESCING",
      outcome: "failed",
      reason: String(error?.message ?? error),
    });
    throw error;
  }
}

async function createPreMigrationBackup() {
  const prior = await state.readLastSuccess();
  if (!prior?.applicationRelease) {
    throw new Error(
      `Existing deployment has no prior release state; take an operator-labelled quiesced backup before deployment`,
    );
  }
  const backupId = `predeploy-${safeBackupPart(
    prior.applicationRelease,
  )}-${utcBackupId(new Date())}`;

  try {
    await audit.record({
      deploymentId,
      phase: "PRE_MIGRATION_BACKUP",
      outcome: "started",
      backupId,
      priorApplicationRelease: prior.applicationRelease,
    });

    await compose(
      [
        "--profile",
        "operations",
        "run",
        "--rm",
        "-e",
        `APPLICATION_RELEASE=${prior.applicationRelease}`,
        "-e",
        `BACKUP_API_IMAGE=${prior.apiImage}`,
        "-e",
        `BACKUP_OPERATIONS_IMAGE=${prior.apiOperationsImage}`,
        "-e",
        `BACKUP_WEB_IMAGE=${prior.webImage}`,
        "-e",
        `BACKUP_ID=${backupId}`,
        "backup",
      ],
    );

    await audit.record({
      deploymentId,
      phase: "PRE_MIGRATION_BACKUP",
      outcome: "succeeded",
      backupId,
    });
  } catch (error) {
    await audit.record({
      deploymentId,
      phase: "PRE_MIGRATION_BACKUP",
      outcome: "failed",
      backupId,
      reason: String(error?.message ?? error),
    });
    throw error;
  }
}

async function runMigration() {
  try {
    await compose([
      "--profile",
      "operations",
      "run",
      "--rm",
      "migrate",
    ]);
    await audit.record({
      deploymentId,
      phase: "MIGRATING",
      outcome: "succeeded",
    });
  } catch (error) {
    await audit.record({
      deploymentId,
      phase: "MIGRATING",
      outcome: "failed",
      reason: String(error?.message ?? error),
    });
    throw error;
  }
}

async function syncPermissions() {
  try {
    await compose([
      "--profile",
      "operations",
      "run",
      "--rm",
      "sync-permissions",
    ]);
    await audit.record({
      deploymentId,
      phase: "PERMISSION_SYNC",
      outcome: "succeeded",
    });
  } catch (error) {
    await audit.record({
      deploymentId,
      phase: "PERMISSION_SYNC",
      outcome: "failed",
      reason: String(error?.message ?? error),
    });
    throw error;
  }
}

async function startRelease() {
  try {
    await compose([
      "up",
      "-d",
      "--remove-orphans",
      "api",
      "web",
    ]);
    await waitForService("api", 180_000);
    await waitForService("web", 120_000);
    await audit.record({
      deploymentId,
      phase: "RELEASE_STARTED",
      outcome: "ready",
    });
  } catch (error) {
    await audit.record({
      deploymentId,
      phase: "RELEASE_STARTED",
      outcome: "failed",
      reason: String(error?.message ?? error),
    });
    throw error;
  }
}

async function smokeExpectedRelease() {
  try {
    await runNode([
      "infra/deployment/smoke.mjs",
      envFile,
      `--expected-release=${env.APPLICATION_RELEASE}`,
    ]);
    await audit.record({
      deploymentId,
      phase: "RELEASE_SMOKE",
      outcome: "passed",
      applicationRelease: env.APPLICATION_RELEASE,
    });
  } catch (error) {
    await audit.record({
      deploymentId,
      phase: "RELEASE_SMOKE",
      outcome: "failed",
      applicationRelease: env.APPLICATION_RELEASE,
      reason: String(error?.message ?? error),
    });
    throw error;
  }
}

async function writeSuccess() {
  const successData = {
    completedAt: new Date().toISOString(),
    environment: env.DEPLOYMENT_ENVIRONMENT,
    applicationRelease: env.APPLICATION_RELEASE,
    apiImage: env.API_IMAGE,
    apiOperationsImage: env.API_OPERATIONS_IMAGE,
    webImage: env.WEB_IMAGE,
    postgresImage: env.POSTGRES_IMAGE,
  };
  await state.writeLastSuccess(successData);
  await audit.record({
    deploymentId,
    phase: "SUCCESS_RECORDED",
    outcome: "written",
    applicationRelease: env.APPLICATION_RELEASE,
  });
}

async function performRecovery() {
  const recoveryEnvFile = `${envFile}.recovery.tmp`;
  let recoveryEnvWritten = false;

  try {
    const recovered = await recoverPriorRelease({
      state,
      audit,
      deploymentId,
      startPriorImages: async (prior) => {
        const priorEnv = {
          ...env,
          API_IMAGE: prior.apiImage,
          API_OPERATIONS_IMAGE: prior.apiOperationsImage,
          WEB_IMAGE: prior.webImage,
          POSTGRES_IMAGE: prior.postgresImage,
          APPLICATION_RELEASE: prior.applicationRelease,
        };
        await writeFile(
          recoveryEnvFile,
          serializeEnv(priorEnv),
          { mode: 0o600 },
        );
        recoveryEnvWritten = true;
        await compose(
          ["up", "-d", "--remove-orphans", "api", "web"],
          recoveryEnvFile,
        );
      },
      waitForApi: async () => {
        await waitForService("api", 180_000);
      },
      waitForWeb: async () => {
        await waitForService("web", 120_000);
      },
      smokeRelease: async (expectedRelease) => {
        await runNode([
          "infra/deployment/smoke.mjs",
          recoveryEnvFile,
          `--expected-release=${expectedRelease}`,
        ]);
      },
    });
    return recovered.recovered;
  } finally {
    if (recoveryEnvWritten) {
      await rm(recoveryEnvFile, { force: true });
    }
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

async function waitForService(service, timeoutMs) {
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

function compose(args, envFileOverride = null) {
  return run(
    "docker",
    [
      "compose",
      "--env-file",
      envFileOverride ?? envFile,
      "-f",
      composeFile,
      ...args,
    ],
    false,
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

async function run(command, args, capture = false) {
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
