#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { isTemplateValue } from "./env-utils.mjs";

const MAX_INPUT_BYTES = 10 * 1024;
const inputPath = process.argv[2];
const templatePath =
  process.argv[3] ?? "infra/deployment/.env.example";

if (!inputPath) fail("Deployment input file is required");

const input = await readFile(inputPath);
if (input.length === 0) fail("Deployment input is empty");
if (input.length > MAX_INPUT_BYTES) {
  fail(`Deployment input exceeds ${MAX_INPUT_BYTES} bytes`);
}
if (input.includes(0)) fail("Deployment input contains a NUL byte");

const template = await readFile(resolve(templatePath), "utf8");
const expectedNames = parseNames(template, "template");
const inputNames = parseNames(input.toString("utf8"), "deployment input");
const expected = new Set(expectedNames);
const received = new Set(inputNames);

const unknown = inputNames.filter((name) => !expected.has(name));
if (unknown.length) {
  fail(`Deployment input contains unknown variables: ${unknown.join(", ")}`);
}

const missing = expectedNames.filter((name) => !received.has(name));
if (missing.length) {
  fail(`Deployment input is missing variables: ${missing.join(", ")}`);
}

process.stdout.write("Deployment input protocol validation PASS\n");

function parseNames(text, source) {
  const names = [];
  const seen = new Set();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex < 1) {
      fail(`${source} contains a malformed line`);
    }

    const name = line.slice(0, equalsIndex).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      fail(`${source} contains an invalid variable name`);
    }
    if (seen.has(name)) {
      fail(`${source} contains duplicate variable: ${name}`);
    }

    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (isTemplateValue(value)) {
      fail(`${name} still contains a template/development value`);
    }

    seen.add(name);
    names.push(name);
  }

  return names;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
