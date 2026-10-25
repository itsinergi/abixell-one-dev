exports.up = (pgm) => {
  pgm.dropConstraint("finance_depreciation_runs", "finance_dep_runs_period_unique");
  pgm.createIndex(
    "finance_depreciation_runs",
    ["tenant_id", "legal_entity_id", "book_code", "period_id"],
    {
      name: "finance_dep_runs_period_unique",
      unique: true,
      where: "reverses_run_id IS NULL",
    },
  );
};

exports.down = (pgm) => {
  pgm.dropIndex("finance_depreciation_runs", ["tenant_id", "legal_entity_id", "book_code", "period_id"], {
    name: "finance_dep_runs_period_unique",
  });
  pgm.addConstraint("finance_depreciation_runs", "finance_dep_runs_period_unique", {
    unique: ["tenant_id", "legal_entity_id", "book_code", "period_id"],
  });
};
