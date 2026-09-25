/**
 * Epic 2 Wave 1: lock the complete structured field-rule operator set.
 *
 * The original foundation migration seeded seven operators. Wave 1 now
 * locks `notIn` and `isNull` too; update the registry in a separate,
 * idempotent migration so databases that already ran the foundation receive
 * the same contract as fresh installs.
 */

const RULE_OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "isNull"];

/** Path to the operator enum inside the stored rules_definition schema. */
const OPERATOR_PATH = [
  "properties",
  "rules",
  "items",
  "properties",
  "conditions",
  "properties",
  "rules",
  "items",
  "properties",
  "operator",
];

/** Read the stored schema, swap only the operator enum, write it back.
 *  Idempotent: re-running with the same enum is a no-op write and a no-op
 *  outcome. Missing row or unexpected shape leaves the registry untouched
 *  rather than inventing a schema. */
async function setOperatorEnum(pgm, operators) {
  const current = await pgm.db.query(
    `SELECT json_schema
       FROM metadata_registry
      WHERE area = 'app_field_rules'
        AND key = 'rules_definition'`,
  );
  if (current.rows.length === 0) return;

  const schema = current.rows[0].json_schema;
  const operatorSchema = OPERATOR_PATH.reduce((node, key) => {
    if (!node || typeof node !== "object") return undefined;
    return node[key];
  }, schema);
  if (!operatorSchema || typeof operatorSchema !== "object") return;
  operatorSchema.enum = operators;

  await pgm.db.query(
    `UPDATE metadata_registry
        SET json_schema = $1
      WHERE area = 'app_field_rules'
        AND key = 'rules_definition'`,
    [JSON.stringify(schema)],
  );
}

exports.up = async (pgm) => {
  await setOperatorEnum(pgm, RULE_OPERATORS);
};

exports.down = async (pgm) => {
  await setOperatorEnum(pgm, ["eq", "neq", "gt", "gte", "lt", "lte", "in"]);
};
