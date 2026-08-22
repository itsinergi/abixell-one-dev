import type { FastifyInstance } from "fastify";
import type { Container } from "../../../composition-root.js";

export function registerSchedulerRoutes(app: FastifyInstance, container: Container) {
  app.get("/scheduler/jobs", { preHandler: app.authenticate }, async (request, reply) => {
    const jobs = await container.scheduler.listJobs(request.actor!);
    return reply.send(jobs);
  });

  app.get("/scheduler/jobs/:jobCode/runs", { preHandler: app.authenticate }, async (request, reply) => {
    const { jobCode } = request.params as { jobCode: string };
    const runs = await container.scheduler.listRuns(request.actor!, jobCode);
    return reply.send(runs);
  });

  app.post("/scheduler/jobs/:jobCode/trigger", { preHandler: app.authenticate }, async (request, reply) => {
    const { jobCode } = request.params as { jobCode: string };
    const run = await container.scheduler.triggerManually(request.actor!, jobCode);
    return reply.send(run);
  });
}
