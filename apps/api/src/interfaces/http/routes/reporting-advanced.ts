import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

/** Wave A2 — Reporting Advanced governed BI and predictive HTTP surface. */

const biFilterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])),
]);

const biFilterSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in"]),
  value: biFilterValueSchema,
});

const biQueryConfigSchema = z.object({
  datasetCode: z.string().min(1),
  dimensions: z.array(z.string().min(1)),
  measures: z.array(z.string().min(1)),
  filters: z.array(biFilterSchema).default([]),
});

const createSavedReportSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  config: biQueryConfigSchema,
  isShared: z.boolean().optional(),
});

const savedReportQuerySchema = z.object({
  datasetCode: z.string().min(1).optional(),
});

const forecastModelSchema = z.enum([
  "complaint_volume_forecast",
  "sla_breach_risk_forecast",
  "survey_satisfaction_trend",
]);

const generateForecastSchema = z.object({
  modelCode: forecastModelSchema,
  lookbackDays: z.number().int().min(30).max(365).optional(),
  forecastDays: z.number().int().min(1).max(30).optional(),
});

const forecastSnapshotsQuerySchema = z.object({
  modelCode: forecastModelSchema.optional(),
});

export function registerReportingAdvancedRoutes(app: FastifyInstance, container: Container) {
  app.get("/reporting/bi/datasets", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await container.reportingBi.listDatasets(request.actor!));
  });

  app.get(
    "/reporting/bi/datasets/:code",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      return reply.send(await container.reportingBi.getDatasetDetails(request.actor!, code));
    },
  );

  app.post("/reporting/bi/query", { preHandler: app.authenticate }, async (request, reply) => {
    const config = biQueryConfigSchema.parse(request.body);
    return reply.send(await container.reportingBi.executeQuery(request.actor!, config));
  });

  app.post("/reporting/bi/export", { preHandler: app.authenticate }, async (request, reply) => {
    const config = biQueryConfigSchema.parse(request.body);
    const exported = await container.reportingBi.exportCsv(request.actor!, config);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${exported.filename}"`)
      .send(exported.csv);
  });

  app.post(
    "/reporting/bi/saved-reports",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = createSavedReportSchema.parse(request.body);
      const report = await container.reportingBi.createSavedReport(request.actor!, body);
      return reply.status(201).send(report);
    },
  );

  app.get(
    "/reporting/bi/saved-reports",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const query = savedReportQuerySchema.parse(request.query);
      const reports = await container.reportingBi.listSavedReports(request.actor!, query.datasetCode);
      return reply.send(reports);
    },
  );

  app.get(
    "/reporting/bi/saved-reports/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await container.reportingBi.getSavedReport(request.actor!, id));
    },
  );

  app.delete(
    "/reporting/bi/saved-reports/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await container.reportingBi.deleteSavedReport(request.actor!, id);
      return reply.status(204).send();
    },
  );

  app.post(
    "/reporting/predictive/forecast",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = generateForecastSchema.parse(request.body);
      const result = await container.reportingPredictive.generateForecast(request.actor!, body);
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/reporting/predictive/snapshots",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const query = forecastSnapshotsQuerySchema.parse(request.query);
      return reply.send(
        await container.reportingPredictive.listForecastSnapshots(request.actor!, query.modelCode),
      );
    },
  );

  app.get(
    "/reporting/predictive/snapshots/latest/:modelCode",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z.object({ modelCode: forecastModelSchema }).parse(request.params);
      return reply.send(
        await container.reportingPredictive.getLatestSnapshot(request.actor!, params.modelCode),
      );
    },
  );
}
