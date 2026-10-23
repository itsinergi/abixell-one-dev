/**
 * FASE 1 driver — the 29 UAT-014 pilot transactions against the LIVE API.
 *
 * Complements `seed-pilot-catering.ts` (FASE 0 item 3): the seed builds
 * foundation data only; this runs the transactions an operator would, so the
 * outbox events and GL journals flow through the real consumer rather than
 * being seeded as finished rows.
 *
 * Split per the staging runbook: UAT-014-01 ×20, UAT-014-02 ×3,
 * UAT-014-03 ×3, UAT-014-04 ×3 = 29 work orders, each a full
 * catering → WO → accept → cost → GL → invoice → AR chain.
 *
 * Usage (API server must be running):
 *   PILOT_USER_PASSWORD=... API_BASE=http://localhost:4010 npm run fase1:pilot -w apps/api
 */
import "dotenv/config";
import pg from "pg";

const API_BASE = process.env.API_BASE ?? "http://localhost:4010";
const TENANT_CODE = "UNIT-CAT-PILOT-01";
const PILOT_PASSWORD = process.env.PILOT_USER_PASSWORD;
const ADMIN_PASSWORD = process.env.PILOT_ADMIN_PASSWORD;

if (!PILOT_PASSWORD || !ADMIN_PASSWORD) {
  console.error("[FASE 1] ABORT: PILOT_USER_PASSWORD and PILOT_ADMIN_PASSWORD must be set.");
  process.exit(2);
}

type ChainResult = {
  scenario: string;
  index: number;
  woNumber: string;
  invoiceNumber: string | null;
  costTotal: number;
  invoiceTotal: number | null;
};

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantCode: TENANT_CODE, email, password }),
  });
  if (!res.ok) throw new Error(`login ${email} failed: ${res.status} ${await res.text()}`);
  return (await res.json()).accessToken as string;
}

function auth(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function api(
  method: string,
  path: string,
  token: string,
  payload: unknown = {},
  expected = 200,
): Promise<{ statusCode: number; json: () => Promise<any> }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: auth(token),
    body: method === "GET" ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  if (res.status !== expected) {
    throw new Error(`${method} ${path} expected ${expected}, got ${res.status} — ${text.slice(0, 500)}`);
  }
  return {
    statusCode: res.status,
    json: async () => (text ? JSON.parse(text) : {}),
  };
}

