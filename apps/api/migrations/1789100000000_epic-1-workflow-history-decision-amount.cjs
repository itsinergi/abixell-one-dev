/**
 * Epic 1 (§4.1 D) — the accumulation window's data source.
 *
 * iDempiere's `getAmtAccum` (MWFActivity.java:854+) counts amounts the user
 * has approved on the SAME table within the window. The product has no
 * per-table IsApproved columns; its single decision ledger is
 * `workflow_history`, so the approved amount must be carried ON the history
 * row or there is nothing to sum.
 *
 * The amount is plumbed from the instance's `contextData` (`totalAmount`,
 * `approvedAmount`, or `amount` — the conventions complaint and sales
 * workflows already write) at the moment the engine records an 'approve'
 * decision. Rows for other actions and system rows stay NULL so the SUM
 * counts exactly the approve decisions.
 *
 * numeric(18,2) string, same money discipline as 1767000000000. Down drops
 * the column; nothing else reads it yet.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE workflow_history
      ADD COLUMN decision_amount NUMERIC(18,2);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE workflow_history DROP COLUMN IF EXISTS decision_amount;
  `);
};
