import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  collectPlatformBoundaryFiles,
  extractImports,
  extractPermissionDeclarations,
  extractTableDeclarations,
  formatValidationReport,
  normalizeRepoPath,
  normalizedSha256,
  validateImportBoundaries,
  validateMigrations,
  validatePermissions,
  validatePlatformBoundaries,
  validateRoleAuthorization,
  validateUnsafeRuntime,
} from "./lib/platform-boundary-validator.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function files(record) {
  return new Map(Object.entries(record));
}

function reasons(findings) {
  return findings.map((entry) => entry.reason);
}

function migration(body, down = "") {
  return `
exports.up = (pgm) => {
${body}
};
exports.down = (pgm) => {
${down}
};
`;
}

function pgmDirectTable(table = "widgets") {
  return `pgm.createTable("${table}", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "CASCADE",
    },
  });`;
}

function validateNewMigrations(record) {
  return validateMigrations(files(record), { baselineDigests: new Map() });
}

test("normalizes Windows and repository-relative paths", () => {
  assert.equal(normalizeRepoPath(".\\apps\\api\\src\\app.ts"), "apps/api/src/app.ts");
  assert.equal(normalizeRepoPath("./apps/web/src/App.tsx"), "apps/web/src/App.tsx");
});

test("normalizes line endings before hashing", () => {
  assert.equal(normalizedSha256("one\r\ntwo\rthree\n"), normalizedSha256("one\ntwo\nthree\n"));
});

test("extracts multiline type imports and API .js paths resolve to TypeScript", () => {
  const source = `import type {\n  CustomerService,\n} from "../../customer.service.js";`;
  assert.deepEqual(extractImports(source)[0], {
    kind: "import",
    specifier: "../../customer.service.js",
    typeOnly: true,
    symbols: ["CustomerService"],
    aliases: false,
    line: 1,
    index: 0,
  });

  const result = validateImportBoundaries(files({
    "apps/api/src/modules/alpha/core/application/alpha.ts": source,
    "apps/api/src/modules/customer.service.ts": "export class CustomerService {}",
  }), { apiExceptions: [] });
  assert.equal(result.apiFindings.length, 0);
});

test("blocks API and Web cross-module implementation imports", () => {
  const result = validateImportBoundaries(files({
    "apps/api/src/modules/alpha/core/application/alpha.ts": 'import { Beta } from "../../../beta/core/application/beta.js";',
    "apps/api/src/modules/beta/core/application/beta.ts": "export class Beta {}",
    "apps/web/src/modules/alpha/Alpha.tsx": 'import { Beta } from "../beta/Beta";',
    "apps/web/src/modules/beta/Beta.tsx": "export function Beta() { return null; }",
  }), { apiExceptions: [] });

  assert.equal(result.apiFindings.length, 1);
  assert.match(result.apiFindings[0].reason, /imports beta internals/);
  assert.equal(result.webFindings.length, 1);
  assert.match(result.webFindings[0].reason, /imports beta implementation/);
});

test("permits only exact API and Web composition roots", () => {
  const result = validateImportBoundaries(files({
    "apps/api/src/app.ts": 'import { registerAlphaRoutes } from "./modules/alpha/core/api/alpha.routes.js";',
    "apps/api/src/composition-root.ts": 'import { AlphaService } from "./modules/alpha/core/application/alpha.service.js";',
    "apps/api/src/other.ts": 'import { AlphaService } from "./modules/alpha/core/application/alpha.service.js";',
    "apps/api/src/modules/alpha/core/api/alpha.routes.ts": "export const registerAlphaRoutes = () => {};",
    "apps/api/src/modules/alpha/core/application/alpha.service.ts": "export class AlphaService {}",
    "apps/web/src/App.tsx": 'import { Alpha } from "./modules/alpha/Alpha";',
    "apps/web/src/shell/Shell.tsx": 'import { Alpha } from "../modules/alpha/Alpha";',
    "apps/web/src/modules/alpha/Alpha.tsx": "export function Alpha() { return null; }",
  }), { apiExceptions: [] });

  assert.equal(result.apiFindings.length, 1);
  assert.equal(result.apiFindings[0].file, "apps/api/src/other.ts");
  assert.equal(result.webFindings.length, 1);
  assert.equal(result.webFindings[0].file, "apps/web/src/shell/Shell.tsx");
});

