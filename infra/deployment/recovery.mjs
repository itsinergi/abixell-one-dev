#!/usr/bin/env node

/**
 * Pre-migration automatic recovery: restart the last successful release's
 * API/Web images and confirm it with a release-aware smoke check.
 *
 * Only called when a deployment fails after quiescing the running release
 * but before migrations start (deploy.mjs decides that boundary). Never
 * invoked once the migration-started marker is durable: at that point the
 * schema may have moved forward and image-only recovery is unsafe, so the
 * caller fails closed instead.
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
