import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const result = await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id
         FROM roles r
         CROSS JOIN permissions p
        WHERE r.is_full_access = true
     ON CONFLICT DO NOTHING
     RETURNING role_id`,
  );

  console.log(
    `sync-role-permissions: ${result.rowCount ?? 0} new (role, permission) grant(s) added ` +
      `across every is_full_access role. 0 is a healthy result if nothing changed since the last run.`,
  );

  await pool.end();
}

main().catch(async (err) => {
  console.error("sync-role-permissions failed:", err);
  await pool.end();
  process.exitCode = 1;
});
