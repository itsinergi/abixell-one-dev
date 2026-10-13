#!/usr/bin/env node

/**
 * Shared environment parsing, validation, and quote handling for deployment.
 *
 * `parseEnv` is the inverse of `serializeEnv`: a value containing a literal
 * `$` is single-quoted on write and unquoted on read, so Docker Compose
 * interpolation never mangles it.
 */

/**
 * Parse a .env file into a plain object. Lines starting with `#` and blank
 * lines are ignored. A leading and trailing matching quote pair is stripped
 * from the value; the raw interior is preserved (so `$POSTGRES_USER` stays
 * literal).
 */
export function parseEnv(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
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

/**
 * Serialize a record as a .env file. Values containing a literal `$` are
 * single-quoted so Docker Compose does not interpolate them. Values
 * containing whitespace or special shell characters are also quoted.
 */
export function serializeEnv(values) {
  const lines = [];
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}=${quoteIfNeeded(value)}`);
  }
  return `${lines.join("\n")}\n`;
}

function quoteIfNeeded(value) {
  const string = String(value);
  if (string.length === 0) return "''";
  if (/[\s"'\$`#]/.test(string)) {
    return `'${string.replace(/'/g, "'\\''")}'`;
  }
  return string;
}

const DIGEST_PATTERN = /@sha256:[a-f0-9]{64}$/;

/** True when `value` is an immutable image reference ending in a sha256 digest. */
export function isDigest(value) {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

const TEMPLATE_PATTERNS = [
  /replace-/i,
  /change-me/i,
  /example\.invalid/i,
  /dev-only/i,
  /abixell_dev_password/i,
];

/** True when `value` still looks like a placeholder/dev default. */
export function isTemplateValue(value) {
  return typeof value === "string" && TEMPLATE_PATTERNS.some((p) => p.test(value));
}

/** Parse the image-digests artifact produced by build-images.yml. */
export function parseDigestArtifact(text) {
  const values = parseEnv(text);
  const api = values.API_DIGEST;
  const operations = values.API_OPERATIONS_DIGEST;
  const web = values.WEB_DIGEST;
  const version = values.VERSION;
  const missing = [];
  if (!api) missing.push("API_DIGEST");
  if (!operations) missing.push("API_OPERATIONS_DIGEST");
  if (!web) missing.push("WEB_DIGEST");
  if (!version) missing.push("VERSION");
  if (missing.length) {
    throw new Error(`digest artifact missing: ${missing.join(", ")}`);
  }
  for (const [name, value] of [
    ["API_DIGEST", api],
    ["API_OPERATIONS_DIGEST", operations],
    ["WEB_DIGEST", web],
  ]) {
    if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
      throw new Error(`${name} is not a sha256 digest: ${value}`);
    }
  }
  return { api, operations, web, version };
}
