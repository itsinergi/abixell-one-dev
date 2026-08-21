import type { FastifyInstance } from "fastify";
import type { Container } from "../../../../composition-root.js";

/** Phase 9 — Reporting & Operational Insight Core HTTP surface. */
export function registerReportingInsightRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.reportingInsight;

  app.get("/reporting/reports", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listReports(request.actor!));
  });

  app.get("/reporting/reports/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    return reply.send(await svc().getReport(request.actor!, code));
  });

  app.get("/reporting/dashboard", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().dashboard(request.actor!));
  });

  app.get("/reporting/reports/:code/export", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const exportFile = await svc().exportCsv(request.actor!, code);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${exportFile.filename}"`)
      .send(exportFile.content);
  });
}