test("usage-counts exact exceptions and rejects widening", () => {
  const exception = {
    id: "alpha-container",
    source: "apps/api/src/modules/alpha/core/api/alpha.routes.ts",
    target: "apps/api/src/composition-root.ts",
    symbols: ["Container"],
    typeOnly: true,
  };
  const target = "export type Container = {};";

  const exact = validateImportBoundaries(files({
    [exception.source]: 'import type { Container } from "../../../../composition-root.js";',
    [exception.target]: target,
  }), { apiExceptions: [exception] });
  assert.equal(exact.apiFindings.length, 0);

  const widened = validateImportBoundaries(files({
    [exception.source]: 'import { Container } from "../../../../composition-root.js";',
    [exception.target]: target,
  }), { apiExceptions: [exception] });
  assert.match(reasons(widened.apiFindings).join("\n"), /is widened/);

  const stale = validateImportBoundaries(files({ [exception.target]: target }), { apiExceptions: [exception] });
  assert.match(reasons(stale.apiFindings).join("\n"), /matched 0 times/);
});

test("blocks new imports into classified legacy business internals", () => {
  const result = validateImportBoundaries(files({
    "apps/api/src/modules/alpha/core/application/alpha.ts": 'import { CustomerRepo } from "../../../../application/customer/customer.repo.js";',
    "apps/api/src/application/customer/customer.repo.ts": "export class CustomerRepo {}",
  }), { apiExceptions: [] });
  assert.match(reasons(result.apiFindings).join("\n"), /legacy business internals/);
});

test("extracts pgm and raw SQL table declarations with balanced bodies", () => {
  const source = migration(`
    ${pgmDirectTable("widgets")}
    pgm.sql(\`
      CREATE TABLE widget_parts (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        check_value TEXT CHECK (check_value IN ('(', ')'))
      );
    \`);
  `);
  const declarations = extractTableDeclarations(source);
  assert.deepEqual(declarations.map((entry) => [entry.table, entry.kind]), [
    ["widgets", "pgm"],
    ["widget_parts", "sql"],
  ]);
});

test("accepts direct tenant ownership in both supported table forms", () => {
  const result = validateNewMigrations({
    "apps/api/migrations/2000000000000_direct.cjs": migration(`
      ${pgmDirectTable("widgets")}
      pgm.sql(\`
        CREATE TABLE widget_parts (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
        );
      \`);
    `),
  });
  assert.deepEqual(result.findings, []);
});

test("verifies inherited tenant ownership recursively", () => {
  const result = validateNewMigrations({
    "apps/api/migrations/2000000000000_inherited.cjs": migration(`
      ${pgmDirectTable("widgets")}
      // platform-boundary: tenant-owner-via widget_id -> widgets
      pgm.createTable("widget_parts", {
        widget_id: { type: "uuid", notNull: true, references: "widgets", onDelete: "CASCADE" },
      });
      // platform-boundary: tenant-owner-via part_id -> widget_parts
      pgm.createTable("widget_notes", {
        part_id: { type: "uuid", notNull: true, references: "widget_parts", onDelete: "CASCADE" },
      });
    `),
  });
  assert.deepEqual(result.findings, []);
});

test("rejects missing, invalid, and cyclic inherited ownership", () => {
  const missing = validateNewMigrations({
    "apps/api/migrations/2000000000000_missing.cjs": migration('pgm.createTable("widgets", { id: { type: "uuid" } });'),
  });
  assert.match(reasons(missing.findings).join("\n"), /needs non-null tenant_id ownership/);

  const invalid = validateNewMigrations({
    "apps/api/migrations/2000000000000_invalid.cjs": migration(`
      // platform-boundary: tenant-owner-via widget_id -> parent_widgets
      pgm.createTable("widgets", {
        widget_id: { type: "uuid", notNull: false, references: "parent_widgets" },
      });
    `),
  });
  assert.match(reasons(invalid.findings).join("\n"), /must be a non-null UUID FK/);

  const cyclic = validateNewMigrations({
    "apps/api/migrations/2000000000000_cycle.cjs": migration(`
      // platform-boundary: tenant-owner-via b_id -> table_b
      pgm.createTable("table_a", {
        b_id: { type: "uuid", notNull: true, references: "table_b", onDelete: "CASCADE" },
      });
      // platform-boundary: tenant-owner-via a_id -> table_a
      pgm.createTable("table_b", {
        a_id: { type: "uuid", notNull: true, references: "table_a", onDelete: "CASCADE" },
      });
    `),
  });
  assert.equal(reasons(cyclic.findings).filter((reason) => /does not resolve acyclically/.test(reason)).length, 2);
});