async function main() {
  console.log(`[FASE 1] Target ${API_BASE} tenant ${TENANT_CODE}`);

  const adminToken = await login("admin@pilot.local", ADMIN_PASSWORD!);
  const coordToken = await login("coord@pilot.local", PILOT_PASSWORD!);
  const execToken = await login("exec@pilot.local", PILOT_PASSWORD!);
  const verifyToken = await login("verify@pilot.local", PILOT_PASSWORD!);
  const billToken = await login("bill@pilot.local", PILOT_PASSWORD!);
  console.log("[FASE 1] Logged in 5 pilot accounts.");

  // Stable references from the seed (DB is the source of truth for IDs).
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const tid = (await pool.query(`SELECT id FROM tenants WHERE code = $1`, [TENANT_CODE])).rows[0]?.id;
  if (!tid) throw new Error(`tenant ${TENANT_CODE} not found — run seed:pilot first`);

  const customerId = (await pool.query(
    `SELECT id FROM customers WHERE tenant_id = $1 AND code = 'CUST-PILOT'`, [tid],
  )).rows[0]?.id;
  const execUserId = (await pool.query(
    `SELECT id FROM users WHERE tenant_id = $1 AND email = 'exec@pilot.local'`, [tid],
  )).rows[0]?.id;
  const legalEntityId = (await pool.query(
    `SELECT id FROM legal_entities WHERE tenant_id = $1 LIMIT 1`, [tid],
  )).rows[0]?.id;
  if (!customerId || !execUserId || !legalEntityId) {
    throw new Error(`seed references missing: customer=${customerId} exec=${execUserId} le=${legalEntityId}`);
  }
  console.log(`[FASE 1] tenant=${tid} customerId=${customerId} execUserId=${execUserId} legalEntityId=${legalEntityId}`);

  /** One full DEC-009 chain: WO lifecycle → accept → cost → finalize → invoice. */
  async function chain(scenario: string, index: number, costAmount: number): Promise<ChainResult> {
    const title = `${scenario} #${index} — pilot catering batch`;
    const wo = await api("POST", "/work-orders", coordToken, {
      customerId,
      serviceDefinitionCode: "catering_pilot_service",
      title,
    }, 201);
    const woId = (await wo.json()).id;
    const woNumber = (await (await fetch(`${API_BASE}/work-orders/${woId}`, { headers: auth(coordToken) })).json()).number
      ?? woId;

    await api("POST", `/work-orders/${woId}/assign`, coordToken, { assigneeUserId: execUserId });
    await api("POST", `/work-orders/${woId}/actions/start`, coordToken);
    await api("POST", `/work-orders/${woId}/start`, execToken);
    await api("POST", `/work-orders/${woId}/complete`, execToken);
    await api("POST", `/work-orders/${woId}/actions/complete`, coordToken);
    await api("POST", `/work-orders/${woId}/verify`, verifyToken);
    await api("POST", `/work-orders/${woId}/customer-accept`, verifyToken);

    // 3 cost lines totalling costAmount (material / labor / overhead).
    const material = Math.round(costAmount * 0.6 * 100) / 100;
    const labor = Math.round(costAmount * 0.3 * 100) / 100;
    const overhead = Math.round((costAmount - material - labor) * 100) / 100;
    await api("POST", `/work-orders/${woId}/cost-items`, coordToken, { costType: "material", quantity: "1", unitCost: String(material) }, 201);
    await api("POST", `/work-orders/${woId}/cost-items`, coordToken, { costType: "labor", quantity: "1", unitCost: String(labor) }, 201);
    await api("POST", `/work-orders/${woId}/cost-items`, coordToken, { costType: "overhead", quantity: "1", unitCost: String(overhead) }, 201);

    const fin = await api("POST", `/work-orders/${woId}/finalize-costs`, verifyToken, { legalEntityId });
    const finBody = await fin.json();
    if (!finBody.outboxEventEmitted) {
      throw new Error(`${scenario} #${index}: finalize-costs did not emit an outbox event`);
    }

    const inv = await api("POST", `/work-orders/${woId}/create-invoice`, billToken, {
      legalEntityId,
      isTaxable: true,
    }, 201);
    const invoice = (await inv.json()).invoice;
    return {
      scenario,
      index,
      woNumber: String(woNumber),
      invoiceNumber: invoice?.invoiceNumber ?? null,
      costTotal: Number(finBody.costsTotal),
      invoiceTotal: invoice ? Number(invoice.totalAmount) : null,
    };
  }

  const results: ChainResult[] = [];
  // Scenario amounts are synthetic and varied per run so 29 chains are
  // distinguishable in the GL evidence. The chain shape is the WP-VER-01 one.
  const plan: Array<{ scenario: string; count: number; base: number }> = [
    { scenario: "UAT-014-01", count: 20, base: 75000 },
    { scenario: "UAT-014-02", count: 3, base: 48000 },
    { scenario: "UAT-014-03", count: 3, base: 112000 },
    { scenario: "UAT-014-04", count: 3, base: 260000 },
  ];

  for (const p of plan) {
    for (let i = 1; i <= p.count; i++) {
      const cost = p.base + i * 1000;
      const r = await chain(p.scenario, i, cost);
      results.push(r);
      console.log(
        `[FASE 1] ${p.scenario} #${i}  wo=${r.woNumber}  cost=${r.costTotal}  inv=${r.invoiceNumber}  total=${r.invoiceTotal}`,
      );
    }
  }

  console.log(`[FASE 1] ${results.length} chains done. Draining accounting outbox...`);
  const trigger = await api("POST", "/scheduler/jobs/accounting-event-poster/trigger", adminToken);
  console.log(`[FASE 1] consumer: ${JSON.stringify(await trigger.json())}`);

  // --- GL / AR evidence -------------------------------------------------
  const journals = await pool.query(
    `SELECT jh.journal_number, jh.status, aa.account_code,
            CASE WHEN jl.debit > 0 THEN 'D' ELSE 'C' END AS side,
            GREATEST(jl.debit, jl.credit) AS amount
     FROM journal_headers jh
     JOIN journal_lines jl ON jl.journal_header_id = jh.id
     JOIN accounting_accounts aa ON aa.id = jl.account_id
     WHERE jh.tenant_id = $1 AND jh.status = 'posted'
     ORDER BY jh.journal_number, aa.account_code`,
    [tid],
  );
  const invoices = await pool.query(
    `SELECT invoice_number, base_amount, tax_amount, total_amount
     FROM customer_invoices WHERE tenant_id = $1 ORDER BY invoice_number`,
    [tid],
  );
  const events = await pool.query(
    `SELECT event_type, outbox_state, reconciliation_state, count(*)::int AS n
     FROM scm_accounting_ready_events WHERE tenant_id = $1
     GROUP BY 1,2,3 ORDER BY 1`,
    [tid],
  );

  const dr = journals.rows.filter((r) => r.side === "D").reduce((s, r) => s + Number(r.amount), 0);
  const cr = journals.rows.filter((r) => r.side === "C").reduce((s, r) => s + Number(r.amount), 0);
  console.log("\n[FASE 1] ===== GL SUMMARY =====");
  console.log(`posted journals: ${new Set(journals.rows.map((r) => r.journal_number)).size}`);
  console.log(`journal lines:   ${journals.rows.length}`);
  console.log(`total debit:     ${dr}`);
  console.log(`total credit:    ${cr}`);
  console.log(`balanced:        ${Math.abs(dr - cr) < 0.005 ? "YES" : "NO — MISMATCH " + (dr - cr)}`);
  console.log(`invoices:        ${invoices.rows.length}`);
  console.log(`invoice total:   ${invoices.rows.reduce((s, r) => s + Number(r.total_amount), 0)}`);
  console.log("\n[FASE 1] ===== EVENT STATES =====");
  for (const r of events.rows) console.log(` ${r.event_type}  ${r.outbox_state}/${r.reconciliation_state}  x${r.n}`);

  console.log("\n[FASE 1] ===== PER-CHAIN =====");
  for (const r of results) {
    console.log(`${r.scenario} #${String(r.index).padStart(2)}  ${r.woNumber}  cost=${r.costTotal}  inv=${r.invoiceNumber}  total=${r.invoiceTotal}`);
  }

  if (results.length !== 29) throw new Error(`expected 29 chains, got ${results.length}`);
  if (Math.abs(dr - cr) >= 0.005) throw new Error("GL does not balance");
  console.log("\n[FASE 1] PASS — 29 chains, GL balanced, outbox drained.");

  await pool.end();
}

main().catch((err) => {
  console.error("[FASE 1] FAIL:", err.message ?? err);
  process.exit(1);
});
