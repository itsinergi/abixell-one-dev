import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

/** Wave A2 — Public Unauthenticated Survey HTTP surface (SUR-ADV-005). */

const publicAnswerItemSchema = z.object({
  questionId: z.string().uuid(),
  valueText: z.string().nullable().optional(),
  valueNumeric: z.number().nullable().optional(),
  optionIds: z.array(z.string().uuid()).optional(),
});

const publicMatrixAnswerItemSchema = z.object({
  questionId: z.string().uuid(),
  matrixRowId: z.string().uuid(),
  valueText: z.string().nullable().optional(),
  valueNumeric: z.number().nullable().optional(),
  selectedOptionId: z.string().uuid().nullable().optional(),
});

const submitPublicSurveySchema = z.object({
  answers: z.array(publicAnswerItemSchema),
  matrixAnswers: z.array(publicMatrixAnswerItemSchema).optional(),
});

const publicSurveyQuerySchema = z.object({
  locale: z.string().min(2).optional(),
});

export function registerPublicSurveyRoutes(app: FastifyInstance, container: Container) {
  // Public survey reads: no authentication decorator, token-validated
  app.get("/public/surveys/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const query = publicSurveyQuerySchema.parse(request.query);
    const view = await container.surveyPublic.getPublicSurvey(token, query.locale);
    return reply.send(view);
  });

  // Public survey submission: no authentication decorator, zero identity leakage
  app.post("/public/surveys/:token/submit", async (request, reply) => {
    const { token } = request.params as { token: string };
    const body = submitPublicSurveySchema.parse(request.body);
    const result = await container.surveyPublic.submitPublicSurvey(token, body);
    return reply.status(201).send(result);
  });
}