test("rejects dynamic or unsupported new table declarations", () => {
  const dynamic = validateNewMigrations({
    "apps/api/migrations/2000000000000_dynamic.cjs": migration("pgm.createTable(tableName, { tenant_id: { type: 'uuid' } });"),
  });
  assert.match(reasons(dynamic.findings).join("\n"), /literal pgm\.createTable name/);

  const interpolated = validateNewMigrations({
    "apps/api/migrations/2000000000000_interpolated.cjs": migration("pgm.sql(`CREATE TABLE ${tableName} (tenant_id uuid)`);"),
  });
  assert.ok(interpolated.findings.length > 0);
});

test("rejects historical migration mutation after EOL normalization", () => {
  const original = migration(pgmDirectTable("widgets"));
  const digest = normalizedSha256(original);
  const baseline = new Map([["2000000000000_widgets.cjs", digest]]);
  const same = validateMigrations(files({
    "apps/api/migrations/2000000000000_widgets.cjs": original.replaceAll("\n", "\r\n"),
  }), { baselineDigests: baseline });
  assert.deepEqual(same.findings, []);

  const changed = validateMigrations(files({
    "apps/api/migrations/2000000000000_widgets.cjs": `${original}\n// changed`,
  }), { baselineDigests: baseline });
  assert.match(reasons(changed.findings).join("\n"), /baseline migration changed/);
});

test("extracts permission declarations from historical insert shapes", () => {
  const source = migration(`
    pgm.sql(\`
      INSERT INTO permissions (code, description) VALUES
        ('alpha.read', 'Read alpha');
      INSERT INTO permissions (code, description)
      SELECT v.code, v.description FROM (VALUES
        ('alpha.write', 'Write alpha')
      ) AS v(code, description)
      WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code);
      INSERT INTO permissions (code, description) VALUES
        ('alpha.manage', 'Manage alpha')
      ON CONFLICT (code) DO NOTHING;
    \`);
  `);
  assert.deepEqual(extractPermissionDeclarations(source).map((entry) => entry.code), [
    "alpha.read",
    "alpha.write",
    "alpha.manage",
  ]);
});

test("enforces strict new permission declaration, idempotency, down symmetry, and role grant rules", () => {
  const file = "apps/api/migrations/2000000000000_permissions.cjs";
  const good = migration(`pgm.sql(\`
    INSERT INTO permissions (code, description) VALUES
      ('alpha.read', 'Read alpha')
    ON CONFLICT (code) DO NOTHING;
  \`);`, `pgm.sql(\`DELETE FROM permissions WHERE code IN ('alpha.read');\`);`);
  const goodResult = validatePermissions(files({ [file]: good }), [file]);
  assert.deepEqual(goodResult.findings, []);

  const bad = migration(`pgm.sql(\`
    INSERT INTO permissions (code, description) VALUES
      ('ALPHA_READ', ''),
      ('alpha.write', 'Write alpha');
    INSERT INTO role_permissions (role_id, permission_id) VALUES ('a', 'b');
  \`);`, `pgm.sql(\`DELETE FROM permissions WHERE code IN ('other.code');\`);`);
  const badResult = validatePermissions(files({ [file]: bad }), [file]);
  const allReasons = reasons(badResult.findings).join("\n");
  assert.match(allReasons, /does not follow/);
  assert.match(allReasons, /nonblank description/);
  assert.match(allReasons, /must be idempotent/);
  assert.match(allReasons, /must not grant tenant roles/);
  assert.match(allReasons, /must delete exactly/);
});

test("checks bounded permission consumers while allowing dynamic expressions", () => {
  const migrationFile = "apps/api/migrations/2000000000000_permissions.cjs";
  const migrationSource = migration(`pgm.sql(\`
    INSERT INTO permissions (code, description) VALUES ('alpha.read', 'Read alpha')
    ON CONFLICT (code) DO NOTHING;
  \`);`, `pgm.sql(\`DELETE FROM permissions WHERE code IN ('alpha.read');\`);`);
  const result = validatePermissions(files({
    [migrationFile]: migrationSource,
    "apps/api/src/modules/alpha/core/application/alpha.ts": `
      await rbac.requirePermission(userId, "alpha.read");
      await rbac.requirePermission(userId, dynamicPermission);
      permissions.has("alpha.missing");
    `,
    "apps/web/src/lib/capabilities.ts": `export const PERMISSIONS = { alphaRead: "alpha.read" } as const;`,
  }), [migrationFile]);
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].reason, /alpha\.missing/);
});

test("blocks runtime permission catalog mutation", () => {
  const result = validatePermissions(files({
    "apps/api/src/application/permission-editor.ts": "await db.query(`UPDATE permissions SET code = $1`);",
  }));
  assert.match(reasons(result.findings).join("\n"), /must not mutate/);
});

