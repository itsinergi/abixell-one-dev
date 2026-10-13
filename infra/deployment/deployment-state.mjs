#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

/**
 * Durable deployment state: the prior successful release and the current run's
 * migration boundary marker.
 *
 * `last-success.json` changes only after a release passes smoke, so a failed
 * deployment never overwrites the release it might need for recovery.
 *
 * The migration marker is keyed by deployment id. It is written before
 * `node-pg-migrate up`. If the same run fails after this marker, automatic
 * recovery is disallowed and the run fails closed.
 */
export class DeploymentState {
  constructor(stateDir) {
    this.stateDir = stateDir;
    this.lastSuccessPath = resolve(stateDir, "last-success.json");
    this.migrationStartedPath = resolve(stateDir, "migration-started.json");
  }

  async init() {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
  }

  async readLastSuccess() {
    try {
      return JSON.parse(await readFile(this.lastSuccessPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async writeLastSuccess(successData) {
    const tmpPath = `${this.lastSuccessPath}.tmp`;
    const content = `${JSON.stringify(successData, null, 2)}\n`;
    await writeFile(tmpPath, content, { mode: 0o600 });
    await rename(tmpPath, this.lastSuccessPath);
  }

  async readMigrationStarted() {
    try {
      return JSON.parse(await readFile(this.migrationStartedPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async isMigrationStarted(deploymentId) {
    const marker = await this.readMigrationStarted();
    return marker?.deploymentId === deploymentId;
  }

  async markMigrationStarted(deploymentId) {
    const tmpPath = `${this.migrationStartedPath}.tmp`;
    const content = `${JSON.stringify(
      { deploymentId, startedAt: new Date().toISOString() },
      null,
      2,
    )}\n`;
    await writeFile(tmpPath, content, { mode: 0o600 });
    await rename(tmpPath, this.migrationStartedPath);
  }
}

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}
