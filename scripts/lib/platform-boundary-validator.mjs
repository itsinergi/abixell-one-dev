import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const PHASE_11A_BASELINE_COMMIT = "7ba7ff2";
export const PHASE_11A_MIGRATION_HEAD = "1772000000000_phase-h2-outbox-safety-correction.cjs";

export const PHASE_11A_MIGRATION_DIGESTS = new Map([
  ["1755500000000_init-audit-extension.cjs", "e1ae56c465c7493477cb107f24b47bf759dc013e26c801bd0de4ec1424d1e495"],
  ["1755600000000_identity-organization-rbac-audit.cjs", "2a3ca1c63482a9d3700e46de229c9ae26614cc2f627d97fbf3c2c1a8aa8af552"],
  ["1755600100000_fix-user-role-assignment-scope-cascade.cjs", "df428c039f797fbc210c782e79f6e4220b9c27c8acc79e02d7b6d37799df2dc5"],
  ["1755700000000_configuration-metadata-foundation.cjs", "aa72642ebb0fe073309c4ebb03b29162f5d034a78bef8fc2a8c9576dbf3c5033"],
  ["1755800000000_workflow-approval-engine-foundation.cjs", "23e4b7b745576723afc086558ddce510accd2f30c5b021e32ecaac625f5c4e82"],
  ["1755900000000_shared-services-foundation.cjs", "1460e97e73d31cdecdecf0fe909aa8cc9bef322adf2d21a988839e799b09fd74"],
  ["1756000000000_phase0-stabilization.cjs", "3a7927b403a5110ddcaa0d0021eeb7ba2834aebc3162e4f093ef702931b73e71"],
  ["1757000000000_customer-experience-foundation-1a.cjs", "d1e3785f5e1bdccb3981b897a0571e17a13769d99ef8eabb25de7cb7dbacd300"],
  ["1758000000000_customer-complaint-engine-1b.cjs", "604f0c04bf225584aae280b98c9433036db298613c73f9bf92b2ba6eb2890080"],
  ["1759000000000_complaint-dashboard-permission.cjs", "32e492c9f685c56a8439dff6b1d1e2948ba1eb8fa499bd2d0421e4ee92ae6718"],
  ["1760000000000_survey-engine-schema.cjs", "c04e417c47c6cd611e68032ad5c9be68d6d0d7a0a80762a896dfbae775364f0e"],
  ["1760000100000_survey-permissions.cjs", "efe7421b1a344e201056cd479a11462323774c1f03e35be8d21937fbd862e2f9"],
  ["1761000000000_survey-integration-schema.cjs", "44f6df0484024dba666307b2f8a0c5e7482ce10860308a9811d4b69ce153f00d"],
  ["1762000000000_survey-integration-outcome.cjs", "e2094bbcdee61d707a6bad591f2a7eb0c3fa8ef331ed5fc23933f1fb30f51d2d"],
  ["1763000000000_service_operations_schema.cjs", "d5c6725b73882ab5ea37dd40bb9095286e75f5b36834251c10100132e4b5a203"],
  ["1764000000000_workforce_core_schema.cjs", "f7f97e0d338a17b06680f61aba110f7552459927723e59efd979d369cfb8ec3e"],
  ["1765000000000_supply_chain_core_schema.cjs", "29ddccb075fb386713788544ed0e16159f2b4f5754f31a3570aeb6bd8a12b41e"],
  ["1766000000000_asset_core_schema.cjs", "62251cfda7479c902e33fd2266039fab567b012e1db27e630a225532d06b0b31"],
  ["1767000000000_finance_core_schema.cjs", "0d6bd07d79f433672fb16387ae2cb1bf666b76f0089557a3e8098e5e842fe0cb"],
  ["1768000000000_hse_core_schema.cjs", "5b75ab3403f14031df31389911e4a2bd643ba18961f60eea20103ddf8423c683"],
  ["1769000000000_project_delivery_core_schema.cjs", "378a2aa48c15c1275b7aaba4791e000f7ec22b97d4c3a02153a6ec0992693d41"],
  ["1770000000000_reporting_insight_core.cjs", "de7ad22f5f52c933502c081e5d4d8ecf26377f9e16e7fad7c5ed0872af51ea58"],
  ["1771000000000_phase-h2-production-hardening.cjs", "14a2466311c88638a3d0d2bd7eca75ef8c6456f207d6caab8b2643afb6fe9cbc"],
  ["1772000000000_phase-h2-outbox-safety-correction.cjs", "b4a91072c860d16b703ad23bd917fa85a551f8c132f716478b4a003b64c0c219"],
]);

const TENANCY_ROOT_TABLES = new Set(["tenants"]);
const GLOBAL_CATALOG_TABLES = new Set([
  "permissions",
  "metadata_registry",
  "modules",
  "feature_flags",
  "terminology_keys",
  "reference_data_types",
]);
const GLOBAL_SYSTEM_TABLES = new Set(["scheduled_jobs", "scheduled_job_runs"]);
const HISTORICAL_NULLABLE_TENANT_TABLES = new Set(["audit_log"]);

const DIRECT_TENANT_TABLES = new Set([
  "legal_entities", "organization_units", "users", "roles",
  "tenant_module_activations", "tenant_feature_flags", "tenant_terminology_overrides",
  "tenant_reference_data_items", "numbering_sequences", "workflow_definitions",
  "demo_transactions", "workflow_instances", "domain_events", "notification_templates",
  "notifications", "documents", "integration_endpoints", "integration_event_log",
  "customers", "customer_contacts", "contracts", "projects", "sites", "services",
  "customer_service_links", "complaints", "survey_definitions", "survey_assignments",
  "survey_integration_policies", "survey_integration_executions", "service_definitions",
  "work_requests", "work_orders", "positions", "employees", "items", "suppliers",
  "stock_balances", "stock_movements", "purchase_requests", "purchase_orders", "assets",
  "asset_movements", "finance_accounts", "finance_transactions", "hse_records",
  "hse_follow_ups", "project_delivery_activities", "project_delivery_milestones",
  "integration_outbox_deliveries",
]);

