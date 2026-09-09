// Loaded before any test file via vitest.config.ts `setupFiles`, so
// process.env.DATABASE_URL / JWT secrets / bootstrap key are available
// before src/infrastructure/persistence/db.ts constructs its Pool (module
// evaluation order would otherwise race dotenv loading inside a test file).
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "../.env") });
