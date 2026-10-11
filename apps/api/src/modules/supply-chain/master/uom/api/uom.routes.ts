import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../../composition-root.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const unitSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  baseUnitCode: z.string().min(1),
  category: z.enum(["qty", "vol", "mass", "length"]),
});

const conversionSchema = z.object({
  fromUnitCode: z.string().min(1),
  toUnitCode: z.string().min(1),
  factor: z.string().regex(/^\d+(\.\d{1,6})?$/, "positive number, up to 6 decimals"),
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.nullable().optional(),
});

/** WP-MD-02 — UoM Central surface. Route paths follow the scope-analysis
 * spec (`/units-of-measure`, `/unit-conversions`) rather than a
 * `/supply-chain/` prefix, so existing consumers can adopt them directly. */
export function registerUomRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.uom;

  app.post("/units-of-measure", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.status(201).send(await svc().createUnit(request.actor!, unitSchema.parse(request.body)));
  });

  app.get("/units-of-measure", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { category?: "qty" | "vol" | "mass" | "length"; activeOnly?: string };
    return reply.send(
      await svc().listUnits(request.actor!, {
        category: query.category,
        activeOnly: query.activeOnly === "true",
      }),
    );
  });

  app.get("/units-of-measure/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    return reply.send(await svc().getUnit(request.actor!, code));
  });

  app.delete("/units-of-measure/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    return reply.send(await svc().deactivateUnit(request.actor!, code));
  });

  app.post("/unit-conversions", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.status(201).send(await svc().createConversion(request.actor!, conversionSchema.parse(request.body)));
  });

  app.get("/unit-conversions", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { from?: string };
    return reply.send(await svc().listConversions(request.actor!, query.from));
  });

  app.post("/unit-conversions/convert", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z
      .object({
        fromUnitCode: z.string().min(1),
        toUnitCode: z.string().min(1),
        quantity: z.string().regex(/^\d+(\.\d{1,6})?$/),
        onDate: dateSchema.optional(),
      })
      .parse(request.body);
    return reply.send(
      await svc().convertQuantity(request.actor!, body.fromUnitCode, body.toUnitCode, body.quantity, body.onDate),
    );
  });
}