const HISTORICAL_INHERITED_TENANT_OWNERSHIP = new Map([
  ["role_permissions", { column: "role_id", parent: "roles" }],
  ["user_role_assignments", { column: "user_id", parent: "users" }],
  ["refresh_tokens", { column: "user_id", parent: "users" }],
  ["workflow_versions", { column: "workflow_definition_id", parent: "workflow_definitions" }],
  ["workflow_steps", { column: "workflow_version_id", parent: "workflow_versions" }],
  ["workflow_transitions", { column: "workflow_version_id", parent: "workflow_versions" }],
  ["workflow_assignment_rules", { column: "workflow_step_id", parent: "workflow_steps" }],
  ["workflow_escalation_rules", { column: "workflow_step_id", parent: "workflow_steps" }],
  ["workflow_instance_assignments", { column: "workflow_instance_id", parent: "workflow_instances" }],
  ["workflow_history", { column: "workflow_instance_id", parent: "workflow_instances" }],
  ["workflow_notification_hooks", { column: "workflow_instance_id", parent: "workflow_instances" }],
  ["survey_versions", { column: "survey_definition_id", parent: "survey_definitions" }],
  ["survey_sections", { column: "survey_version_id", parent: "survey_versions" }],
  ["survey_questions", { column: "survey_version_id", parent: "survey_versions" }],
  ["survey_question_options", { column: "survey_question_id", parent: "survey_questions" }],
  ["survey_answers", { column: "survey_assignment_id", parent: "survey_assignments" }],
  ["survey_answer_options", { column: "survey_answer_id", parent: "survey_answers" }],
  ["service_definition_checklist_items", { column: "service_definition_id", parent: "service_definitions" }],
  ["work_order_checklist_items", { column: "work_order_id", parent: "work_orders" }],
  ["employee_assignments", { column: "employee_id", parent: "employees" }],
  ["purchase_request_lines", { column: "purchase_request_id", parent: "purchase_requests" }],
  ["purchase_order_lines", { column: "purchase_order_id", parent: "purchase_orders" }],
  ["hse_persons_involved", { column: "hse_record_id", parent: "hse_records" }],
  ["integration_endpoint_inactive_windows", { column: "integration_endpoint_id", parent: "integration_endpoints" }],
]);

// Every global/system table added after Phase 11B needs an exact reviewed
// entry here rather than a heuristic exemption.
const REVIEWED_NEW_GLOBAL_TABLES = new Map([
  [
    "menu_terminology_allowlist",
    "Product Core allowlist shared by all tenants; tenant values stay in tenant_terminology_overrides.",
  ],
  [
    "app_dictionary_terminology_allowlist",
    "Product Core allowlist for Window/Tab/Table/Field labels; tenant values stay in tenant_terminology_overrides.",
  ],
  [
    "app_parameters",
    "Product Core parameter catalogue shared by all tenants; tenant overrides stay in app_parameter_values.",
  ],
  [
    "entity_reference_registry",
    "Platform metadata generated from pg_constraint; stores reference topology, not tenant business data.",
  ],
]);

const ROUTE_CONTAINER_EXCEPTIONS = [
  "asset", "finance", "hse", "project-delivery", "reporting-insight",
  "service-operations", "supply-chain", "workforce",
].map((moduleName) => ({
  id: `route-container:${moduleName}`,
  source: `apps/api/src/modules/${moduleName}/core/api/${moduleName}.routes.ts`,
  target: "apps/api/src/composition-root.ts",
  symbols: ["Container"],
  typeOnly: true,
}));

const ADVANCED_ROUTE_CONTAINER_EXCEPTIONS = [
  "asset", "service-operations", "workforce",
].map((moduleName) => ({
  id: `route-container:${moduleName}:advanced`,
  source: `apps/api/src/modules/${moduleName}/advanced/api/${moduleName}-advanced.routes.ts`,
  target: "apps/api/src/composition-root.ts",
  symbols: ["Container"],
  typeOnly: true,
}));

export const DEFAULT_API_EXCEPTIONS = [
  ...ROUTE_CONTAINER_EXCEPTIONS,
  ...ADVANCED_ROUTE_CONTAINER_EXCEPTIONS,
  {
    // Phase 1B — Accounting Kernel uses the Addendum module layout
    // (`modules/accounting/kernel/{domain,application,infrastructure,api}`),
    // so its route file does not match the `${moduleName}/core/api/${moduleName}.routes.ts`
    // shape the generated exceptions above assume.
    id: "route-container:accounting-kernel",
    source: "apps/api/src/modules/accounting/kernel/api/accounting-kernel.routes.ts",
    target: "apps/api/src/composition-root.ts",
    symbols: ["Container"],
    typeOnly: true,
  },
  {
    // Phase 5 (WP-MD-01) — Finance master data uses the Addendum layout
    // (`modules/finance/master/{domain,application,infrastructure,api}`),
    // so its route file does not match the core route shape either.
    id: "route-container:finance-master",
    source: "apps/api/src/modules/finance/master/api/finance-master.routes.ts",
    target: "apps/api/src/composition-root.ts",
    symbols: ["Container"],
    typeOnly: true,
  },
  {
    // Phase 5 (WP-MD-02) — UoM Central sits under supply-chain/master/uom and
    // does not match the core supply-chain route shape.
    id: "route-container:uom",
    source: "apps/api/src/modules/supply-chain/master/uom/api/uom.routes.ts",
    target: "apps/api/src/composition-root.ts",
    symbols: ["Container"],
    typeOnly: true,
  },
  {
    // Phase 5 (WP-MD-03) — the catering vertical sits under
    // `service-operations/vertical/catering` and does not match the core
    // route shape either.
    id: "route-container:catering",
    source: "apps/api/src/modules/service-operations/vertical/catering/api/catering.routes.ts",
    target: "apps/api/src/composition-root.ts",
    symbols: ["Container"],
    typeOnly: true,
  },
  {
    id: "transition:service-operations-customer-service",
    source: "apps/api/src/modules/service-operations/core/application/service-operations.service.ts",
    target: "apps/api/src/application/customer/customer.service.ts",
    symbols: ["CustomerService"],
    typeOnly: true,
  },
];

const CHECK_DEFINITIONS = [
  ["api-module-boundaries", "API module boundaries", "blocking"],
  ["web-module-boundaries", "Web module boundaries", "blocking"],
  ["migration-tenant-discipline", "Migration baseline and tenant discipline", "blocking"],
  ["permission-discipline", "Permission declaration and consumer discipline", "blocking"],
  ["role-authorization", "Hardcoded role-name authorization", "blocking/advisory"],
  ["unsafe-runtime", "Prohibited Builder/runtime escape hatches", "blocking"],
  ["manifest-readiness", "Module Manifest readiness", "advisory"],
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const SKIPPED_SOURCE_SEGMENTS = new Set([
  "node_modules", "dist", "build", "coverage", "generated", "fixtures", "__fixtures__",
  "__tests__", "test", "tests", "e2e",
]);

export function normalizeRepoPath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function normalizeEol(value) {
  return value.replace(/\r\n?/g, "\n");
}

export function normalizedSha256(value) {
  return createHash("sha256").update(normalizeEol(value), "utf8").digest("hex");
}

function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}

