import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { RbacRepository } from "../../domain/rbac/rbac.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ForbiddenError, NotFoundError } from "../../domain/shared-kernel/errors.js";
import type {
  Notification,
  NotificationChannel,
  NotificationRepository,
  NotificationTemplate,
} from "../../domain/notification/notification.entity.js";
import type { DomainEvent } from "../../domain/event/event.entity.js";
import { renderTemplate } from "./template-renderer.js";

const ALL_CHANNELS: NotificationChannel[] = ["email", "push", "whatsapp", "sms", "in_app"];

/**
 * Notification Engine (Checkpoint 0E), per
 * 06-Notification-Document-Audit-Foundation.md: "Menerima trigger dari
 * Workflow Engine ... lalu mengirim ke channel yang sesuai", with
 * template content as Tenant Configuration and delivery status recorded
 * for audit/troubleshooting.
 *
 * `handleDomainEvent` is registered as an `EventBus` subscriber (wired in
 * composition-root.ts) — it does not know who published the event. Any
 * future module that publishes a Domain Event and has a matching
 * Notification Template gets notification delivery for free, exactly as
 * doc 07 describes ("modul lain di masa depan tanpa perlu mengubah modul
 * yang mempublikasikan event").
 *
 * Recipient resolution reads two optional, standardized keys off the
 * event payload (a convention this checkpoint establishes, not a
 * requirement enforced by the Event Foundation itself):
 *   - `targetUserId`: a specific user (e.g. "the submitter").
 *   - `targetRoleCode` (+ optional `targetOrganizationUnitId`): fans out
 *     to every user currently holding that Role in that Data Scope — the
 *     same Role+Scope "queue" ADR-0007 uses for Workflow Assignment, kept
 *     consistent rather than inventing a second recipient model.
 * An event with neither key produces zero Notifications for that
 * event — this is a deliberate no-op, not an error (e.g. a purely
 * observability-only event has no natural recipient).
 */
export class NotificationService {
  constructor(
    private readonly repo: NotificationRepository,
    private readonly rbacRepo: RbacRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async createTemplate(
    actor: ActorContext,
    input: {
      eventType: string;
      channel: NotificationChannel;
      subjectTemplate: string | null;
      bodyTemplate: string;
    },
  ): Promise<NotificationTemplate> {
    await this.rbac.requirePermission(actor.userId, "notification.template.manage");
    const template = await this.repo.createTemplate({ tenantId: actor.tenantId, ...input });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "notification.template.created",
      entityType: "notification_template",
      entityId: template.id,
      metadata: { eventType: input.eventType, channel: input.channel },
    });
    return template;
  }

  async listTemplates(actor: ActorContext): Promise<NotificationTemplate[]> {
    await this.rbac.requirePermission(actor.userId, "notification.template.manage");
    return this.repo.listTemplates(actor.tenantId);
  }

  /** Checkpoint 1C.6 — trusted-caller read (no `notification.template.manage`).
   * Used by ComplaintConfigurationService (gated on `complaint.configure`) to
   * show the Complaint-related notification templates in the admin surface. */
  async listTemplatesForTrustedCaller(tenantId: string): Promise<NotificationTemplate[]> {
    return this.repo.listTemplates(tenantId);
  }

  async listMyNotifications(actor: ActorContext, limit = 50): Promise<Notification[]> {
    await this.rbac.requirePermission(actor.userId, "notification.read");
    return this.repo.listForRecipient(actor.tenantId, actor.userId, limit);
  }

  async listTenantNotifications(actor: ActorContext, limit = 100): Promise<Notification[]> {
    await this.rbac.requirePermission(actor.userId, "notification.read");
    return this.repo.listForTenant(actor.tenantId, limit);
  }

  async markRead(actor: ActorContext, id: string): Promise<Notification> {
    const notification = await this.repo.findById(id);
    if (!notification || notification.tenantId !== actor.tenantId) {
      throw new NotFoundError("Notification", id);
    }
    if (notification.recipientUserId !== actor.userId) {
      throw new ForbiddenError("This notification was not sent to you");
    }
    const updated = await this.repo.markRead(id, actor.userId);
    return updated!;
  }

  /** EventBus subscriber — see class doc for the recipient-resolution
   * convention. Never throws: a bad/missing template or an unresolvable
   * recipient is recorded as a `skipped`/`failed` Notification row, not a
   * failure that could bubble up and disrupt whatever published the
   * event (EventBus itself already isolates subscriber errors, but this
   * keeps the isolation intentional rather than accidental). */
  async handleDomainEvent(event: DomainEvent): Promise<void> {
    const payload = event.payload;
    const targetUserId = typeof payload.targetUserId === "string" ? payload.targetUserId : null;
    const targetRoleCode = typeof payload.targetRoleCode === "string" ? payload.targetRoleCode : null;
    const targetOrganizationUnitId =
      typeof payload.targetOrganizationUnitId === "string" ? payload.targetOrganizationUnitId : null;

    let recipientIds: string[] = [];
    if (targetUserId) {
      recipientIds = [targetUserId];
    } else if (targetRoleCode) {
      recipientIds = await this.rbacRepo.listUserIdsWithRoleInScope(
        event.tenantId,
        targetRoleCode,
        targetOrganizationUnitId,
      );
    }

    if (recipientIds.length === 0) return;

    for (const channel of ALL_CHANNELS) {
      const template = await this.repo.findTemplate(event.tenantId, event.eventType, channel);
      if (!template || !template.isActive) continue;

      for (const recipientUserId of recipientIds) {
        const renderData = { ...payload, eventType: event.eventType, entityType: event.entityType, entityId: event.entityId };
        try {
          const body = renderTemplate(template.bodyTemplate, renderData);
          const subject = template.subjectTemplate ? renderTemplate(template.subjectTemplate, renderData) : null;
          // Only 'in_app' has a real reader in this checkpoint's frontend;
          // other channels are Notification-ready (real template
          // resolution + a genuine 'sent' log row) but no live transport
          // exists yet in this workspace — see migration file header.
          await this.repo.createNotification({
            tenantId: event.tenantId,
            domainEventId: event.id,
            eventType: event.eventType,
            channel,
            recipientUserId,
            subject,
            body,
            status: "sent",
            errorMessage: null,
            sentAt: new Date(),
          });
        } catch (error) {
          await this.repo.createNotification({
            tenantId: event.tenantId,
            domainEventId: event.id,
            eventType: event.eventType,
            channel,
            recipientUserId,
            subject: null,
            body: "",
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown template rendering error",
            sentAt: null,
          });
        }
      }
    }
  }
}
