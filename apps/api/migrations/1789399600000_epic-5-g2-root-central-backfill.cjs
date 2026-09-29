/**
 * Epic 5 Gelombang 2 (§4.5 Putaran 4, root Central) — the legacy root Central
 * backfill the G1 handoff carried into this wave.
 *
 * §4.5 Putaran 4: "Setiap Legal Entity wajib memiliki tepat satu root
 * Organization Unit bernama Central." `1789385000000` enforced that for every
 * Legal Entity created THROUGH the API from Gelombang 1 on (the creation path
 * inserts the Legal Entity and its Central in one governed transaction) and
 * deliberately did not touch the Legal Entities that already existed, because a
 * migration that rewrites legacy organisation data was not that wave's call.
 *
 * What G2 measured on the live database (read-only census, evidence in the task
 * report — `abixell_one_dev` is never written by a migration):
 *
 *   live Legal Entities                                  309
 *   ... without ANY parentless live unit                   0
 *   ... with two or more parentless live units            45
 *   live units named 'Central'                             0
 *   live unit_type census        458 'Organization Unit', 20 'department',
 *                                 1 'Head Office', 1 'Site'
 *
 * So the gap is not a missing root: it is that NOT ONE of the 309 Legal Entities
 * has a root NAMED Central. This migration closes exactly that, and nothing else:
 *
 *   - It INSERTs one `Central` root for every live Legal Entity that has no live
 *     unit named `Central`. Purely additive — no UPDATE, no DELETE, no existing
 *     row's `parent_id`, `unit_type` or `name` is touched.
 *   - It does NOT re-parent the legacy parentless units. Those 45 Legal Entities
 *     that already had two parentless units keep them PLUS the new Central, and
 *     the other 264 keep their single legacy root plus the new Central — measured
 *     AFTER the backfill on the legacy clone: 309 live Legal Entities, 309 Central
 *     roots, and all 309 still holding more than one parentless unit. Attaching
 *     their legacy units under the new Central would REWRITE the organisation
 *     structure of a live tenant, which is a Founder decision, not a migration's.
 *     The consequence is stated here and in the task report rather than hidden:
 *     "has a Central" is now true for all 309, and "and only one parentless unit"
 *     is still open for all of them until the legacy roots are re-parented.
 *   - Every inserted row is audited (`organization_unit.central_backfilled`)
 *     inside the same statement, so the backfill is explainable from the audit
 *     log alone — the same standard every other structure write in this wave is
 *     held to.
 *
 * Idempotent by construction: the INSERT selects only Legal Entities with no
 * Central root, so a second run inserts nothing. `down` removes only the rows
 * this migration could have created, identified by the matching audit rows.
 *
 * Stamp: the next free slot below Wave 3's reserved M10 (1789400000000) and above
 * this wave's existing content stamps — see 1789399500000 for the stamp policy.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      inserted integer;
      offenders integer;
    BEGIN
      SELECT count(*) INTO offenders
        FROM (
          SELECT ou.legal_entity_id
            FROM organization_units ou
            JOIN legal_entities le ON le.id = ou.legal_entity_id AND le.deleted_at IS NULL
           WHERE ou.parent_id IS NULL AND ou.deleted_at IS NULL
           GROUP BY ou.legal_entity_id
          HAVING count(*) > 1
        ) d;

      RAISE NOTICE
        'Epic 5 G2 root Central backfill: Legal Entities that will keep more than one parentless unit (legacy shape, NOT re-parented): %',
        offenders;
    END
    $$;

    WITH missing AS (
      SELECT le.id, le.tenant_id
        FROM legal_entities le
       WHERE le.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM organization_units ou
            WHERE ou.legal_entity_id = le.id
              AND ou.deleted_at IS NULL
              AND ou.unit_type = 'Central'
         )
    ), created AS (
      INSERT INTO organization_units
        (tenant_id, legal_entity_id, parent_id, name, unit_type, unit_type_label,
         status, is_active, timezone, created_at, updated_at)
      SELECT m.tenant_id, m.id, NULL, 'Central', 'Central', NULL,
             'active', true, NULL, now(), now()
        FROM missing m
      RETURNING id, tenant_id
    )
    INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
    SELECT c.tenant_id, NULL, 'organization_unit.central_backfilled',
           'organization_unit', c.id,
           jsonb_build_object(
             'reason', 'Epic 5 G2 §4.5 Putaran 4 — every Legal Entity has a root Central',
             'migration', '1789399600000_epic-5-g2-root-central-backfill',
             'rewritesLegacyStructure', false
           )
      FROM created c;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM organization_units ou
     USING audit_log al
     WHERE al.entity_type = 'organization_unit'
       AND al.entity_id = ou.id
       AND al.action = 'organization_unit.central_backfilled';
  `);
};