function finding(check, severity, file, line, reason) {
  return {
    check,
    severity,
    file: file ? normalizeRepoPath(file) : null,
    line: line ?? null,
    reason,
  };
}

function compareFindings(a, b) {
  return (
    a.check.localeCompare(b.check) ||
    (a.file ?? "").localeCompare(b.file ?? "") ||
    (a.line ?? 0) - (b.line ?? 0) ||
    a.reason.localeCompare(b.reason)
  );
}

function skipQuoted(source, start) {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return source.length;
}

function skipLineComment(source, start) {
  const end = source.indexOf("\n", start + 2);
  return end === -1 ? source.length : end;
}

function skipBlockComment(source, start) {
  const end = source.indexOf("*/", start + 2);
  return end === -1 ? source.length : end + 2;
}

function findBalanced(source, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === "\"" || char === "'" || char === "`") {
      i = skipQuoted(source, i) - 1;
      continue;
    }
    if (char === "/" && source[i + 1] === "/") {
      i = skipLineComment(source, i) - 1;
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      i = skipBlockComment(source, i) - 1;
      continue;
    }
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripComments(source) {
  const output = [...source];
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === "\"" || char === "'" || char === "`") {
      i = skipQuoted(source, i) - 1;
      continue;
    }
    if (char === "/" && source[i + 1] === "/") {
      const end = skipLineComment(source, i);
      for (let j = i; j < end; j += 1) if (source[j] !== "\n") output[j] = " ";
      i = end - 1;
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      const end = skipBlockComment(source, i);
      for (let j = i; j < end; j += 1) if (source[j] !== "\n") output[j] = " ";
      i = end - 1;
    }
  }
  return output.join("");
}

function lexicalViews(source) {
  const code = [...source];
  const literals = [];

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === "/" && source[i + 1] === "/") {
      const end = skipLineComment(source, i);
      for (let j = i; j < end; j += 1) if (source[j] !== "\n") code[j] = " ";
      i = end - 1;
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      const end = skipBlockComment(source, i);
      for (let j = i; j < end; j += 1) if (source[j] !== "\n") code[j] = " ";
      i = end - 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      const end = skipQuoted(source, i);
      const content = source.slice(i + 1, Math.max(i + 1, end - 1));
      literals.push({
        content,
        quote: char,
        interpolated: char === "`" && /(^|[^\\])\$\{/.test(content),
        line: lineAt(source, i),
        start: i,
      });
      for (let j = i; j < end; j += 1) if (source[j] !== "\n") code[j] = " ";
      i = end - 1;
    }
  }

  return { code: code.join(""), literals };
}

function parseNamedImportSymbols(clause) {
  const open = clause.indexOf("{");
  const close = clause.lastIndexOf("}");
  if (open === -1 || close === -1 || close < open) return { symbols: [], aliases: false };
  const entries = clause
    .slice(open + 1, close)
    .split(",")
    .map((entry) => entry.trim().replace(/^type\s+/, ""))
    .filter(Boolean);
  return {
    symbols: entries.map((entry) => entry.split(/\s+as\s+/)[0].trim()).sort(),
    aliases: entries.some((entry) => /\s+as\s+/.test(entry)),
  };
}

