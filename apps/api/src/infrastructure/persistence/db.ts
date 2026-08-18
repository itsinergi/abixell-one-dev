import { Pool } from "pg";

// Single shared connection pool for the process. Domain/application layers
// depend on repository interfaces, not on this file directly, to keep the
// hexagonal boundary intact (see docs/adr/0002-database-postgresql.md).
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
