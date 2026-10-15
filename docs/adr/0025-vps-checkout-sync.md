# ADR-0025: VPS Checkout Sync Before Deploy

**Date:** 2026-10-15

**Status:** DECIDED (WP-ENV-02 Wave 6, follow-up to ADR-0024)

**Author:** Abixell One Implementation

## Context

ADR-0024 D5 fixed the VPS deploy wrapper as **static and minimal**: it runs a fixed command against a fixed checkout at `/home/deploy/apps/abixell-one-dev` and is explicitly "cannot be updated during a deployment." That decision correctly keeps build/render logic out of the VPS trust boundary. It left one gap unaddressed: **nothing in the pipeline ever updates the checkout itself.**

This gap surfaced concretely. Deploy run `38689254458` failed with `trivy exited with code 1` scanning the Postgres image (59 CVEs, the known `gosu` set). The build run it consumed (`38688811084`) was correct — built from commit `b39a1cf`, which had already replaced the blocking Postgres scan with an advisory one (non-blocking `--exit-code 0`, see `infra/deployment/deploy.mjs` `scanImages()`). The VPS checkout, however, was still at commit `39d8a64` (Wave 6, pre-advisory) — confirmed by matching the failing line numbers in the error trace to that exact commit. The deploy wrapper ran the right command against the wrong code.

Neither `.github/workflows/deploy-staging.yml` nor `infra/deployment/vps/abixell-staging-deploy-wrapper` contains any git operation. The checkout was last updated manually, once, at Wave 6 bootstrap, and has drifted ever since. Every future merge to `master` would silently fail to reach the VPS until an operator remembered to `git pull` by hand.

## Decision

### D1 — A second, separate forced-command script: checkout sync

Add `infra/deployment/vps/abixell-staging-checkout-sync`, installed by the operator the same way as the deploy wrapper (ADR-0024 D5), bound to its **own** SSH key and its own `authorized_keys` forced-command line — sshd binds one command per key, so the sync capability cannot be folded into the existing deploy key without widening what that key can do.

The script accepts exactly one input on stdin: a 40-character lowercase hex commit SHA. Nothing else:

- No arbitrary commands (`SSH_ORIGINAL_COMMAND` is rejected outright).
- No flags, no refs other than a literal commit SHA.
- Input is bounded (`head -c 128`) before any processing — never buffers unbounded caller-controlled input.
- Remote origin is checked against a hardcoded allow-list value before any fetch, so a tampered or mis-cloned checkout cannot be pointed somewhere else.
- `git fetch` only (read-only) before any local state changes.
- The target commit must be reachable from `origin/master` or pointed at by an origin tag — the same provenance rule the CD workflow already enforces on the build side (ADR-0024 D1 step 2). A side-branch or unmerged commit is rejected.
- `git checkout --detach`, no `--force` / `--hard`: a dirty tracked file blocks the checkout loudly instead of silently discarding something.
- `GIT_TERMINAL_PROMPT=0` / `GIT_ASKPASS=/bin/true`: never hangs waiting for credentials (the repository is public; none should ever be needed).
- Exits non-zero, checkout left unchanged, on any failure.

**Rationale:** The smallest capability that closes the gap is "set the checkout to one verified commit." Anything broader (arbitrary git commands, branch management, remote changes) would reopen the kind of attack surface ADR-0024 D5 deliberately fenced out of the VPS.

### D2 — Sync runs in CI, before deploy, and gates it

`.github/workflows/deploy-staging.yml` extracts `head_sha` from the already-verified build run (the same `gh api` call that checks `conclusion`/`workflow name`/`head_branch` in the "Verify build run provenance" step), validates it is a full 40-hex SHA, and pipes it to the VPS over the sync key in a new "Sync VPS checkout to build commit" step, placed after "Configure SSH" and before "Deploy to staging via SSH."

If the sync step's SSH call exits non-zero, the workflow step fails and the deploy step never runs. The ordering is deliberate and atomic at the workflow level: a failed sync must never be followed by a deploy against whatever code happened to be checked out before.

**Rationale:** Validating the commit SHA in GitHub Actions (trusted CI context, same place ADR-0024 D1 already validates build provenance) before it ever reaches the VPS is defense in depth: the VPS script re-validates independently, but CI catches a malformed value before spending a network round trip.

### D3 — No operator action per deploy

Once installed, the sync step requires no manual intervention on any subsequent deploy. The previous state — an operator occasionally remembering to `git pull` on the VPS — is replaced by an automatic, provenance-gated step that runs on every deploy, success or failure visible in the workflow log.

**Rationale:** The whole point of ADR-0024 D1 was removing manual steps from staging deploys. A sync mechanism that still depends on an operator remembering to run it manually would reintroduce exactly the failure mode this ADR exists to close.

## Alternatives Considered

### A1 — Fold sync into the existing deploy wrapper

**Rejected.** ADR-0024 D5 fixes the deploy wrapper as static and minimal specifically so it cannot be changed mid-deployment reasoning. Adding git logic to it would widen that wrapper's responsibility and its blast radius if the deploy key were ever compromised. A second, narrower-scoped script with its own key keeps each capability minimal.

### A2 — Operator runs `git pull` manually before each deploy

**Rejected.** This is the status quo that caused the incident. It does not scale and has already failed once in exactly the way predicted (drift between merge and VPS checkout).