export function extractImports(source) {
  const cleaned = stripComments(source);
  const imports = [];
  const ranges = [];
  const importFrom = /\bimport[\t \r\n]+(type[\t \r\n]+)?([\s\S]*?)[\t \r\n]+from[\t \r\n]*(["'])([^"'\r\n]+)\3/g;
  let match;
  while ((match = importFrom.exec(cleaned))) {
    const parsed = parseNamedImportSymbols(match[2]);
    imports.push({
      kind: "import",
      specifier: match[4],
      typeOnly: Boolean(match[1]),
      symbols: parsed.symbols,
      aliases: parsed.aliases,
      line: lineAt(source, match.index),
      index: match.index,
    });
    ranges.push([match.index, importFrom.lastIndex]);
  }

  const exportFrom = /\bexport[\t \r\n]+(?:type[\t \r\n]+)?(?:\*|\{[\s\S]*?\})[\t \r\n]+from[\t \r\n]*(["'])([^"'\r\n]+)\1/g;
  while ((match = exportFrom.exec(cleaned))) {
    imports.push({
      kind: "export",
      specifier: match[2],
      typeOnly: false,
      symbols: [],
      aliases: false,
      line: lineAt(source, match.index),
      index: match.index,
    });
    ranges.push([match.index, exportFrom.lastIndex]);
  }

  const sideEffect = /\bimport[\t \r\n]*(["'])([^"'\r\n]+)\1/g;
  while ((match = sideEffect.exec(cleaned))) {
    if (ranges.some(([start, end]) => match.index >= start && match.index < end)) continue;
    imports.push({
      kind: "import",
      specifier: match[2],
      typeOnly: false,
      symbols: [],
      aliases: false,
      line: lineAt(source, match.index),
      index: match.index,
    });
  }

  const literalDynamic = /\bimport\s*\(\s*(["'])([^"'\r\n]+)\1\s*\)/g;
  while ((match = literalDynamic.exec(cleaned))) {
    imports.push({
      kind: "literal-dynamic-import",
      specifier: match[2],
      typeOnly: false,
      symbols: [],
      aliases: false,
      line: lineAt(source, match.index),
      index: match.index,
    });
  }

  return imports.sort((a, b) => a.index - b.index);
}

function resolveImport(sourcePath, specifier, filePaths) {
  if (!specifier.startsWith(".")) return null;
  const source = normalizeRepoPath(sourcePath);
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier));
  const extension = path.posix.extname(base);
  const candidates = [];

  if (extension === ".js") {
    candidates.push(base, base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx");
  } else if (extension) {
    candidates.push(base);
  } else {
    candidates.push(
      base,
      `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}.cjs`,
      `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`,
    );
  }

  const found = candidates.find((candidate) => filePaths.has(candidate));
  if (found) return found;
  if (extension === ".js") return base.slice(0, -3) + ".ts";
  return base;
}

function apiModule(pathValue) {
  return /^apps\/api\/src\/modules\/([^/]+)\//.exec(pathValue)?.[1] ?? null;
}

function webModule(pathValue) {
  return /^apps\/web\/src\/modules\/([^/]+)\//.exec(pathValue)?.[1] ?? null;
}

function isLegacyBusinessInternal(target) {
  if (/^apps\/api\/src\/(?:application|domain)\/(?:customer|complaint|survey|survey-integration)\//.test(target)) {
    return true;
  }
  if (/^apps\/api\/src\/infrastructure\/persistence\/repositories\/(?:customer|contract|project|site|service|complaint|complaint-dashboard|survey|survey-integration)\.repository\.pg\.ts$/.test(target)) {
    return true;
  }
  return /^apps\/api\/src\/interfaces\/http\/routes\/(?:customer|contract|project|site|service|complaint|survey|survey-integration)\.ts$/.test(target);
}

function sameSymbols(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === [...expected].sort()[index]);
}

export function validateImportBoundaries(files, options = {}) {
  const filePaths = new Set([...files.keys()].map(normalizeRepoPath));
  const apiFindings = [];
  const webFindings = [];
  const exceptions = options.apiExceptions ?? DEFAULT_API_EXCEPTIONS;
  const usage = new Map(exceptions.map((exception) => [exception.id, 0]));

  for (const [rawPath, source] of files) {
    const sourcePath = normalizeRepoPath(rawPath);
    if (!/^apps\/(?:api|web)\/src\//.test(sourcePath) || !SOURCE_EXTENSIONS.has(path.posix.extname(sourcePath))) continue;

    for (const imported of extractImports(source)) {
      const target = resolveImport(sourcePath, imported.specifier, filePaths);
      if (!target) continue;

      if (sourcePath.startsWith("apps/api/src/")) {
        const sourceModule = apiModule(sourcePath);
        const targetModule = apiModule(target);
        const matchingException = exceptions.find(
          (exception) => exception.source === sourcePath && exception.target === target,
        );

        if (matchingException) {
          if (
            imported.kind === "import" &&
            imported.typeOnly === matchingException.typeOnly &&
            !imported.aliases &&
            sameSymbols(imported.symbols, matchingException.symbols)
          ) {
            usage.set(matchingException.id, usage.get(matchingException.id) + 1);
          } else {
            apiFindings.push(finding(
              "api-module-boundaries",
              "blocking",
              sourcePath,
              imported.line,
              `Exception ${matchingException.id} is widened; only a type-only ${matchingException.symbols.join(", ")} import from ${matchingException.target} is allowed.`,
            ));
          }
          continue;
        }

        if (sourceModule && target === "apps/api/src/composition-root.ts") {
          apiFindings.push(finding(
            "api-module-boundaries", "blocking", sourcePath, imported.line,
            "A module may reference the composition root only through an exact, usage-counted route Container exception.",
          ));
          continue;
        }

        if (sourceModule && targetModule && sourceModule !== targetModule) {
          apiFindings.push(finding(
            "api-module-boundaries", "blocking", sourcePath, imported.line,
            `Module ${sourceModule} imports ${targetModule} internals at ${target}. Use a published port, event, orchestration, Integration boundary, or composition-root wiring.`,
          ));
          continue;
        }

        if (sourceModule && isLegacyBusinessInternal(target)) {
          apiFindings.push(finding(
            "api-module-boundaries", "blocking", sourcePath, imported.line,
            `Module ${sourceModule} imports legacy business internals at ${target}; this transition pattern cannot spread.`,
          ));
          continue;
        }

        if (!sourceModule && targetModule) {
          const isAppRoute = sourcePath === "apps/api/src/app.ts" && /^apps\/api\/src\/modules\/(?:[^/]+\/){1,3}api\/[^/]+\.routes\.ts$/.test(target);
          const isComposition = sourcePath === "apps/api/src/composition-root.ts";
          if (!isAppRoute && !isComposition) {
            apiFindings.push(finding(
              "api-module-boundaries", "blocking", sourcePath, imported.line,
              `Only app.ts route composition and composition-root.ts wiring may import API module internals; target is ${target}.`,
            ));
          }
        }
      }

      if (sourcePath.startsWith("apps/web/src/")) {
        const sourceModule = webModule(sourcePath);
        const targetModule = webModule(target);
        if (sourceModule && targetModule && sourceModule !== targetModule) {
          webFindings.push(finding(
            "web-module-boundaries", "blocking", sourcePath, imported.line,
            `Web module ${sourceModule} imports ${targetModule} implementation at ${target}; move generic code to shared or publish an explicit contract.`,
          ));
          continue;
        }
        if (!sourceModule && targetModule && sourcePath !== "apps/web/src/App.tsx") {
          webFindings.push(finding(
            "web-module-boundaries", "blocking", sourcePath, imported.line,
            `Only apps/web/src/App.tsx may compose Web module implementations; target is ${target}.`,
          ));
        }
      }
    }
  }

  for (const exception of exceptions) {
    const count = usage.get(exception.id) ?? 0;
    if (count !== 1) {
      apiFindings.push(finding(
        "api-module-boundaries", "blocking", exception.source, 1,
        `Exception ${exception.id} must match exactly once, but matched ${count} times; remove stale entries or restore the exact reviewed edge.`,
      ));
    }
  }

  return { apiFindings, webFindings };
}

function functionBody(source, name) {
  const marker = new RegExp(`exports\\.${name}\\s*=`).exec(source);
  if (!marker) return null;
  const arrow = source.indexOf("=>", marker.index + marker[0].length);
  if (arrow === -1) return null;
  const open = source.indexOf("{", arrow + 2);
  if (open === -1) return null;
  const close = findBalanced(source, open, "{", "}");
  return close === -1 ? null : source.slice(open + 1, close);
}

function objectPropertyBody(body, property) {
  const match = new RegExp(`\\b${property}\\s*:\\s*\\{`).exec(body);
  if (!match) return null;
  const open = body.indexOf("{", match.index);
  const close = findBalanced(body, open, "{", "}");
  return close === -1 ? null : body.slice(open + 1, close);
}

function splitSqlColumns(body) {
  const columns = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === "'" || char === "\"") {
      i = skipQuoted(body, i) - 1;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      columns.push(body.slice(start, i));
      start = i + 1;
    }
  }
  columns.push(body.slice(start));
  return columns;
}

function sqlColumnBody(body, column) {
  return splitSqlColumns(body).find((part) => new RegExp(`^\\s*${column}\\s+`, "i").test(part)) ?? null;
}

function pgmColumnIsTenantOwner(body, column, parent) {
  const columnBody = objectPropertyBody(body, column);
  return Boolean(
    columnBody &&
    /\btype\s*:\s*["']uuid["']/i.test(columnBody) &&
    /\bnotNull\s*:\s*true\b/.test(columnBody) &&
    new RegExp(`\\breferences\\s*:\\s*["']${parent}["']`, "i").test(columnBody) &&
    /\bonDelete\s*:\s*["']CASCADE["']/i.test(columnBody)
  );
}

function sqlColumnIsTenantOwner(body, column, parent) {
  const columnBody = sqlColumnBody(body, column);
  return Boolean(
    columnBody &&
    /\buuid\b/i.test(columnBody) &&
    /\bnot\s+null\b/i.test(columnBody) &&
    new RegExp(`\\breferences\\s+${parent}\\s*\\(\\s*id\\s*\\)`, "i").test(columnBody) &&
    /\bon\s+delete\s+cascade\b/i.test(columnBody)
  );
}

export function extractTableDeclarations(source, file = "migration.cjs") {
  const declarations = [];
  const literalCreateIndexes = [];
  const pgmCreate = /\bpgm\.createTable\s*\(\s*(["'])([a-z][a-z0-9_]*)\1\s*,\s*\{/g;
  let match;
  while ((match = pgmCreate.exec(source))) {
    const open = source.indexOf("{", match.index + match[0].lastIndexOf("{"));
    const close = findBalanced(source, open, "{", "}");
    if (close === -1) continue;
    declarations.push({
      table: match[2],
      kind: "pgm",
      body: source.slice(open + 1, close),
      index: match.index,
      line: lineAt(source, match.index),
      file,
    });
    literalCreateIndexes.push(match.index);
  }

  const { literals } = lexicalViews(source);
  for (const literal of literals) {
    const sql = literal.content.replace(/--[^\n]*/g, " ");
    const create = /\bCREATE\s+TABLE\s+([a-z][a-z0-9_]*)\s*\(/gi;
    while ((match = create.exec(sql))) {
      const open = sql.indexOf("(", match.index);
      const close = findBalanced(sql, open, "(", ")");
      if (close === -1) continue;
      declarations.push({
        table: match[1].toLowerCase(),
        kind: "sql",
        body: sql.slice(open + 1, close),
        index: literal.start + match.index,
        line: literal.line + lineAt(sql, match.index) - 1,
        file,
        interpolated: literal.interpolated,
      });
    }
  }

  return declarations.sort((a, b) => a.index - b.index);
}

function ownershipAnnotation(source, declaration) {
  const previousCreate = Math.max(
    source.lastIndexOf("pgm.createTable", declaration.index - 1),
    source.lastIndexOf("CREATE TABLE", declaration.index - 1),
  );
  const start = Math.max(previousCreate + 1, declaration.index - 500);
  const prefix = source.slice(start, declaration.index);
  const matches = [...prefix.matchAll(/platform-boundary:\s*tenant-owner-via\s+([a-z][a-z0-9_]*)\s*->\s*([a-z][a-z0-9_]*)(?:\.id)?/gi)];
  const match = matches.at(-1);
  return match ? { column: match[1].toLowerCase(), parent: match[2].toLowerCase() } : null;
}

function declarationHasOwner(declaration, column, parent) {
  return declaration.kind === "pgm"
    ? pgmColumnIsTenantOwner(declaration.body, column, parent)
    : sqlColumnIsTenantOwner(declaration.body, column, parent);
}

function expectedBaselineTables() {
  return new Set([
    ...TENANCY_ROOT_TABLES,
    ...GLOBAL_CATALOG_TABLES,
    ...GLOBAL_SYSTEM_TABLES,
    ...HISTORICAL_NULLABLE_TENANT_TABLES,
    ...DIRECT_TENANT_TABLES,
    ...HISTORICAL_INHERITED_TENANT_OWNERSHIP.keys(),
  ]);
}

export function validateMigrations(files, options = {}) {
  const findings = [];
  const baselineDigests = options.baselineDigests ?? PHASE_11A_MIGRATION_DIGESTS;
  const migrationFiles = new Map(
    [...files]
      .map(([file, source]) => [normalizeRepoPath(file), source])
      .filter(([file]) => /^apps\/api\/migrations\/[^/]+\.cjs$/.test(file)),
  );
  const names = new Map();

  for (const [file, source] of migrationFiles) {
    const name = path.posix.basename(file);
    if (!/^\d{13}_[a-z0-9][a-z0-9_-]*\.cjs$/.test(name)) {
      findings.push(finding("migration-tenant-discipline", "blocking", file, 1, "Migration filename must use a unique 13-digit prefix and lowercase slug."));
    }
    const prefix = name.slice(0, 13);
    if (names.has(prefix)) {
      findings.push(finding("migration-tenant-discipline", "blocking", file, 1, `Migration timestamp ${prefix} is already used by ${names.get(prefix)}.`));
    } else {
      names.set(prefix, file);
    }
    if (!/exports\.up\s*=/.test(source) || !/exports\.down\s*=/.test(source)) {
      findings.push(finding("migration-tenant-discipline", "blocking", file, 1, "Migration must declare both exports.up and exports.down."));
    }
  }

  for (const [name, digest] of baselineDigests) {
    const file = `apps/api/migrations/${name}`;
    const source = migrationFiles.get(file);
    if (source === undefined) {
      findings.push(finding("migration-tenant-discipline", "blocking", file, 1, `Phase 11A baseline migration is missing; historical migrations are append-only.`));
    } else if (normalizedSha256(source) !== digest) {
      findings.push(finding("migration-tenant-discipline", "blocking", file, 1, `Phase 11A baseline migration changed; expected normalized SHA-256 ${digest}.`));
    }
  }

  if (baselineDigests === PHASE_11A_MIGRATION_DIGESTS) {
    const actual = new Map();
    for (const [name] of baselineDigests) {
      const file = `apps/api/migrations/${name}`;
      const source = migrationFiles.get(file);
      if (!source) continue;
      for (const declaration of extractTableDeclarations(source, file)) {
        if (actual.has(declaration.table)) {
          findings.push(finding("migration-tenant-discipline", "blocking", file, declaration.line, `Table ${declaration.table} is declared more than once.`));
        }
        actual.set(declaration.table, declaration);
      }
    }
    const expected = expectedBaselineTables();
    for (const table of expected) {
      if (!actual.has(table)) findings.push(finding("migration-tenant-discipline", "blocking", null, null, `Phase 11A table baseline is missing parsed table ${table}.`));
    }
    for (const [table, declaration] of actual) {
      if (!expected.has(table)) findings.push(finding("migration-tenant-discipline", "blocking", declaration.file, declaration.line, `Parsed baseline table ${table} has no reviewed ownership classification.`));
    }
  }

  const newDeclarations = [];
  for (const [file, source] of migrationFiles) {
    const name = path.posix.basename(file);
    if (baselineDigests.has(name)) continue;

    const declarations = extractTableDeclarations(source, file);
    newDeclarations.push(...declarations.map((declaration) => ({ ...declaration, source })));

    const pgmCalls = [...source.matchAll(/\bpgm\.createTable\s*\(/g)];
    const parsedPgm = declarations.filter((declaration) => declaration.kind === "pgm").length;
    if (pgmCalls.length !== parsedPgm) {
      const unmatched = pgmCalls[Math.min(parsedPgm, pgmCalls.length - 1)];
      findings.push(finding("migration-tenant-discipline", "blocking", file, unmatched ? lineAt(source, unmatched.index) : 1, "New migrations must use a literal pgm.createTable name and object body."));
    }
    for (const declaration of declarations) {
      if (declaration.interpolated) {
        findings.push(finding("migration-tenant-discipline", "blocking", file, declaration.line, `CREATE TABLE ${declaration.table} is interpolated; tenant ownership must be statically provable.`));
      }
    }
    const { literals } = lexicalViews(source);
    for (const literal of literals) {
      if (literal.quote === "`" && literal.interpolated && /\bCREATE\s+TABLE\b/i.test(literal.content)) {
        const parsedFromLiteral = declarations.some((declaration) => declaration.index >= literal.start && declaration.index < literal.start + literal.content.length + 2);
        if (!parsedFromLiteral) {
          findings.push(finding("migration-tenant-discipline", "blocking", file, literal.line, "Interpolated CREATE TABLE syntax is unsupported; use a literal table name and statically provable ownership."));
        }
      }
    }
  }

  const allTableNames = expectedBaselineTables();
  const declarationsByTable = new Map();
  for (const declaration of newDeclarations) {
    if (allTableNames.has(declaration.table) || declarationsByTable.has(declaration.table)) {
      findings.push(finding("migration-tenant-discipline", "blocking", declaration.file, declaration.line, `Table ${declaration.table} duplicates an existing declaration.`));
    }
    declarationsByTable.set(declaration.table, declaration);
    allTableNames.add(declaration.table);
  }

  const newOwnership = new Map();
  for (const declaration of newDeclarations) {
    if (declarationHasOwner(declaration, "tenant_id", "tenants")) {
      newOwnership.set(declaration.table, { kind: "direct" });
      continue;
    }
    const reviewed = REVIEWED_NEW_GLOBAL_TABLES.get(declaration.table);
    if (reviewed) {
      newOwnership.set(declaration.table, { kind: "global", reason: reviewed });
      continue;
    }
    const annotation = ownershipAnnotation(declaration.source, declaration);
    if (!annotation) {
      findings.push(finding(
        "migration-tenant-discipline", "blocking", declaration.file, declaration.line,
        `New table ${declaration.table} needs non-null tenant_id ownership or an adjacent platform-boundary: tenant-owner-via <column> -> <parent> annotation.`,
      ));
      continue;
    }
    if (!declarationHasOwner(declaration, annotation.column, annotation.parent)) {
      findings.push(finding(
        "migration-tenant-discipline", "blocking", declaration.file, declaration.line,
        `Declared owner path ${annotation.column} -> ${annotation.parent} must be a non-null UUID FK with ON DELETE CASCADE.`,
      ));
      continue;
    }
    newOwnership.set(declaration.table, { kind: "inherited", ...annotation });
  }

  const provesTenantOwnership = (table, visiting = new Set()) => {
    if (DIRECT_TENANT_TABLES.has(table)) return true;
    const historical = HISTORICAL_INHERITED_TENANT_OWNERSHIP.get(table);
    const current = newOwnership.get(table);
    const relation = historical ?? (current?.kind === "inherited" ? current : null);
    if (current?.kind === "direct") return true;
    if (!relation || visiting.has(table)) return false;
    const next = new Set(visiting);
    next.add(table);
    return provesTenantOwnership(relation.parent, next);
  };

  for (const [table, owner] of newOwnership) {
    if (owner.kind === "inherited" && !provesTenantOwnership(table)) {
      const declaration = declarationsByTable.get(table);
      findings.push(finding(
        "migration-tenant-discipline", "blocking", declaration.file, declaration.line,
        `Inherited owner path for ${table} does not resolve acyclically to a directly tenant-owned table.`,
      ));
    }
  }

  return { findings, newMigrationNames: [...migrationFiles.keys()].filter((file) => !baselineDigests.has(path.posix.basename(file))) };
}

function permissionStatements(section) {
  const statements = [];
  const pattern = /INSERT\s+INTO\s+permissions\s*\(\s*code\s*,\s*description\s*\)([\s\S]*?);/gi;
  let match;
  while ((match = pattern.exec(section ?? ""))) {
    const full = match[0];
    const declarations = [];
    const pair = /\(\s*(['"])([a-zA-Z0-9_.-]+)\1\s*,\s*(['"])((?:\\.|(?!\3)[\s\S])*?)\3\s*\)/g;
    let pairMatch;
    while ((pairMatch = pair.exec(full))) {
      declarations.push({ code: pairMatch[2], description: pairMatch[4], offset: match.index + pairMatch.index });
    }
    statements.push({ source: full, declarations, offset: match.index });
  }
  return statements;
}

export function extractPermissionDeclarations(source) {
  const up = functionBody(source, "up") ?? "";
  return permissionStatements(up).flatMap((statement) => statement.declarations);
}

function permissionDownCodes(source) {
  const down = functionBody(source, "down") ?? "";
  const codes = new Set();
  const deletes = /DELETE\s+FROM\s+permissions\b([\s\S]*?);/gi;
  let match;
  while ((match = deletes.exec(down))) {
    for (const literal of match[1].matchAll(/['"]([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)['"]/g)) codes.add(literal[1]);
  }
  return codes;
}

function permissionConsumers(source, file) {
  const cleaned = stripComments(source);
  const consumers = [];
  const patterns = [
    /\brequirePermission\s*\([\s\S]{0,240}?,\s*(["'])([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)\1/g,
    /\b(?:permissions|effectivePermissions)\s*\.\s*(?:has|includes)\s*\(\s*(["'])([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)\1/g,
    /\brequiredPermission\s*:\s*(["'])([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)\1/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(cleaned))) consumers.push({ code: match[2], file, line: lineAt(source, match.index) });
  }

  if (file === "apps/web/src/lib/capabilities.ts") {
    const marker = /\bPERMISSIONS\s*=\s*\{/.exec(cleaned);
    if (marker) {
      const open = cleaned.indexOf("{", marker.index);
      const close = findBalanced(cleaned, open, "{", "}");
      if (close !== -1) {
        const body = cleaned.slice(open + 1, close);
        for (const match of body.matchAll(/:\s*(["'])([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)\1/g)) {
          consumers.push({ code: match[2], file, line: lineAt(source, open + 1 + match.index) });
        }
      }
    }
  }
  return consumers;
}

export function validatePermissions(files, newMigrationNames = []) {
  const findings = [];
  const catalog = new Map();
  const newNames = new Set(newMigrationNames.map((value) => path.posix.basename(value)));

  for (const [rawFile, source] of files) {
    const file = normalizeRepoPath(rawFile);
    if (!/^apps\/api\/migrations\/[^/]+\.cjs$/.test(file)) continue;
    const up = functionBody(source, "up") ?? "";
    const statements = permissionStatements(up);
    const isNew = newNames.has(path.posix.basename(file));
    const introduced = [];

    for (const statement of statements) {
      if (isNew && statement.declarations.length === 0) {
        findings.push(finding("permission-discipline", "blocking", file, lineAt(up, statement.offset), "New permission inserts must contain literal code/description pairs."));
      }
      if (isNew && !(/ON\s+CONFLICT\s*\(\s*code\s*\)\s*DO\s+NOTHING/i.test(statement.source) || /WHERE\s+NOT\s+EXISTS\s*\([\s\S]*?permissions[\s\S]*?\.code\s*=\s*[a-z][a-z0-9_]*\.code/i.test(statement.source))) {
        findings.push(finding("permission-discipline", "blocking", file, lineAt(up, statement.offset), "New permission declarations must be idempotent with ON CONFLICT (code) DO NOTHING or a code-correlated WHERE NOT EXISTS."));
      }
      for (const declaration of statement.declarations) {
        introduced.push(declaration.code);
        if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(declaration.code)) {
          findings.push(finding("permission-discipline", "blocking", file, lineAt(up, declaration.offset), `Permission ${declaration.code} does not follow the lowercase dotted code convention.`));
        }
        if (!declaration.description.trim()) {
          findings.push(finding("permission-discipline", "blocking", file, lineAt(up, declaration.offset), `Permission ${declaration.code} needs a nonblank description.`));
        }
        if (catalog.has(declaration.code)) {
          findings.push(finding("permission-discipline", "blocking", file, lineAt(up, declaration.offset), `Permission ${declaration.code} duplicates the declaration in ${catalog.get(declaration.code)}.`));
        } else {
          catalog.set(declaration.code, file);
        }
      }
    }

    if (isNew) {
      if (/INSERT\s+INTO\s+role_permissions\b/i.test(up)) {
        findings.push(finding("permission-discipline", "blocking", file, 1, "Migrations declare catalog permissions but must not grant tenant roles; use governed role configuration/full-access synchronization."));
      }
      const downCodes = permissionDownCodes(source);
      const introducedSet = new Set(introduced);
      if (introducedSet.size !== downCodes.size || [...introducedSet].some((code) => !downCodes.has(code))) {
        findings.push(finding("permission-discipline", "blocking", file, 1, "exports.down must delete exactly the permission codes introduced by this migration."));
      }
    }
  }

  for (const [rawFile, source] of files) {
    const file = normalizeRepoPath(rawFile);
    if (!isProtectedRuntimeSource(file)) continue;
    for (const consumer of permissionConsumers(source, file)) {
      if (!catalog.has(consumer.code)) {
        findings.push(finding("permission-discipline", "blocking", file, consumer.line, `Permission consumer references ${consumer.code}, which is absent from the migration-owned catalog.`));
      }
    }
    if (/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+permissions\b/i.test(stripComments(source))) {
      findings.push(finding("permission-discipline", "blocking", file, 1, "Runtime source must not mutate the migration-owned permission catalog."));
    }
  }

  return { findings, catalog };
}

export function validateRoleAuthorization(files) {
  const findings = [];
  for (const [rawFile, source] of files) {
    const file = normalizeRepoPath(rawFile);
    if (!isProtectedRuntimeSource(file)) continue;
    const cleaned = stripComments(source);
    const comparisons = /\b([a-zA-Z_$][\w$]*(?:\?\.)?\.(?:role|roleCode|roleName)|(?:roleCode|roleName))\s*(===|!==|==|!=)\s*(["'])([A-Z][A-Z0-9_-]*)\3|(["'])([A-Z][A-Z0-9_-]*)\5\s*(===|!==|==|!=)\s*\b([a-zA-Z_$][\w$]*(?:\?\.)?\.(?:role|roleCode|roleName)|(?:roleCode|roleName))/g;
    let match;
    while ((match = comparisons.exec(cleaned))) {
      const expression = match[1] ?? match[8];
      const roleName = match[4] ?? match[6];
      const clearActorContext = /^(?:actor|user|session|request|currentUser|currentSession)\b/i.test(expression);
      findings.push(finding(
        "role-authorization",
        clearActorContext ? "blocking" : "advisory",
        file,
        lineAt(source, match.index),
        clearActorContext
          ? `Authorization compares ${expression} with hardcoded role ${roleName}; authorize with permissions and Data Scope instead.`
          : `Review hardcoded role comparison ${expression} ${match[2] ?? match[7]} ${roleName}; it is advisory unless it controls authorization.`,
      ));
    }

    const collection = /\b((?:actor|user|session|request|currentUser|currentSession)[\w$]*(?:\?\.)?\.roles?)\s*\.\s*(?:includes|has)\s*\(\s*(["'])([A-Z][A-Z0-9_-]*)\2/g;
    while ((match = collection.exec(cleaned))) {
      findings.push(finding(
        "role-authorization", "blocking", file, lineAt(source, match.index),
        `Authorization checks hardcoded role ${match[3]} in ${match[1]}; use permissions and Data Scope instead.`,
      ));
    }
  }
  return findings;
}

function isProtectedRuntimeSource(file) {
  if (!/^(?:apps\/[^/]+|packages\/[^/]+)\/src\//.test(file)) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) return false;
  return !file.split("/").some((segment) => SKIPPED_SOURCE_SEGMENTS.has(segment));
}

export function validateUnsafeRuntime(files) {
  const findings = [];
  for (const [rawFile, source] of files) {
    const file = normalizeRepoPath(rawFile);
    if (!isProtectedRuntimeSource(file)) continue;
    const { code, literals } = lexicalViews(source);
    const cleaned = stripComments(source);
    const patterns = [
      ["eval", /\beval\s*\(/g, "Executable eval is prohibited."],
      ["Function", /\b(?:new\s+)?Function\s*\(/g, "Runtime Function construction is prohibited."],
      ["createRequire", /\bcreateRequire\b/g, "Runtime require construction is prohibited in product source."],
      ["runtime-loader", /\b(?:requireFromString|require_from_string|pluginLoader|loadPlugin|loadRuntimePlugin|sqlEditor|queryConsole|schemaEditor|executeMetadataScript|metadataScriptExecutor)\b/g, "Obvious runtime loader/editor/script execution escape hatch is prohibited."],
    ];
    for (const [, pattern, reason] of patterns) {
      let match;
      while ((match = pattern.exec(code))) findings.push(finding("unsafe-runtime", "blocking", file, lineAt(source, match.index), reason));
    }

    for (const imported of extractImports(source)) {
      if (imported.specifier === "node:vm" || imported.specifier === "vm") {
        findings.push(finding("unsafe-runtime", "blocking", file, imported.line, "The Node VM API is prohibited in product runtime source."));
      }
    }

    const dynamicCalls = [
      ["import", /\bimport\s*\(/g],
      ["require", /\brequire\s*\(/g],
    ];
    for (const [name, pattern] of dynamicCalls) {
      let match;
      while ((match = pattern.exec(cleaned))) {
        let cursor = pattern.lastIndex;
        while (/\s/.test(cleaned[cursor] ?? "")) cursor += 1;
        const first = cleaned[cursor];
        if (first === "\"" || first === "'") continue;
        if (first === "`") {
          const end = skipQuoted(cleaned, cursor);
          if (!/(^|[^\\])\$\{/.test(cleaned.slice(cursor + 1, end - 1))) continue;
        }
        findings.push(finding("unsafe-runtime", "blocking", file, lineAt(source, match.index), `Non-literal dynamic ${name} is prohibited in product runtime source.`));
      }
    }

    for (const literal of literals) {
      const ddl = literal.content.match(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|SCHEMA)\b/i);
      if (!ddl) continue;
      const descriptive = /\b(?:never|do not|don't|must not|prohibit(?:ed)?|avoid|example|guidance|documentation)\b/i.test(
        literal.content.slice(Math.max(0, ddl.index - 80), ddl.index),
      );
      if (!descriptive) {
        findings.push(finding("unsafe-runtime", "blocking", file, literal.line, "Runtime DDL is prohibited; schema changes belong to the central migration stream."));
      }
    }
  }
  return findings;
}

export function validatePlatformBoundaries(files, options = {}) {
  const normalizedFiles = new Map([...files].map(([file, source]) => [normalizeRepoPath(file), source]));
  const { apiFindings, webFindings } = validateImportBoundaries(normalizedFiles, options);
  const migration = validateMigrations(normalizedFiles, options);
  const permission = validatePermissions(normalizedFiles, migration.newMigrationNames);
  const roleFindings = validateRoleAuthorization(normalizedFiles);
  const unsafeFindings = validateUnsafeRuntime(normalizedFiles);
  const manifestFindings = [finding(
    "manifest-readiness",
    "advisory",
    null,
    null,
    "Module Manifest v1 remains documentary: manifests are not required, parsed, loaded, or evidence of runtime package/plugin support.",
  )];

  const findingsByCheck = new Map([
    ["api-module-boundaries", apiFindings],
    ["web-module-boundaries", webFindings],
    ["migration-tenant-discipline", migration.findings],
    ["permission-discipline", permission.findings],
    ["role-authorization", roleFindings],
    ["unsafe-runtime", unsafeFindings],
    ["manifest-readiness", manifestFindings],
  ]);

  const checks = CHECK_DEFINITIONS.map(([id, label, classification]) => {
    const findings = (findingsByCheck.get(id) ?? []).sort(compareFindings);
    const blockers = findings.filter((entry) => entry.severity === "blocking");
    const advisories = findings.filter((entry) => entry.severity === "advisory");
    return {
      id,
      label,
      classification,
      status: blockers.length ? "FAIL" : advisories.length ? "ADVISORY" : "PASS",
      findings,
    };
  });

  const blockerCount = checks.flatMap((check) => check.findings).filter((entry) => entry.severity === "blocking").length;
  const advisoryCount = checks.flatMap((check) => check.findings).filter((entry) => entry.severity === "advisory").length;
  return {
    checks,
    blockerCount,
    advisoryCount,
    passed: blockerCount === 0,
    scannedFileCount: normalizedFiles.size,
    permissionCount: permission.catalog.size,
  };
}

export function formatValidationReport(result) {
  const lines = ["Platform boundary validation", `Scanned ${result.scannedFileCount} repository files.`];
  for (const check of result.checks) {
    lines.push("", `CHECK ${check.id} — ${check.label} [${check.classification.toUpperCase()}]`);
    lines.push(`${check.status} ${check.id}`);
    for (const entry of check.findings) {
      const location = entry.file ? `${entry.file}${entry.line ? `:${entry.line}` : ""}` : "repository";
      lines.push(`  ${entry.severity === "blocking" ? "FAIL" : "ADVISORY"} ${location} — ${entry.reason}`);
    }
  }
  lines.push(
    "",
    `${result.passed ? "PASS" : "FAIL"} platform-boundaries — ${result.blockerCount} blocking finding(s), ${result.advisoryCount} advisory finding(s), ${result.permissionCount} migration-owned permission(s).`,
  );
  return lines.join("\n");
}

async function walkFiles(rootDirectory, relativeDirectory, files, extensions) {
  const absoluteDirectory = path.join(rootDirectory, ...relativeDirectory.split("/"));
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const relative = normalizeRepoPath(`${relativeDirectory}/${entry.name}`);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!SKIPPED_SOURCE_SEGMENTS.has(entry.name)) await walkFiles(rootDirectory, relative, files, extensions);
      continue;
    }
    if (!entry.isFile() || !extensions.has(path.posix.extname(relative))) continue;
    files.set(relative, await readFile(path.join(rootDirectory, ...relative.split("/")), "utf8"));
  }
}

export async function collectPlatformBoundaryFiles(rootDirectory) {
  const files = new Map();
  await walkFiles(rootDirectory, "apps/api/src", files, SOURCE_EXTENSIONS);
  await walkFiles(rootDirectory, "apps/web/src", files, SOURCE_EXTENSIONS);
  await walkFiles(rootDirectory, "apps/api/migrations", files, new Set([".cjs"]));

  let packageEntries = [];
  try {
    packageEntries = await readdir(path.join(rootDirectory, "packages"), { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  packageEntries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of packageEntries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await walkFiles(rootDirectory, `packages/${entry.name}/src`, files, SOURCE_EXTENSIONS);
    }
  }
  return files;
}