test("blocks clear role authorization and advises on ambiguous role comparisons", () => {
  const findings = validateRoleAuthorization(files({
    "apps/api/src/application/authorize.ts": `
      if (session.roleCode === "ADMIN") allow();
      const configured = roleCode === "SUPERVISOR";
      const display = "ADMIN";
    `,
  }));
  assert.equal(findings.filter((entry) => entry.severity === "blocking").length, 1);
  assert.equal(findings.filter((entry) => entry.severity === "advisory").length, 1);
});

test("ignores unsafe primitive names in comments and descriptive strings", () => {
  const findings = validateUnsafeRuntime(files({
    "apps/api/src/application/safe.ts": `
      // eval(userInput); new Function(code); import(moduleName)
      const guidance = "Never use eval() or CREATE TABLE in runtime code";
      import("./static.js");
    `,
  }));
  assert.deepEqual(findings, []);
});

test("blocks unsafe runtime primitives, loaders, dynamic imports, and DDL", () => {
  const findings = validateUnsafeRuntime(files({
    "apps/api/src/application/unsafe.ts": `
      import vm from "node:vm";
      const require = createRequire(import.meta.url);
      eval(source);
      new Function(source);
      import(moduleName);
      require(moduleName);
      loadRuntimePlugin(packageName);
      const ddl = \`ALTER TABLE users ADD COLUMN injected text\`;
    `,
  }));
  const allReasons = reasons(findings).join("\n");
  assert.match(allReasons, /Node VM API/);
  assert.match(allReasons, /Runtime require construction/);
  assert.match(allReasons, /Executable eval/);
  assert.match(allReasons, /Runtime Function construction/);
  assert.match(allReasons, /Non-literal dynamic import/);
  assert.match(allReasons, /Non-literal dynamic require/);
  assert.match(allReasons, /runtime loader\/editor\/script/);
  assert.match(allReasons, /Runtime DDL/);
});

test("does not mistake a literal TypeScript import type query for dynamic loading", () => {
  const findings = validateUnsafeRuntime(files({
    "apps/api/src/interfaces/http/routes/workflow.ts": `
      type Condition = import("../../../domain/workflow/workflow.entity.js").ConditionExpression;
    `,
  }));
  assert.deepEqual(findings, []);
});

test("sorts diagnostics deterministically and keeps manifest readiness advisory nonblocking", () => {
  const virtual = files({
    "apps/web/src/modules/zeta/Zeta.tsx": 'import { Alpha } from "../alpha/Alpha";',
    "apps/web/src/modules/alpha/Alpha.tsx": 'import { Zeta } from "../zeta/Zeta";',
    "apps/api/src/application/unsafe.ts": "eval(source);",
  });
  const options = { apiExceptions: [], baselineDigests: new Map() };
  const first = validatePlatformBoundaries(virtual, options);
  const second = validatePlatformBoundaries(files(Object.fromEntries([...virtual].reverse())), options);
  assert.equal(formatValidationReport(first), formatValidationReport(second));
  assert.equal(first.passed, false);

  const advisoryOnly = validatePlatformBoundaries(new Map(), options);
  assert.equal(advisoryOnly.passed, true);
  assert.equal(advisoryOnly.advisoryCount, 1);
  assert.match(formatValidationReport(advisoryOnly), /ADVISORY manifest-readiness/);
});

test("current repository has no blocking platform-boundary findings", async () => {
  const repositoryFiles = await collectPlatformBoundaryFiles(repositoryRoot);
  const result = validatePlatformBoundaries(repositoryFiles);
  assert.equal(result.blockerCount, 0, `\n${formatValidationReport(result)}`);
  // 75 through Phase 11B; Phase 11C adds `admin.console.read`, and Phase 11F
  // adds exactly the governed `user.role.manage` capability. 88 through Wave
  // A1; Wave A2 adds three advanced analytics permissions. Wave A3 adds exactly
  // eight governed Service Operations / Asset Advanced permissions; SO-ADV-006
  // remains deferred and contributes no offline-sync permission. Wave A4 adds
  // exactly fifteen governed Workforce Advanced permissions.
  // Wave A5 adds the remaining SCM Advanced permissions. Wave A5.1 Stage 1 adds
  // exactly ten governed Stage 1 permissions: `supply_chain.receiving.*` (4),
  // `supply_chain.return.*` (3), `supply_chain.account_assignment.*` (2), and
  // `supply_chain.accounting_event.read` (1).
  // Pinned deliberately: an unexplained change means a permission was
  // introduced or removed without the accompanying governance step.
  assert.equal(result.permissionCount, 138);
  assert.equal(result.advisoryCount, 1);
});
