import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

/**
 * Generic Survey & Assessment Engine routes (Checkpoint 1D.1).
 * Manage/assign gated on `survey.manage`, respond on `survey.respond`,
 * results on `survey.results.read` (enforced in the services). Backend-first
 * vertical slice — no Complaint/1E integration.
 */

const scoringModelSchema = z.enum(["sum", "weighted_average", "percentage", "nps"]);

const createDefinitionSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  scoringModel: scoringModelSchema.optional(),
  defaultLocale: z.string().min(2).optional(),
});

const addSectionSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  scoringModel: scoringModelSchema.nullable().optional(),
  weight: z.number().min(0).optional(),
});

const addQuestionSchema = z.object({
  sectionId: z.string().uuid().nullable().optional(),
  code: z.string().min(1),
  text: z.string().min(1),
  questionType: z.string().min(1),
  isRequired: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().optional(),
  weight: z.number().min(0).optional(),
});

const addOptionSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  score: z.number().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const createAssignmentSchema = z.object({
  surveyDefinitionCode: z.string().min(1).optional(),
  surveyVersionId: z.string().uuid().optional(),
  respondentUserId: z.string().uuid(),
  contextEntityType: z.string().min(1).nullable().optional(),
  contextEntityId: z.string().uuid().nullable().optional(),
  dueAt: z.string().nullable().optional(),
});

const saveAnswersSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().uuid(),
      valueText: z.string().nullable().optional(),
      valueNumeric: z.number().nullable().optional(),
      optionIds: z.array(z.string().uuid()).optional(),
    }),
  ),
  matrixAnswers: z.array(
    z.object({
      questionId: z.string().uuid(),
      matrixRowId: z.string().uuid(),
      valueText: z.string().nullable().optional(),
      valueNumeric: z.number().nullable().optional(),
      selectedOptionId: z.string().uuid().nullable().optional(),
    }),
  ).optional(),
});

export function registerSurveyRoutes(app: FastifyInstance, container: Container) {
  // --- Admin / manage ------------------------------------------------------
  app.post("/surveys", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createDefinitionSchema.parse(request.body);
    const result = await container.survey.createDefinition(request.actor!, body);
    return reply.status(201).send(result);
  });

  app.get("/surveys", { preHandler: app.authenticate }, async (request, reply) => {
    const list = await container.survey.listDefinitions(request.actor!);
    return reply.send(list);
  });

  app.get("/surveys/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const result = await container.survey.getDefinition(request.actor!, code);
    return reply.send(result);
  });

  app.post("/surveys/:code/versions", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const version = await container.survey.createVersion(request.actor!, code);
    return reply.status(201).send(version);
  });

  app.get("/survey-versions/:versionId", { preHandler: app.authenticate }, async (request, reply) => {
    const { versionId } = request.params as { versionId: string };
    const result = await container.survey.getVersionDetail(request.actor!, versionId);
    return reply.send(result);
  });

  app.post("/survey-versions/:versionId/sections", { preHandler: app.authenticate }, async (request, reply) => {
    const { versionId } = request.params as { versionId: string };
    const body = addSectionSchema.parse(request.body);
    const section = await container.survey.addSection(request.actor!, versionId, body);
    return reply.status(201).send(section);
  });

  app.post("/survey-versions/:versionId/questions", { preHandler: app.authenticate }, async (request, reply) => {
    const { versionId } = request.params as { versionId: string };
    const body = addQuestionSchema.parse(request.body);
    const question = await container.survey.addQuestion(request.actor!, versionId, body);
    return reply.status(201).send(question);
  });

  app.post("/survey-questions/:questionId/options", { preHandler: app.authenticate }, async (request, reply) => {
    const { questionId } = request.params as { questionId: string };
    const body = addOptionSchema.parse(request.body);
    const option = await container.survey.addOption(request.actor!, questionId, body);
    return reply.status(201).send(option);
  });

  app.post(
    "/surveys/:code/versions/:versionNumber/publish",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { code, versionNumber } = request.params as { code: string; versionNumber: string };
      const version = await container.survey.publishVersion(request.actor!, code, Number(versionNumber));
      return reply.send(version);
    },
  );

  app.post(
    "/surveys/:code/versions/:versionNumber/retire",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { code, versionNumber } = request.params as { code: string; versionNumber: string };
      const version = await container.survey.retireVersion(request.actor!, code, Number(versionNumber));
      return reply.send(version);
    },
  );

  app.post("/survey-assignments", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createAssignmentSchema.parse(request.body);
    const assignment = await container.survey.createAssignment(request.actor!, body);
    return reply.status(201).send(assignment);
  });

  // --- Results -------------------------------------------------------------
  app.get(
    "/survey-assignments/:id/result",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await container.survey.getResult(request.actor!, id);
      return reply.send(result);
    },
  );

  // --- Respondent ----------------------------------------------------------
  app.get("/survey-assignments/my", { preHandler: app.authenticate }, async (request, reply) => {
    const list = await container.surveyResponse.listMyAssignments(request.actor!);
    return reply.send(list);
  });

  app.get("/survey-assignments/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await container.surveyResponse.getAssignment(request.actor!, id);
    return reply.send(result);
  });

  app.post("/survey-assignments/:id/answers", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = saveAnswersSchema.parse(request.body);
    await container.surveyResponse.saveAnswers(request.actor!, id, body.answers, body.matrixAnswers);
    return reply.send({ ok: true });
  });

  app.post("/survey-assignments/:id/submit", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await container.surveyResponse.submit(request.actor!, id);
    return reply.send(result);
  });
}
