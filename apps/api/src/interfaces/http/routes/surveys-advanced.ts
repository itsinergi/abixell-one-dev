import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

/** Wave A2 — Survey & Assessment Advanced HTTP surface. */

const branchConditionOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "greater_than",
  "less_than",
  "in",
  "not_in",
  "is_answered",
  "is_unanswered",
]);

const branchTargetActionSchema = z.enum(["jump_to_question", "jump_to_section", "end_survey"]);

const tokenDistributionChannelSchema = z.enum(["link", "email", "sms", "qr"]);

const translationEntityTypeSchema = z.enum([
  "definition",
  "section",
  "question",
  "option",
  "matrix_row",
]);

const addBranchingRuleSchema = z.object({
  sourceQuestionId: z.string().uuid(),
  conditionOperator: branchConditionOperatorSchema,
  conditionValue: z.unknown(),
  targetAction: branchTargetActionSchema,
  targetQuestionId: z.string().uuid().nullable().optional(),
  targetSectionId: z.string().uuid().nullable().optional(),
  priority: z.number().int().optional(),
});

const addMatrixRowSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  sortOrder: z.number().int().optional(),
});

const createDistributionTokenSchema = z.object({
  channel: tokenDistributionChannelSchema.optional(),
  recipientLabel: z.string().nullable().optional(),
  maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const upsertTranslationSchema = z.object({
  locale: z.string().min(2),
  entityType: translationEntityTypeSchema,
  entityId: z.string().uuid(),
  fieldName: z.string().min(1),
  translatedText: z.string().min(1),
});

const translationsQuerySchema = z.object({
  locale: z.string().min(2).optional(),
});

export function registerSurveyAdvancedRoutes(app: FastifyInstance, container: Container) {
  app.post(
    "/survey-versions/:versionId/branching-rules",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { versionId } = request.params as { versionId: string };
      const body = addBranchingRuleSchema.parse(request.body);
      const rule = await container.surveyAnalytics.addBranchingRule(request.actor!, versionId, {
        ...body,
        conditionValue: body.conditionValue,
      });
      return reply.status(201).send(rule);
    },
  );

  app.get(
    "/survey-versions/:versionId/branching-rules",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { versionId } = request.params as { versionId: string };
      const rules = await container.surveyAnalytics.listBranchingRules(request.actor!, versionId);
      return reply.send(rules);
    },
  );

  app.delete(
    "/survey-versions/:versionId/branching-rules/:ruleId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { versionId, ruleId } = request.params as { versionId: string; ruleId: string };
      await container.surveyAnalytics.deleteBranchingRule(request.actor!, versionId, ruleId);
      return reply.status(204).send();
    },
  );

  app.post(
    "/survey-questions/:questionId/matrix-rows",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { questionId } = request.params as { questionId: string };
      const body = addMatrixRowSchema.parse(request.body);
      const row = await container.surveyAnalytics.addMatrixRow(request.actor!, questionId, body);
      return reply.status(201).send(row);
    },
  );

  app.get(
    "/survey-questions/:questionId/matrix-rows",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { questionId } = request.params as { questionId: string };
      const rows = await container.surveyAnalytics.listMatrixRows(request.actor!, questionId);
      return reply.send(rows);
    },
  );

  app.post(
    "/survey-versions/:versionId/distribution-tokens",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { versionId } = request.params as { versionId: string };
      const body = createDistributionTokenSchema.parse(request.body);
      const token = await container.surveyAnalytics.createDistributionToken(request.actor!, versionId, body);
      return reply.status(201).send(token);
    },
  );

  app.get(
    "/survey-versions/:versionId/distribution-tokens",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { versionId } = request.params as { versionId: string };
      const tokens = await container.surveyAnalytics.listDistributionTokens(request.actor!, versionId);
      return reply.send(tokens);
    },
  );

  app.post(
    "/survey-distribution-tokens/:tokenId/revoke",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { tokenId } = request.params as { tokenId: string };
      await container.surveyAnalytics.revokeDistributionToken(request.actor!, tokenId);
      return reply.send({ ok: true });
    },
  );

  app.put(
    "/survey-versions/:versionId/translations",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { versionId } = request.params as { versionId: string };
      const body = upsertTranslationSchema.parse(request.body);
      const translation = await container.surveyAnalytics.upsertTranslation(request.actor!, versionId, body);
      return reply.send(translation);
    },
  );

  app.get(
    "/survey-versions/:versionId/translations",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { versionId } = request.params as { versionId: string };
      const query = translationsQuerySchema.parse(request.query);
      const translations = await container.surveyAnalytics.listTranslations(
        request.actor!,
        versionId,
        query.locale,
      );
      return reply.send(translations);
    },
  );

  app.delete(
    "/survey-versions/:versionId/translations/:translationId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { versionId, translationId } = request.params as { versionId: string; translationId: string };
      await container.surveyAnalytics.deleteTranslation(request.actor!, versionId, translationId);
      return reply.status(204).send();
    },
  );

  app.get("/surveys/:code/analytics", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const overview = await container.surveyAnalytics.getAnalyticsOverview(request.actor!, code);
    return reply.send(overview);
  });

  app.get("/surveys/:code/benchmark", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const benchmark = await container.surveyAnalytics.getBenchmark(request.actor!, code);
    return reply.send(benchmark);
  });
}
