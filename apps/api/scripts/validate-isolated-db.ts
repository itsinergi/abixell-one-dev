import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";

const REQUIRED_DATABASE = "abixell_one_epic3_wave4";
const DATABASE_URL =
  `postgresql://abixell:abixell_dev_password@localhost:5442/${REQUIRED_DATABASE}?schema=public`;
const ADMIN_DATABASE_URL =
  "postgresql://abixell:abixell_dev_password@localhost:5442/postgres";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(scriptDir, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

async function ensureDatabase() {
  const client = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
      [REQUIRED_DATABASE],
    );
    if (!result.rows[0]?.exists) {
      await client.query(`CREATE DATABASE ${REQUIRED_DATABASE}`);
      console.log(`Created database ${REQUIRED_DATABASE}.`);
    } else {
      console.log(`Database ${REQUIRED_DATABASE} already exists.`);
    }
  } finally {
    await client.end();
  }
}

function runNpm(args: string[]) {
  const result = spawnSync(npmCommand, args, {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await ensureDatabase();
runNpm(["run", "migrate:production"]);
runNpm([
  "run",
  "test",
  "--",
  "tests/integration/role-definition.test.ts",
  "tests/integration/window-enforcement.test.ts",
]);