### A3 — `git reset --hard` / force-sync every deploy regardless of provenance

**Rejected.** Checking out an arbitrary ref without the master/tag-reachability check would let anything with the sync key move the checkout to any commit, including an unmerged or unreviewed one. Mirroring the CD workflow's own provenance rule (master or version tag) keeps the sync script's trust model consistent with the rest of the pipeline.

### A4 — Multiplex the sync and deploy capabilities on one SSH key

**Rejected.** `sshd` binds exactly one forced command per `authorized_keys` line. Multiplexing would require either a dispatcher script (reintroducing the "do more than one minimal thing" problem A1 rejects) or protocol sniffing on stdin (fragile, and blurs what each key can do). Two keys, two scripts, each minimal, is simpler to reason about and to revoke independently.

## Consequences

### Positive

1. **Closes the drift gap:** every deploy now runs against the exact commit the build run was built from, automatically.
2. **No operator action per deploy:** the Wave 6 manual-sync failure mode cannot recur.
3. **Minimal added capability:** the sync script can only move the checkout to a verified, provenance-checked commit — nothing else.
4. **Consistent trust model:** the sync script's provenance check mirrors the CD workflow's own build-provenance rule, rather than introducing a second standard.
5. **Fails closed:** a sync failure aborts the deploy before it can run against stale or inconsistent code.

### Negative

1. **A second key to protect:** the sync key, like the deploy key, can move the checkout to any commit reachable from `master`/tags, which then executes as the `deploy` user. It must be protected with the same care as the deploy key (documented residual risk in the script's own header comment).
2. **A second operator bootstrap step:** installing the sync script and its key is now part of VPS bootstrap, alongside the deploy wrapper. Missing this step before the first deploy reproduces the original gap.
3. **Extra network round trip per deploy:** the sync step adds one more SSH call (`git fetch` from a public repo) to the deploy pipeline. Bounded by `FETCH_TIMEOUT_SECONDS=180` in the script; not expected to be material next to image pull/scan/migration times.

## Evidence / Testing

- [ ] `abixell-staging-checkout-sync` installed at `/usr/local/sbin/` on the staging VPS, owned by root, mode `0755`.
- [ ] Sync key installed as its own `authorized_keys` line, `restrict,no-pty,no-agent-forwarding,no-port-forwarding,no-X11-forwarding`, bound to the sync script only.
- [ ] Sync key rejects an `SSH_ORIGINAL_COMMAND` (arbitrary command injection attempt).
- [ ] Sync script rejects malformed stdin (not 40 lowercase hex chars).
- [ ] Sync script rejects a commit not reachable from `origin/master` and not tagged (negative test, staging disposable only).
- [ ] Sync step in `deploy-staging.yml` runs before "Deploy to staging via SSH" and aborts the job on sync failure.
- [ ] Full ENV-05 deploy run completes end-to-end with the sync step live: image verification, Trivy advisory scan on Postgres (non-blocking), full blocking gate on app images, migration, permission sync, smoke.
- [ ] Job summary reports the synced source commit (`steps.provenance.outputs.head_sha`).
- [ ] Both SSH keys (deploy and sync) shredded from the runner in the Cleanup step on every path (`if: always()`).

## References

- [`infra/deployment/vps/abixell-staging-checkout-sync`](../../infra/deployment/vps/abixell-staging-checkout-sync) — checkout sync script (reference source; operator-installed).
- [`infra/deployment/vps/abixell-staging-deploy-wrapper`](../../infra/deployment/vps/abixell-staging-deploy-wrapper) — deploy wrapper, unchanged (ADR-0024 D5).
- [`.github/workflows/deploy-staging.yml`](../../.github/workflows/deploy-staging.yml) — "Verify build run provenance" (`head_sha` extraction/validation), "Configure SSH" (both keys), "Sync VPS checkout to build commit" step.
- [`infra/deployment/deploy.mjs`](../../infra/deployment/deploy.mjs) — `scanImages()`, the advisory-mode Postgres scan the stale checkout was missing.
- [ADR-0024](./0024-staging-cd-and-pre-migration-recovery.md) — D1 (CD protocol, provenance check), D5 (static VPS wrapper boundary this ADR extends without modifying).
- [`docs/operations/deployment-runbook.md`](../../docs/operations/deployment-runbook.md) — VPS bootstrap procedure, updated with sync script install steps.

---

**Ringkasan Indonesia**

Deploy run gagal di scan Trivy image Postgres karena checkout di VPS basi (commit Wave 6, sebelum mode advisory digabung). Root cause: pipeline deploy tidak punya mekanisme sync git — wrapper deploy sengaja dibuat statis (ADR-0024 D5) dan tidak pernah update checkout sendiri. Solusi: script forced-command baru, `abixell-staging-checkout-sync`, terpisah dari wrapper deploy, dengan key SSH sendiri. Script ini hanya menerima satu commit SHA di stdin, validasi format, validasi origin, fetch read-only, lalu checkout hanya jika commit itu reachable dari origin/master atau tag origin — meniru aturan provenance yang sama dipakai workflow CD untuk build. Workflow `deploy-staging.yml` extract `head_sha` dari build run yang sudah diverifikasi, lalu jalankan step sync ini sebelum deploy; jika sync gagal, deploy dibatalkan. Tidak ada tindakan operator manual per-deploy lagi — hanya instalasi sekali saat bootstrap VPS.
