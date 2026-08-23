import { fileURLToPath } from "node:url";

import {
  collectPlatformBoundaryFiles,
  formatValidationReport,
  validatePlatformBoundaries,
} from "./lib/platform-boundary-validator.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

try {
  const files = await collectPlatformBoundaryFiles(repositoryRoot);
  const result = validatePlatformBoundaries(files);
  console.log(formatValidationReport(result));
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  console.error("FAIL platform-boundaries — validator could not complete.");
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
