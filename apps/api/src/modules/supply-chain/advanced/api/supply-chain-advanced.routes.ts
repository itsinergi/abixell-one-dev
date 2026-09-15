import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SupplyChainAdvancedService } from "../application/supply-chain-advanced.service.js";
import type { ScmAccountAssignmentType } from "../domain/supply-chain-advanced.entity.js";
import { registerWmsRoutes } from "../../warehouse/api/wms.routes.js";
import { registerProcurementRoutes } from "../../procurement/api/procurement.routes.js";
import type { WmsRouteDeps } from "../../warehouse/api/wms.routes.js";
import type { ProcurementRouteDeps } from "../../procurement/api/procurement.routes.js";

/**
 * Supply Chain Advanced HTTP routes — BACKWARD-COMPATIBILITY SHIM.
 *
 * During the DDD decomposition migration (Phases 4–6), the monolithic
 * `/supply-chain/advanced/*` namespace is reduced to a thin delegation
 * layer that:
 *   1. Mounts the canonical WMS and Procurement registrars under the
 *      legacy prefix so existing clients keep working without code
 *      changes, and
 *   2. Emits RFC-8594 `Deprecation: true` and `Sunset` response headers
 *      on every legacy response so consumers are nudged toward the
 *      canonical `/wms/*` and `/procurement/*` namespaces before the
 *      sunset date (Wed, 31 Dec 2026 23:59:59 GMT).
 *
 * The three account-assignment-config routes remain owned by the
 * legacy `SupplyChainAdvancedService` because they are cross-cutting
 * configuration (shared master data concern) rather than WMS- or
 * Procurement-specific operations, and no canonical registrar owns
 * them yet.
 */

const updateAccountAssignmentConfigSchema = z.object({
  assignmentType: z.enum([
    "stock",
    "expense",
    "asset",
    "project",
    "work_order",
    "service",
  ]),
  requiredDimensions: z.array(z.string()).optional(),
  inventoryRelevant: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export interface SupplyChainAdvancedRouteDeps {
  supplyChainAdvanced: SupplyChainAdvancedService;
  wms: WmsRouteDeps["wms"];
  procurement: ProcurementRouteDeps["procurement"];
}

export function registerSupplyChainAdvancedRoutes(
  app: FastifyInstance,
  deps: SupplyChainAdvancedRouteDeps,
): void {
  const svc = () => deps.supplyChainAdvanced;

  // RFC-8594 Deprecation notice: tag every legacy response so clients
  // are aware of the migration window. The hook is scoped to URLs that
  // start with the legacy prefix; canonical /wms and /procurement
  // responses are unaffected because they do not match.
  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/supply-chain/advanced")) {
      reply.header("Deprecation", "true");
      reply.header("Sunset", "Wed, 31 Dec 2026 23:59:59 GMT");
      reply.header(
        "Link",
        '</wms>; rel="successor-version", </procurement>; rel="successor-version"',
      );
    }
  });

  // -------------------------------------------------------------------------
  // Delegate the full WMS and Procurement route surface to the canonical
  // prefix-parameterized registrars, mounted under the legacy prefix.
  // This preserves 100% behavioral parity for existing consumers while the
  // frontend migrates to /wms/* and /procurement/*.
  // -------------------------------------------------------------------------
  registerWmsRoutes(app, { wms: deps.wms }, "/supply-chain/advanced");
  registerProcurementRoutes(app, { procurement: deps.procurement }, "/supply-chain/advanced");

  // -------------------------------------------------------------------------
  // Legacy-only: Account Assignment Configuration (shared master data).
  // These three routes have no canonical home yet and remain on the
  // monolithic service until a shared-master-data registrar is extracted.
  // -------------------------------------------------------------------------
  app.get("/supply-chain/advanced/account-assignment-configs", { preHandler: app.authenticate }, async (req, reply) => {
    return reply.send(await svc().listAccountAssignmentConfigs(req.actor!));
  });

  app.get("/supply-chain/advanced/account-assignment-configs/:assignmentType", { preHandler: app.authenticate }, async (req, reply) => {
    const { assignmentType } = z.object({ assignmentType: z.string() }).parse(req.params);
    return reply.send(await svc().getAccountAssignmentConfig(req.actor!, assignmentType as ScmAccountAssignmentType));
  });

  app.put("/supply-chain/advanced/account-assignment-configs", { preHandler: app.authenticate }, async (req, reply) => {
    const body = updateAccountAssignmentConfigSchema.parse(req.body);
    return reply.send(await svc().updateAccountAssignmentConfig(req.actor!, body));
  });
}
