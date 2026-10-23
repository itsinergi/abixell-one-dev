/**
 * Catering Pilot Seed — FASE 0 item 3 (Staging Initialization)
 *
 * Initializes the synthetic UNIT-CAT-PILOT-01 tenant with every piece of
 * foundation data E2E-014 needs before an operator can run the 29 UAT
 * transactions. Every write below mirrors `tests/integration/wave-ver-01-pilot.test.ts`
 * (WP-VER-01, merged PR #18) — that test proves this exact sequence works
 * against the real API and the real schema, so the seed inherits its
 * correctness rather than guessing column names.
 *
 * Created here (foundation):
 *   tenant, legal entity, org units, 4 roles (COORD_OPS / EXEC_OPS /
 *   VERIFY_OPS / BILL_OPS), 4 users, workflow definition (published),
 *   service definition, numbering WO/INV, catering pack activation,
 *   KG/G units + conversion, RICE / COOKED-RICE items, valuation layer,
 *   menu + recipe + ingredients, accounting period Oktober 2026 (open),
 *   chart of accounts, GL accounts 1210/2410/2500/4100/6200,
 *   three posting rules, tenant markup 0.15.
 *
 * NOT created here (operator runs during FASE 1):
 *   the 29 pilot transactions (20 × UAT-014-01, 3 × UAT-014-02/03/04).
 *   Those must go through the real API so they emit outbox events and GL
 *   journals — seeding them would produce evidence that did not exercise
 *   the system under test.
 *
 * Policy FD-009-S1: synthetic data only. No production data, PII, tokens,
 * secrets, or private keys. Passwords are supplied through environment
 * variables and never printed by this script.
 *
 * Idempotent: re-running on an existing UNIT-CAT-PILOT-01 exits without
 * touching data.
 *
 * Usage: npm run seed:pilot -w apps/api
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { pool } from "../src/infrastructure/persistence/db.js";
import { hashPassword } from "../src/infrastructure/security/password.js";

const PILOT_TENANT_CODE = "UNIT-CAT-PILOT-01";
const PILOT_TENANT_NAME = "Catering Pilot — Synthetic Unit";
const WORKFLOW_CODE = "service_operations_work_order";
const SERVICE_CODE = "catering_pilot_service";
const MARKUP_PARAM = "service_operations.invoice.default_markup";
const TODAY = new Date().toISOString().slice(0, 10);

// Passwords are environment-supplied only (FD-009-S1: no credentials in pilot
// documents). The operator sets these in the staging env at T0 and rotates
// them before the pilot opens. The script fails fast if either is missing.
const ADMIN_EMAIL = "admin@pilot.local";
const ADMIN_PASSWORD = process.env.PILOT_ADMIN_PASSWORD;
const PILOT_PASSWORD = process.env.PILOT_USER_PASSWORD;

if (!ADMIN_PASSWORD || !PILOT_PASSWORD) {
  console.error(
    "[PILOT SEED] ABORT: PILOT_ADMIN_PASSWORD and PILOT_USER_PASSWORD must be set in the environment.",
  );
  process.exit(2);
}

const PILOT_USERS = [
  { roleCode: "COORD_OPS", email: "coord@pilot.local", fullName: "Coordinator Ops" },
  { roleCode: "EXEC_OPS", email: "exec@pilot.local", fullName: "Executor Ops" },
  { roleCode: "VERIFY_OPS", email: "verify@pilot.local", fullName: "Verifier Ops" },
  { roleCode: "BILL_OPS", email: "bill@pilot.local", fullName: "Billing Ops" },
] as const;

const ROLE_PERMISSIONS: Record<string, string[]> = {
  COORD_OPS: [
    "service_operations.read",
    "service_operations.manage",
    "service_operations.configure",
    "customer.read",
    "workflow.instance.start",
    "workflow.instance.act",
  ],
  EXEC_OPS: ["service_operations.read", "service_operations.execute", "workflow.instance.act"],
  VERIFY_OPS: ["service_operations.read", "service_operations.verify", "workflow.instance.act"],
  BILL_OPS: ["service_operations.read", "service_operations.billing.manage", "customer.read"],
};

// ---------------------------------------------------------------------------
// Bootstrap helpers — same flow as tests/integration/helpers.ts, inlined so
// this script does not depend on a test directory.
// ---------------------------------------------------------------------------

async function bootstrapTenant(app: FastifyInstance, code: string, name: string) {
  const bootstrapKey = process.env.PLATFORM_BOOTSTRAP_KEY;
  if (!bootstrapKey) {
    console.error("[PILOT SEED] ABORT: PLATFORM_BOOTSTRAP_KEY must be set in the environment.");
    process.exit(2);
  }
  const response = await app.inject({
    method: "POST",
    url: "/tenants",
    headers: { "x-bootstrap-key": bootstrapKey },
    payload: { code, name },
  });
  if (response.statusCode !== 201) {
    throw new Error(`bootstrapTenant failed: ${response.statusCode} ${response.body}`);
  }
  return response.json() as { id: string; code: string };
}

async function activateAllModules(tenantId: string) {
  await pool.query(
    `INSERT INTO tenant_module_activations (tenant_id, module_id, is_active)
     SELECT $1, m.id, true FROM modules m
     ON CONFLICT (tenant_id, module_id) DO UPDATE SET is_active = true`,
    [tenantId],
  );
}

async function provisionFirstAdmin(params: { tenantId: string; email: string; password: string }) {
  const roleRow = (
    await pool.query(
      `INSERT INTO roles (tenant_id, code, name, is_full_access)
       VALUES ($1, 'ADMIN', 'Administrator', true) RETURNING id`,
      [params.tenantId],
    )
  ).rows[0];

  const permissions = (await pool.query(`SELECT id FROM permissions`)).rows;
  for (const p of permissions) {
    await pool.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [
      roleRow.id,
      p.id,
    ]);
  }

  const passwordHash = await hashPassword(params.password);
  const userRow = (
    await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, $3, 'Pilot Administrator') RETURNING id`,
      [params.tenantId, params.email, passwordHash],
    )
  ).rows[0];

  await pool.query(
    `INSERT INTO user_role_assignments (user_id, role_id, scope_type) VALUES ($1, $2, 'tenant')`,
    [userRow.id, roleRow.id],
  );

  return { userId: userRow.id as string, roleId: roleRow.id as string };
}

async function createRole(tenantId: string, code: string, permissionCodes: string[]) {
  const roleRow = (
    await pool.query(`INSERT INTO roles (tenant_id, code, name) VALUES ($1, $2, $2) RETURNING id`, [
      tenantId,
      code,
    ])
  ).rows[0];

  const permissions = (
    await pool.query(`SELECT id FROM permissions WHERE code = ANY($1)`, [permissionCodes])
  ).rows;
  if (permissions.length !== permissionCodes.length) {
    throw new Error(
      `role ${code}: expected ${permissionCodes.length} permissions, found ${permissions.length}`,
    );
  }
  for (const p of permissions) {
    await pool.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [
      roleRow.id,
      p.id,
    ]);
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(`[PILOT SEED] Checking tenant '${PILOT_TENANT_CODE}'...`);
  const existing = await pool.query("SELECT id FROM tenants WHERE code = $1", [PILOT_TENANT_CODE]);
  if (existing.rows[0]) {
    console.log(`[PILOT SEED] Skipped — tenant '${PILOT_TENANT_CODE}' already exists.`);
    await pool.end();
    return;
  }

  const app = buildApp();
  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token}` }, payload });
  const expectStatus = (label: string, res: { statusCode: number; body: string }, expected: number) => {
    if (res.statusCode !== expected) {
      throw new Error(`${label} failed: expected ${expected}, got ${res.statusCode} — ${res.body}`);
    }
    return res;
  };

  try {
    // --- 1. Tenant + admin ------------------------------------------------
    console.log(`[PILOT SEED] Creating tenant...`);
    const tenant = await bootstrapTenant(app, PILOT_TENANT_CODE, PILOT_TENANT_NAME);
    const tenantId = tenant.id;
    await activateAllModules(tenantId);
    const adminUser = await provisionFirstAdmin({ tenantId, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const adminUserId = adminUser.userId;

    const adminLogin = expectStatus(
      "admin login",
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { tenantCode: PILOT_TENANT_CODE, email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      }),
      200,
    );
    const adminToken = (adminLogin.json() as { accessToken: string }).accessToken;

    // --- 2. Legal entity + org units (transactional) -------------------------
    console.log(`[PILOT SEED] Creating legal entity and organization units...`);
    let legalEntityId = "";
    {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const legalEntity = (
          await client.query(
            `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, $2) RETURNING id`,
            [tenantId, "Catering Pilot Legal Entity"],
          )
        ).rows[0];

        // Root Central is mandatory (invariant enforced by migration 1789385000000).
        // Created here, active, in the same transaction as the Legal Entity.
        const central = (
          await client.query(
            `INSERT INTO organization_units (tenant_id, legal_entity_id, parent_id, name, unit_type, status, is_active, created_by, updated_by)
             VALUES ($1, $2, NULL, 'Central', 'Central', 'active', true, $3, $3) RETURNING id`,
            [tenantId, legalEntity.id, adminUserId],
          )
        ).rows[0];

        const headOffice = (
          await client.query(
            `INSERT INTO organization_units (tenant_id, legal_entity_id, parent_id, name, unit_type, status, is_active, created_by, updated_by)
             VALUES ($1, $2, $3, 'Head Office', 'Head Office', 'active', true, $4, $4) RETURNING id`,
            [tenantId, legalEntity.id, central.id, adminUserId],
          )
        ).rows[0];

        await client.query(
          `INSERT INTO organization_units (tenant_id, legal_entity_id, parent_id, name, unit_type, status, is_active, created_by, updated_by)
           VALUES ($1, $2, $3, 'Pilot Site', 'Site', 'active', true, $4, $4)`,
          [tenantId, legalEntity.id, headOffice.id, adminUserId],
        );

        await client.query("COMMIT");
        legalEntityId = legalEntity.id as string;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    // --- 3. Roles + pilot users -------------------------------------------
    console.log(`[PILOT SEED] Creating roles and pilot users...`);
    for (const [roleCode, permissionCodes] of Object.entries(ROLE_PERMISSIONS)) {
      await createRole(tenantId, roleCode, permissionCodes);
    }

    let executorUserId = "";
    for (const user of PILOT_USERS) {
      const created = expectStatus(
        `create user ${user.email}`,
        await post("/admin/users", adminToken, {
          email: user.email,
          fullName: user.fullName,
          password: PILOT_PASSWORD,
          pairs: [{ roleCode: user.roleCode, scopeType: "tenant" }],
        }),
        201,
      );
      if (user.roleCode === "EXEC_OPS") {
        executorUserId = (created.json() as { user: { id: string } }).user.id;
      }
    }
    console.log(`[PILOT SEED] EXEC_OPS user id: ${executorUserId}`);

    // --- 4. Numbering ------------------------------------------------------
    console.log(`[PILOT SEED] Configuring numbering sequences...`);
    expectStatus(
      "numbering work_order",
      await post("/config/numbering/work_order", adminToken, { pattern: "WO-{SEQ:5}" }),
      201,
    );
    expectStatus(
      "numbering customer_invoice",
      await post("/config/numbering/customer_invoice", adminToken, { pattern: "INV-{SEQ:5}" }),
      201,
    );

    // --- 5. Workflow definition (published) -------------------------------
    console.log(`[PILOT SEED] Creating and publishing work-order workflow...`);
    expectStatus(
      "workflow definition",
      await post("/workflow/definitions", adminToken, {
        code: WORKFLOW_CODE,
        name: "Work Order Lifecycle",
        entityType: "work_order",
        description: "E2E-014 catering pilot lifecycle",
      }),
      201,
    );

    const addStep = (body: Record<string, unknown>) =>
      post(`/workflow/definitions/${WORKFLOW_CODE}/versions/1/steps`, adminToken, body);
    expectStatus("step PLANNED", await addStep({ code: "PLANNED", name: "Planned", stepType: "task", isInitial: true }), 201);
    expectStatus("step IN_PROGRESS", await addStep({ code: "IN_PROGRESS", name: "In Progress", stepType: "task" }), 201);
    expectStatus("step DONE", await addStep({ code: "DONE", name: "Done", stepType: "approval" }), 201);
    expectStatus(
      "step CLOSED",
      await addStep({ code: "CLOSED", name: "Closed", stepType: "end", isTerminal: true, terminalStatus: "approved" }),
      201,
    );

    const addTransition = (body: Record<string, unknown>) =>
      post(`/workflow/definitions/${WORKFLOW_CODE}/versions/1/transitions`, adminToken, body);
    expectStatus("transition start", await addTransition({ fromStepCode: "PLANNED", toStepCode: "IN_PROGRESS", actionCode: "start", name: "Start" }), 201);
    expectStatus("transition complete", await addTransition({ fromStepCode: "IN_PROGRESS", toStepCode: "DONE", actionCode: "complete", name: "Complete" }), 201);
    expectStatus("transition verify", await addTransition({ fromStepCode: "DONE", toStepCode: "CLOSED", actionCode: "verify", name: "Verify" }), 201);

    for (const stepCode of ["PLANNED", "IN_PROGRESS", "DONE"]) {
      expectStatus(
        `assignment rule ${stepCode}`,
        await post(`/workflow/definitions/${WORKFLOW_CODE}/versions/1/assignment-rules`, adminToken, {
          stepCode,
          assignmentType: "role",
          roleCode: "COORD_OPS",
          organizationUnitStrategy: "tenant",
        }),
        201,
      );
    }

    expectStatus(
      "publish workflow",
      await post(`/workflow/definitions/${WORKFLOW_CODE}/versions/1/publish`, adminToken),
      200,
    );

    // --- 6. Customer + site -----------------------------------------------
    console.log(`[PILOT SEED] Creating pilot customer and site...`);
    const customer = expectStatus(
      "customer",
      await post("/customers", adminToken, { code: "CUST-PILOT", name: "Catering Pilot Client" }),
      201,
    ).json() as { id: string };

    const site = expectStatus(
      "site",
      await post("/sites", adminToken, {
        customerId: customer.id,
        code: "SITE-PILOT",
        name: "Pilot Client Site",
      }),
      201,
    ).json() as { id: string };

    // --- 7. Service definition --------------------------------------------
    console.log(`[PILOT SEED] Creating service definition...`);
    expectStatus(
      "service definition",
      await post("/service-definitions", adminToken, { code: SERVICE_CODE, name: "Catering Pilot Service" }),
      201,
    );

    // --- 8. Catering pack + units + items + valuation ---------------------
    console.log(`[PILOT SEED] Activating catering pack and master data...`);
    await pool.query(
      `INSERT INTO service_pack_activations (tenant_id, pack_code, is_active)
       VALUES ($1, 'catering', true)
       ON CONFLICT (tenant_id, pack_code) DO UPDATE SET is_active = true`,
      [tenantId],
    );

    const kgUnit = (
      await pool.query(
        `INSERT INTO units_of_measure (tenant_id, code, name, base_unit_code, category)
         VALUES ($1, 'KG', 'Kilogram', 'KG', 'mass') RETURNING id`,
        [tenantId],
      )
    ).rows[0];
    const gUnit = (
      await pool.query(
        `INSERT INTO units_of_measure (tenant_id, code, name, base_unit_code, category)
         VALUES ($1, 'G', 'Gram', 'G', 'mass') RETURNING id`,
        [tenantId],
      )
    ).rows[0];
    await pool.query(
      `INSERT INTO unit_conversions (tenant_id, from_unit_id, to_unit_id, factor, effective_from)
       VALUES ($1, $2, $3, 1000::numeric(18,6), '2020-01-01')`,
      [tenantId, kgUnit.id, gUnit.id],
    );

    const riceItem = (
      await pool.query(
        `INSERT INTO items (tenant_id, code, name, unit_of_measure, unit_of_measure_id)
         VALUES ($1, 'RICE-PILOT', 'Rice', 'KG', $2) RETURNING id`,
        [tenantId, kgUnit.id],
      )
    ).rows[0];
    const cookedRiceItem = (
      await pool.query(
        `INSERT INTO items (tenant_id, code, name, unit_of_measure, unit_of_measure_id)
         VALUES ($1, 'COOKED-RICE-PILOT', 'Cooked Rice', 'KG', $2) RETURNING id`,
        [tenantId, kgUnit.id],
      )
    ).rows[0];

    // 100 KG @ 12.000 IDR/KG — the valuation the recipe cost reads.
    await pool.query(
      `INSERT INTO scm_valuation_layers
         (tenant_id, item_id, received_date, original_quantity, remaining_quantity,
          unit_cost, effective_unit_cost, total_value)
       VALUES ($1, $2, $3::date, 100, 100, 12000, 12000, 1200000)`,
      [tenantId, riceItem.id, TODAY],
    );

    // --- 9. Menu + recipe + ingredients -----------------------------------
    console.log(`[PILOT SEED] Creating menu, recipe and ingredients...`);
    expectStatus(
      "menu",
      await post("/catering/menus", adminToken, {
        code: "MENU-PILOT",
        name: "Pilot Lunch Menu",
        effectiveFrom: TODAY,
      }),
      201,
    );

    expectStatus(
      "recipe",
      await post("/catering/recipes", adminToken, {
        code: "RC-PILOT",
        name: "Cooked Rice Recipe",
        outputItemId: cookedRiceItem.id,
        outputQuantity: "2",
        outputUnitCode: "KG",
        effectiveFrom: TODAY,
      }),
      201,
    );

    expectStatus(
      "recipe ingredients",
      await app.inject({
        method: "PUT",
        url: "/catering/recipes/RC-PILOT/ingredients",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { ingredients: [{ itemId: riceItem.id, quantity: "500", unitCode: "G" }] },
      }),
      200,
    );

    const costing = expectStatus(
      "recipe cost",
      await post("/catering/recipes/RC-PILOT/cost", adminToken, { onDate: TODAY }),
      200,
    ).json() as { totalCost: string };
    console.log(`[PILOT SEED] Recipe cost per portion: ${costing.totalCost} (expected 6000.000000)`);

    // --- 10. Accounting foundation ----------------------------------------
    // Migrations seed these per existing tenant only; a brand-new tenant gets
    // its own period, COA, accounts and posting rules here.
    console.log(`[PILOT SEED] Creating accounting foundation...`);
    // Kernel actor is a service account: it never logs in. Store a real bcrypt
    // hash of an unguessable throwaway secret (never printed, never recorded)
    // instead of a placeholder, so the row can never be authenticated.
    const kernelActorHash = await hashPassword(randomBytes(32).toString("base64url"));
    const systemUser = (
      await pool.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name)
         VALUES ($1, $2, $3, 'Accounting Kernel Actor') RETURNING id`,
        [tenantId, `kernel-actor@pilot.local`, kernelActorHash],
      )
    ).rows[0];

    const period = (
      await pool.query(
        `INSERT INTO accounting_periods
           (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name,
            period_type, date_from, date_to, status, created_by)
         VALUES ($1, $2, 'FY2026', 'OCT-2026', 'Oktober 2026', 'monthly',
                 '2026-10-01', '2026-10-31', 'open', $3) RETURNING id`,
        [tenantId, legalEntityId, systemUser.id],
      )
    ).rows[0];

    const coa = (
      await pool.query(
        `INSERT INTO chart_of_accounts
           (tenant_id, legal_entity_id, coa_version_code, coa_version_date, is_active, created_by)
         VALUES ($1, $2, 'FY2026', '2026-01-01', true, $3) RETURNING id`,
        [tenantId, legalEntityId, systemUser.id],
      )
    ).rows[0];

    const accounts = [
      { code: "1210", name: "Accounts Receivable", class: "ASSET", normalBalance: "debit" },
      { code: "2410", name: "Tax Payable", class: "LIABILITY", normalBalance: "credit" },
      { code: "2500", name: "Accrued WO Cost", class: "LIABILITY", normalBalance: "credit" },
      { code: "4100", name: "Service Revenue", class: "INCOME", normalBalance: "credit" },
      { code: "6200", name: "WO Cost", class: "EXPENSE", normalBalance: "debit" },
    ];
    for (const acc of accounts) {
      await pool.query(
        `INSERT INTO accounting_accounts
           (tenant_id, legal_entity_id, coa_id, account_code, account_name,
            account_class, normal_balance, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
        [tenantId, legalEntityId, coa.id, acc.code, acc.name, acc.class, acc.normalBalance, systemUser.id],
      );
    }

    const rules = [
      {
        code: "RULE_WO_COST_ACCUMULATED",
        name: "WO Cost Accumulated",
        trigger: "work_order.cost_accumulated",
        legs: [
          { accountCode: "6200", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "2500", side: "credit", amountExpression: "AMOUNT" },
        ],
      },
      {
        code: "RULE_WO_INVOICED",
        name: "WO Invoiced",
        trigger: "work_order.invoiced",
        legs: [
          { accountCode: "1210", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4100", side: "credit", amountExpression: "AMOUNT" },
        ],
      },
      {
        code: "RULE_WO_INVOICE_TAX",
        name: "WO Invoice Tax",
        trigger: "work_order.invoice_tax",
        legs: [
          { accountCode: "1210", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "2410", side: "credit", amountExpression: "AMOUNT" },
        ],
      },
    ];
    for (const rule of rules) {
      await pool.query(
        `INSERT INTO posting_rules
           (tenant_id, rule_code, rule_name, rule_version, trigger_event_type,
            accounting_formula, requires_approval, effective_date, is_active)
         VALUES ($1, $2, $3, 'v1', $4, $5::jsonb, false, '2026-01-01', true)`,
        [tenantId, rule.code, rule.name, rule.trigger, JSON.stringify(rule.legs)],
      );
    }

    // --- 11. Tenant markup (15%) ------------------------------------------
    const markupParam = (
      await pool.query(`SELECT id FROM app_parameters WHERE code = $1`, [MARKUP_PARAM])
    ).rows[0];
    if (!markupParam) {
      throw new Error(`app_parameter '${MARKUP_PARAM}' not found — run migrations first`);
    }
    await pool.query(
      `INSERT INTO app_parameter_values (tenant_id, parameter_id, level, client_scope_id, value, updated_by)
       VALUES ($1, $2, 'S', NULL, '0.15'::jsonb, NULL)`,
      [tenantId, markupParam.id],
    );

    // --- 12. Verification: print the counts the operator screenshots -------
    console.log(`\n[PILOT SEED] Verifying seeded state...`);
    const counts = await pool.query(
      `SELECT
         (SELECT count(*) FROM users WHERE tenant_id = $1) AS users,
         (SELECT count(*) FROM roles WHERE tenant_id = $1) AS roles,
         (SELECT count(*) FROM accounting_accounts WHERE tenant_id = $1) AS gl_accounts,
         (SELECT count(*) FROM posting_rules WHERE tenant_id = $1) AS posting_rules,
         (SELECT count(*) FROM accounting_periods WHERE tenant_id = $1 AND status = 'open') AS open_periods,
         (SELECT count(*) FROM service_pack_activations WHERE tenant_id = $1 AND is_active) AS active_packs,
         (SELECT count(*) FROM items WHERE tenant_id = $1) AS items,
         (SELECT count(*) FROM catering_recipes WHERE tenant_id = $1) AS recipes`,
      [tenantId],
    );
    const c = counts.rows[0];

    console.log(`
============================================================
 CATERING PILOT SEED — COMPLETE
============================================================
 Tenant code       : ${PILOT_TENANT_CODE}
 Tenant id         : ${tenantId}
 Legal entity id   : ${legalEntityId}
 Customer id       : ${customer.id}
 Site id           : ${site.id}
 Period id         : ${period.id}  (Oktober 2026, open)
 Recipe cost/portion: ${costing.totalCost} IDR
------------------------------------------------------------
 users=${c.users}  roles=${c.roles}  gl_accounts=${c.gl_accounts}
 posting_rules=${c.posting_rules}  open_periods=${c.open_periods}
 active_packs=${c.active_packs}  items=${c.items}  recipes=${c.recipes}
------------------------------------------------------------
 Login accounts (tenantCode=${PILOT_TENANT_CODE}):
   ${ADMIN_EMAIL}     (admin)
${PILOT_USERS.map((u) => `   ${u.email}     (${u.roleCode})`).join("\n")}

 ⚠  Passwords supplied via PILOT_ADMIN_PASSWORD / PILOT_USER_PASSWORD env.
 ⚠  Rotate credentials before the pilot opens.
 ⚠  Next: operator runs the 29 UAT transactions through the API.
============================================================
`);
  } catch (err) {
    console.error(`[PILOT SEED] FAILED:`, err);
    await app.close();
    await pool.end();
    process.exit(1);
  }

  await app.close();
  await pool.end();
}

main();
