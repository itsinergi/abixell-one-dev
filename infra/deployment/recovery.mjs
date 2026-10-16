#!/usr/bin/env node

/**
 * Automatic recovery: restart the last successful release's API/Web images
 * and confirm it with a release-aware smoke check.
 *
 * Called from two places in deploy.mjs:
 *
 *   1. Pre-migration: the deployment failed after quiescing the running
 *      release but before the migration-started marker was durable. Nothing
 *      has moved forward yet.
 *   2. Post-migration (FD-ENV-04 Option A): the deployment failed after
 *      migrations started. The migration is forward-only and the database is
 *      never restored — only api/web are replaced with the prior release's
 *      images, which is why this stays safe with a forward-only schema.
 *
 * In both cases only application images change. PostgreSQL data is never
 * touched by recovery, so the WAL archiving path (Wave 8) and this path never
 * contend.
 *
 * `last-success.json` is never written or modified by recovery; a failed
 * recovery attempt leaves it exactly as it was.
 */
export async function recoverPriorRelease({
  state,
  audit,
  deploymentId,
  startPriorImages,
  waitForApi,
  waitForWeb,
  smokeRelease,
}) {
  const prior = await state.readLastSuccess();
  if (!prior) {
    await audit.record({
      deploymentId,
      phase: "AUTO_RECOVERY",
      outcome: "unavailable",
      reason: "no-prior-success",
    });
    return { recovered: false, reason: "no-prior-success" };
  }

  const requiredFields = [
    "apiImage",
    "apiOperationsImage",
    "webImage",
    "postgresImage",
    "applicationRelease",
  ];
  const missing = requiredFields.filter((field) => !prior[field]);
  if (missing.length) {
    await audit.record({
      deploymentId,
      phase: "AUTO_RECOVERY",
      outcome: "unavailable",
      reason: `missing-prior-fields:${missing.join(",")}`,
    });
    return { recovered: false, reason: `missing-prior-fields:${missing.join(",")}` };
  }

  await audit.record({
    deploymentId,
    phase: "AUTO_RECOVERY",
    outcome: "started",
    applicationRelease: prior.applicationRelease,
  });

  try {
    await startPriorImages(prior);
    await waitForApi();
    await waitForWeb();
    await smokeRelease(prior.applicationRelease);
    await audit.record({
      deploymentId,
      phase: "AUTO_RECOVERY",
      outcome: "succeeded",
      applicationRelease: prior.applicationRelease,
    });
    return { recovered: true, prior };
  } catch (error) {
    await audit.record({
      deploymentId,
      phase: "AUTO_RECOVERY",
      outcome: "failed",
      applicationRelease: prior.applicationRelease,
      reason: String(error?.message ?? error),
    });
    return { recovered: false, reason: "recovery-failed", error };
  }
}
