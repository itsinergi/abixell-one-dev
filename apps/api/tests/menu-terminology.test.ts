/**
 * Epic 3 Wave 3 step 11 — tenant label override from the allowed terminology
 * list (CORE-ROADMAP.md §4.3 step 11, §4.2 "Label" and "Cakupan tenant").
 *
 * "11. Penimpa label tenant dari daftar istilah yang diizinkan."
 *
 * §4.2 states the two halves of that sentence separately, and each one needs
 * its own proof:
 *
 *   - "**Label dan deskripsi boleh ditimpa tenant**" — the served menu tree
 *     must show the tenant's wording. Proven through `GET /me`, which is the
 *     payload the shell actually renders, not through the repository in
 *     isolation.
 *   - "**dibatasi daftar istilah yang diizinkan**" — the limit is the point.
 *     A tenant can hold ANY terminology key; only the ones the core allowlist
 *     points at a menu/field pair may reach the tree. `site.label` is a real
 *     terminology key with no allowlist entry, and it is written here exactly
 *     as a tenant would write it, to prove the gate is the join and not a
 *     convention.
 *
 * "ID tidak berubah saat label berganti" is checked directly: after an
 * override the node's `code`, `path`, `moduleCode` and `requiredPermissions`
 * are compared against the pre-override snapshot, and a locked menu stays
 * locked under its new name — §4.2's access-definition columns are not
 * reachable from this path at all.
 *
 * "Tenant hanya menimpa yang aman" implies the other direction too: one
 * tenant's override must not appear in another tenant's tree.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { pool } from "../src/infrastructure/persistence/db.js";
import type { MenuNode } from "../src/domain/configuration/app-metadata.entity.js";
import {
  activateAllModules,
  authHeader,
  bootstrapTenant,
  login,
  provisionFirstAdmin,
  provisionInternalUser,
} from "./integration/helpers.js";

const RUN = `${Date.now()}`.slice(-9);
const TENANT_A = `mt-a-${RUN}`;
const TENANT_B = `mt-b-${RUN}`;
const ADMIN_PASSWORD = "Term-Check-1!";

/** The two keys this wave introduces, one per overridable field. */
const OVERVIEW_NAME_KEY = "menu.nav-overview.name";
const OVERVIEW_DESC_KEY = "menu.nav-overview.description";
const PAYROLL_NAME_KEY = "menu.nav-workforce-workforce-payroll.name";
/** A real terminology key the allowlist does NOT point at any menu. */
const UNAUTHORIZED_KEY = "site.label";

function flatten(nodes: MenuNode[]): MenuNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

async function servedMenu(
  app: Awaited<ReturnType<typeof buildApp>>,
  tenantCode: string,
  email: string,
): Promise<Map<string, MenuNode>> {
  const session = await login(app, tenantCode, email, ADMIN_PASSWORD);
  if (session.statusCode !== 200 || !("accessToken" in session.body)) {
    throw new Error(`login failed: ${session.statusCode} ${JSON.stringify(session.body)}`);
  }
  const response = await app.inject({
    method: "GET",
    url: "/me",
    headers: authHeader(session.body.accessToken),
  });
  if (response.statusCode !== 200) {
    throw new Error(`/me failed: ${response.statusCode} ${response.body}`);
  }
  const body = response.json() as { menu: MenuNode[] };
  return new Map(flatten(body.menu).map((node) => [node.code, node]));
}

