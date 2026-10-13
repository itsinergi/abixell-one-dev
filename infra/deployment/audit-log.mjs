#!/usr/bin/env node

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256Hex } from "./deployment-state.mjs";

/**
 * Append-only deployment audit log.
 *
 * Each record is one JSON Lines line. Records are hash-chained: every record
 * stores the previous record's hash, so deletion or reordering is detectable.
 * Secret values are never recorded; only image digests, release ids, phase
 * names, and outcomes appear.
 *
 * The log is never truncated, rotated, or deleted by deployment tooling.
 */

const SECRET_NAME_PATTERNS = [
  /PASSWORD/i,
  /SECRET/i,
  /TOKEN/i,
  /KEY/i,
  /DATABASE_URL/i,
  /BOOTSTRAP/i,
];

const SCHEMA = 1;

export class AuditLog {
  constructor(logPath) {
    this.logPath = logPath;
    this.logDir = resolve(logPath, "..");
  }

  async init() {
    await mkdir(this.logDir, { recursive: true, mode: 0o700 });
  }

  /**
   * Read the tail record's hash to chain the next record onto it.
   * Returns null when the log does not yet exist or is empty.
   */
  async _previousHash() {
    let content;
    try {
      content = await readFile(this.logPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    const lines = content
      .split(/\r?\n/)
      .filter((line) => line.trim());
    if (lines.length === 0) return null;
    const last = JSON.parse(lines[lines.length - 1]);
    return last.recordHash ?? null;
  }

  /**
   * Append a record. `fields` must not contain secret values; the redactor
   * drops any key that looks credential-bearing.
   */
  async record(fields) {
    const previousRecordHash = await this._previousHash();
    const safe = redact(fields);
    const record = {
      schema: SCHEMA,
      timestamp: new Date().toISOString(),
      previousRecordHash,
      ...safe,
    };
    record.recordHash = sha256Hex(
      `${record.previousRecordHash ?? ""}\n${JSON.stringify(safe)}`,
    );
    const line = `${JSON.stringify(record)}\n`;
    await appendFile(this.logPath, line, { mode: 0o600 });
    return record;
  }
}

/**
 * Remove any field whose name looks like it holds a secret. Image digests,
 * release ids, and phase names are safe to keep.
 */
export function redact(fields) {
  const cleaned = {};
  for (const [name, value] of Object.entries(fields)) {
    if (SECRET_NAME_PATTERNS.some((pattern) => pattern.test(name))) continue;
    cleaned[name] = value;
  }
  return cleaned;
}
