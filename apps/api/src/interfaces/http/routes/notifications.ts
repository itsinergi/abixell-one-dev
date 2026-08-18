import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createTemplateSchema = z.object({
  eventType: z.string().min(1),
  channel: z.enum(["email", "push", "whatsapp", "sms", "in_app"]),
  subjectTemplate: z.string().nullable().optional(),
  bodyTemplate: z.string().min(1),
});

export function registerNotificationRoutes(app: FastifyInstance, container: Container) {
  app.post("/notifications/templates", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createTemplateSchema.parse(request.body);
    const template = await container.notification.createTemplate(request.actor!, {
      eventType: body.eventType,
      channel: body.channel,
      subjectTemplate: body.subjectTemplate ?? null,
      bodyTemplate: body.bodyTemplate,
    });
    return reply.status(201).send(template);
  });

  app.get("/notifications/templates", { preHandler: app.authenticate }, async (request, reply) => {
    const list = await container.notification.listTemplates(request.actor!);
    return reply.send(list);
  });

  app.get("/notifications/my", { preHandler: app.authenticate }, async (request, reply) => {
    const list = await container.notification.listMyNotifications(request.actor!);
    return reply.send(list);
  });

  app.get("/notifications", { preHandler: app.authenticate }, async (request, reply) => {
    const list = await container.notification.listTenantNotifications(request.actor!);
    return reply.send(list);
  });

  app.post("/notifications/:id/read", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const notification = await container.notification.markRead(request.actor!, id);
    return reply.send(notification);
  });
}