describe("Epic 3 Wave 3 step 11 — tenant menu label override", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const tenantIds: string[] = [];
  let tenantAId: string;
  let tenantBId: string;
  let tokenA: string;
  let emailA: string;
  let emailB: string;
  let emailRestricted: string;
  let coreNames: Map<string, MenuNode>;

  beforeAll(async () => {
    app = buildApp();

    const a = await bootstrapTenant(app, TENANT_A, "Terminology Tenant A");
    tenantAId = a.id;
    tenantIds.push(a.id);
    const b = await bootstrapTenant(app, TENANT_B, "Terminology Tenant B");
    tenantBId = b.id;
    tenantIds.push(b.id);

    await activateAllModules(tenantAId);
    await activateAllModules(tenantBId);

    emailA = `term-a-${RUN}@example.test`;
    emailB = `term-b-${RUN}@example.test`;
    await provisionFirstAdmin({ tenantId: tenantAId, email: emailA, password: ADMIN_PASSWORD });
    await provisionFirstAdmin({ tenantId: tenantBId, email: emailB, password: ADMIN_PASSWORD });
    // A role that cannot open Payroll, to show a renamed menu stays locked.
    emailRestricted = `term-limited-${RUN}@example.test`;
    await provisionInternalUser({
      tenantId: tenantAId,
      email: emailRestricted,
      password: ADMIN_PASSWORD,
      roleCode: "OVERVIEW_ONLY",
      permissionCodes: [],
    });

    tokenA = (await login(app, TENANT_A, emailA, ADMIN_PASSWORD)).body.accessToken;
    coreNames = await servedMenu(app, TENANT_A, emailA);
  });

  afterAll(async () => {
    for (const id of tenantIds) {
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [id]);
    }
    await app.close();
  });

  it("seeds one allowlist entry per overridable (menu, field) pair, from the catalogue itself", async () => {
    // The allowlist is core data seeded from `config_menu_seed()` — the same
    // function Wave 1 seeded the catalogue from — so the two cannot drift.
    const seeded = await pool.query(
      `SELECT (SELECT count(*) FROM config_menu_seed()) AS menus,
              (SELECT count(*) FROM menu_terminology_allowlist WHERE field = 'name') AS names,
              (SELECT count(*) FROM config_menu_seed() WHERE description IS NOT NULL) AS described,
              (SELECT count(*) FROM menu_terminology_allowlist WHERE field = 'description') AS descriptions`,
    );
    const row = seeded.rows[0];
    expect(Number(row.names)).toBe(Number(row.menus));
    expect(Number(row.descriptions)).toBe(Number(row.described));

    // Every allowlist row points at a real terminology key, and every one of
    // those keys belongs to this feature's namespace.
    const orphans = await pool.query(
      `SELECT a.menu_code, a.field
         FROM menu_terminology_allowlist a
         LEFT JOIN terminology_keys tk ON tk.id = a.terminology_key_id
        WHERE tk.id IS NULL OR tk.code <> 'menu.' || a.menu_code || '.' || a.field`,
    );
    expect(orphans.rows).toEqual([]);
  });

  it("serves the Product Core label until the tenant overrides it", () => {
    expect(coreNames.get("nav-overview")?.name).toBe("Overview");
    expect(coreNames.get("nav-overview")?.description).toBe("Your workspace at a glance.");
  });

  it("serves the tenant's wording for name AND description after an override, and nothing else changes", async () => {
    const nameResponse = await app.inject({
      method: "PUT",
      url: `/config/terminology/${OVERVIEW_NAME_KEY}`,
      headers: authHeader(tokenA),
      payload: { value: "Beranda" },
    });
    expect(nameResponse.statusCode).toBe(204);

    const descriptionResponse = await app.inject({
      method: "PUT",
      url: `/config/terminology/${OVERVIEW_DESC_KEY}`,
      headers: authHeader(tokenA),
      payload: { value: "Ringkasan pekerjaan Anda hari ini." },
    });
    expect(descriptionResponse.statusCode).toBe(204);

    const after = await servedMenu(app, TENANT_A, emailA);
    const node = after.get("nav-overview")!;
    const before = coreNames.get("nav-overview")!;

    expect(node.name).toBe("Beranda");
    expect(node.description).toBe("Ringkasan pekerjaan Anda hari ini.");

    // §4.3 "Kode yang dikunci; label yang bebas diganti" — identity and reach
    // are untouched by a label change.
    expect(node.code).toBe(before.code);
    expect(node.path).toBe(before.path);
    expect(node.moduleCode).toBe(before.moduleCode);
    expect(node.requiredPermissions).toEqual(before.requiredPermissions);
    expect(node.isExternalAllowed).toBe(before.isExternalAllowed);
    expect(node.seqNo).toBe(before.seqNo);
  });

  it("keeps a locked menu locked under its new name — the override never widens access", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/config/terminology/${PAYROLL_NAME_KEY}`,
      headers: authHeader(tokenA),
      payload: { value: "Penggajian Internal" },
    });
    expect(response.statusCode).toBe(204);

    // A caller holding NO permission still receives the new name and still
    // cannot open the page: §4.2's access-definition columns are not
    // reachable from the terminology path, so renaming a menu cannot grant
    // anything. Checked on the restricted caller, not the ADMIN — an ADMIN
    // is `locked: false` either way and would prove nothing here.
    const restricted = (await servedMenu(app, TENANT_A, emailRestricted)).get(
      "nav-workforce-workforce-payroll",
    )!;
    expect(restricted.name).toBe("Penggajian Internal");
    expect(restricted.locked).toBe(true);
    expect(restricted.lockedReason).toContain("workforce.payroll");
    expect(restricted.requiredPermissions).toEqual([
      "workforce.payroll.read",
      "workforce.payroll.manage",
      "workforce.payroll.approve",
    ]);
  });

  it("does not leak one tenant's label into another tenant's tree", async () => {
    const other = await servedMenu(app, TENANT_B, emailB);
    expect(other.get("nav-overview")?.name).toBe("Overview");
    expect(other.get("nav-overview")?.description).toBe("Your workspace at a glance.");
    expect(other.get("nav-workforce-workforce-payroll")?.name).toBe("Payroll");

    // And nothing was written for tenant B in the first place.
    const stored = await pool.query(
      `SELECT count(*)::int AS n
         FROM tenant_terminology_overrides tto
         JOIN terminology_keys tk ON tk.id = tto.terminology_key_id
        WHERE tto.tenant_id = $1 AND tk.code LIKE 'menu.%'`,
      [tenantBId],
    );
    expect(stored.rows[0].n).toBe(0);
  });

  it("refuses override keys the allowlist does not point at a menu", async () => {
    // `site.label` is a legitimate terminology key with its own schema — the
    // write itself succeeds, which is what makes this a test of the GATE and
    // not of the schema registry.
    const response = await app.inject({
      method: "PUT",
      url: `/config/terminology/${UNAUTHORIZED_KEY}`,
      headers: authHeader(tokenA),
      payload: { value: "Lokasi" },
    });
    expect(response.statusCode).toBe(204);

    const served = await servedMenu(app, TENANT_A, emailA);
    // No menu in the tree picked it up — the key feeds the Organization Unit
    // form, not navigation.
    const changed = [...served.values()].filter(
      (node) => node.name === "Lokasi" || node.description === "Lokasi",
    );
    expect(changed).toEqual([]);
  });

  it("bounds a label at 60 characters and a description at 240", async () => {
    const tooLongLabel = await app.inject({
      method: "PUT",
      url: `/config/terminology/${OVERVIEW_NAME_KEY}`,
      headers: authHeader(tokenA),
      payload: { value: "L".repeat(61) },
    });
    expect(tooLongLabel.statusCode).toBe(400);
    expect(tooLongLabel.json().error).toContain("Schema Registry validation");

    const tooLongDescription = await app.inject({
      method: "PUT",
      url: `/config/terminology/${OVERVIEW_DESC_KEY}`,
      headers: authHeader(tokenA),
      payload: { value: "D".repeat(241) },
    });
    expect(tooLongDescription.statusCode).toBe(400);
    expect(tooLongDescription.json().error).toContain("Schema Registry validation");

    // A description longer than a label but within its own bound is accepted:
    // the two fields do not share one limit.
    const longDescription = "D".repeat(240);
    const accepted = await app.inject({
      method: "PUT",
      url: `/config/terminology/${OVERVIEW_DESC_KEY}`,
      headers: authHeader(tokenA),
      payload: { value: longDescription },
    });
    expect(accepted.statusCode).toBe(204);
    expect((await servedMenu(app, TENANT_A, emailA)).get("nav-overview")?.description).toBe(
      longDescription,
    );
  });

  it("records before AND after on the terminology audit entry", async () => {
    // §4.2 open item #4: a tenant override needs audit, not a version chain —
    // which only holds if the audit entry can answer "before what?".
    const audit = await app.inject({
      method: "GET",
      url: "/audit-log/recent",
      headers: authHeader(tokenA),
    });
    expect(audit.statusCode).toBe(200);

    const entries = (audit.json() as Array<{
      action: string;
      metadata: { code?: string; previousValue?: string | null; value?: string };
    }>).filter(
      (entry) => entry.action === "config.terminology.changed" && entry.metadata.code === OVERVIEW_NAME_KEY,
    );

    // Written twice above (once successfully, once rejected by the schema —
    // a rejected write records nothing), so exactly one entry exists.
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.previousValue).toBe(null);
    expect(entries[0].metadata.value).toBe("Beranda");
  });

  it("labels the second write with the first value as its 'before'", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/config/terminology/${OVERVIEW_NAME_KEY}`,
      headers: authHeader(tokenA),
      payload: { value: "Dasbor" },
    });
    expect(response.statusCode).toBe(204);

    const audit = await app.inject({
      method: "GET",
      url: "/audit-log/recent",
      headers: authHeader(tokenA),
    });
    const entries = (audit.json() as Array<{
      action: string;
      metadata: { code?: string; previousValue?: string | null; value?: string };
    }>).filter(
      (entry) => entry.action === "config.terminology.changed" && entry.metadata.code === OVERVIEW_NAME_KEY,
    );

    // Matched by value, not by list position: `listRecentByTenant` orders by
    // `created_at` alone, and two writes in the same second can tie.
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.metadata.value === "Dasbor")?.metadata.previousValue).toBe(
      "Beranda",
    );
    expect(entries.find((e) => e.metadata.value === "Beranda")?.metadata.previousValue).toBe(null);
  });
});
