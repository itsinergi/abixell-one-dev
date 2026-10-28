import "dotenv/config";
import { buildApp } from "./app.js";
import { pool } from "./infrastructure/persistence/db.js";
import { syncModuleConfig } from "./application/configuration/sync-module-config.js";

const port = Number(process.env.PORT ?? 4000);

async function start(): Promise<void> {
  // §4.15 Putaran 7 — register every module's configuration manifest before the
  // server accepts a request. A bad manifest (unknown module code, a default
  // outside its own bounds) stops the boot here, loudly, instead of leaving a
  // half-registered catalogue behind a running API.
  const { upserted } = await syncModuleConfig(pool);

  const app = buildApp();
  app.log.info(`Module config manifests synced (${upserted} parameter(s))`);
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`Abixell One API listening on port ${port}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
