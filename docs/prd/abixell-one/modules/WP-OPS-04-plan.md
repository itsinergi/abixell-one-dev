# WP-OPS-04 — Deferred KPI Plan (Delivery Accuracy, Complaint Rate, SLA Achievement)

Status: NOT STARTED. Planning only — scope for the 3 KPIs deferred from
SO-CORE-017 (see WORK-ORDER-GUIDE.md KPI gap audit, 2026-10-30).

## 1. Delivery Accuracy (received / dispatched × 100%)

**Gap:** `work_order_serving_logs` has `received_qty` but no `dispatched_qty`.
Distribution (Kitchen → Mess A → Mess B) is not tracked as a distinct step.

**Scope:**
- New table `work_order_dispatch_logs`: `dispatch_number`, `origin_kitchen_id`,
  `destination_site_id`, `meal_type`, `dispatch_qty`, `dispatch_time`,
  `received_qty`, `received_time`, `driver_id`, `temperature`, `condition`
  (enum: `good`/`damaged`/`late`), evidence attachment ref.
- `work_order_serving_logs.dispatch_log_id` FK (nullable — not every WO has
  multi-leg distribution; direct-serve WOs skip this).
- Service method `recordDispatch()` + `confirmReceipt()` (two-sided, mirrors
  serving's received/served split).
- KPI query: `SUM(received_qty) / SUM(dispatch_qty) * 100` grouped by period.

**Effort estimate:** ~20 points (1 migration, 1 entity, ~6 repo methods,
2-3 service methods, 2 routes, tests).

## 2. Complaint Rate (complaints / served × 1000)

**Gap:** `complaints.service_id` → `services` table, not `work_order_id`.
No way to join a complaint back to the specific WO that produced the meal.

**Scope (pick one):**
- **Option A (minimal):** Add `complaints.work_order_id` nullable FK. Filing
  a complaint against catering optionally tags the WO. KPI then joins
  `complaints` ⋈ `work_order_serving_logs` on `work_order_id`.
- **Option B (no schema change):** Keep `service_id` as-is; resolve WO via
  `work_orders.service_definition_id` + `customer_id` + date-range heuristic.
  Rejected — heuristic joins are fragile and wrong when multiple WOs serve
  the same customer same day.
- **Recommendation: Option A.** One nullable column, one index, no
  behavior change to existing complaint flows.

**Effort estimate:** ~8 points (1 migration column + index, 1 service method
touch-up on complaint creation to accept optional `workOrderId`, KPI query).

## 3. SLA Achievement (SLA-compliant services / total × 100%)

**Gap:** `service_sla_policies` + `service_sla_rules` exist (Wave A1) and
bind to complaints via the generic calendar/SLA engine, but nothing binds
an SLA policy to a Work Order's own lifecycle (planned vs actual completion
time).

**Scope:**
- Reuse `service_sla_policies` — do NOT duplicate SLA infrastructure.
- Add `work_orders.sla_policy_id` nullable FK (set at creation, from the
  Service Definition's default policy if configured).
- "Compliant" = `completed_at <= planned_end_at` when both are set, else
  fall back to the SLA policy's calendar-resolved deadline from `started_at`.
- KPI query: `COUNT(*) WHERE compliant) / COUNT(*) * 100`.

**Effort estimate:** ~12 points (1 migration column, resolution logic in
`completeWork()`, 1 repo query, KPI wiring).

## Sequencing

Recommended order: **Complaint Rate (8pt) → SLA Achievement (12pt) →
Delivery Accuracy (20pt)** — cheapest/lowest-risk first, Delivery Accuracy
last since it's the only one needing a brand-new entity (dispatch logs)
rather than a column + join on existing tables.

**Total: ~40 points.** Not started; this document is the plan only.
