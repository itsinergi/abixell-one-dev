import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ValidationError } from "../../domain/shared-kernel/errors.js";
import type { ConfigurationService } from "../configuration/configuration.service.js";
import type { NotificationService } from "../notification/notification.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { WorkflowService, EntityWorkflowDefinitionView } from "../workflow/workflow.service.js";
import {
  COMPLAINT_CATEGORY_REF_TYPE,
  COMPLAINT_SEVERITY_REF_TYPE,
  COMPLAINT_PRIORITY_REF_TYPE,
  COMPLAINT_WORKFLOW_DEFINITION_CODE,
  COMPLAINT_NUMBERING_CODE,
} from "./complaint.service.js";

/** The reference-data catalogs the Complaint admin surface may manage. Fixed
 * integration points (which catalogs), never business VALUES. */
const COMPLAINT_REF_TYPES = [
  COMPLAINT_CATEGORY_REF_TYPE,
  COMPLAINT_SEVERITY_REF_TYPE,
  COMPLAINT_PRIORITY_REF_TYPE,
] as const;

export interface ReferenceItemView {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ComplaintConfigurationView {
  referenceData: {
    categories: ReferenceItemView[];
    severities: ReferenceItemView[];
    priorities: ReferenceItemView[];
  };
  numbering: { code: string; pattern: string; currentSequence: number } | null;
  notificationTemplates: {
    id: string;
    eventType: string;
    channel: string;
    subjectTemplate: string | null;
    isActive: boolean;
  }[];
  workflow: EntityWorkflowDefinitionView | null;
  /** Capabilities the admin UI can safely offer, so the frontend never shows
   * controls the backend cannot honour (guard: no fake sections). */
  capabilities: {
    referenceDataCreate: boolean;
    referenceDataToggleActive: boolean;
    numberingEditable: boolean;
    notificationTemplateEditable: boolean;
    workflowEditable: boolean;
  };
}

/**
 * Checkpoint 1C.6 — Complaint Administration & Configuration surface. Gated on
 * `complaint.configure` (distinct from `complaint.dashboard.read`). Reuses the
 * existing Configuration / Notification / Workflow foundations via
 * trusted-caller reads and audited trusted-caller writes — it invents no new
 * configuration capability and duplicates no config storage. Only the
 * genuinely-supported, safe mutations are exposed (reference-data
 * create/activate); numbering, notification templates, and the workflow
 * definition are read-only here because Core supports only create (numbering/
 * templates) or because editing would require the versioning flow (workflow).
 */
export class ComplaintConfigurationService {
  constructor(
    private readonly rbac: RbacService,
    private readonly configuration: ConfigurationService,
    private readonly notification: NotificationService,
    private readonly workflow: WorkflowService,
  ) {}

  private assertComplaintRefType(typeCode: string): void {
    if (!(COMPLAINT_REF_TYPES as readonly string[]).includes(typeCode)) {
      throw new ValidationError(
        `'${typeCode}' is not a Complaint reference-data catalog manageable here`,
      );
    }
  }

  async getConfiguration(actor: ActorContext): Promise<ComplaintConfigurationView> {
    await this.rbac.requirePermission(actor.userId, "complaint.configure");

    const [categories, severities, priorities, numbering, templates, workflow] = await Promise.all([
      this.configuration.listReferenceDataItemsForTrustedCaller(actor.tenantId, COMPLAINT_CATEGORY_REF_TYPE),
      this.configuration.listReferenceDataItemsForTrustedCaller(actor.tenantId, COMPLAINT_SEVERITY_REF_TYPE),
      this.configuration.listReferenceDataItemsForTrustedCaller(actor.tenantId, COMPLAINT_PRIORITY_REF_TYPE),
      this.configuration.getNumberingSequenceForTrustedCaller(actor.tenantId, COMPLAINT_NUMBERING_CODE),
      this.notification.listTemplatesForTrustedCaller(actor.tenantId),
      this.workflow.getDefinitionView(actor.tenantId, COMPLAINT_WORKFLOW_DEFINITION_CODE),
    ]);

    return {
      referenceData: {
        categories: categories as ReferenceItemView[],
        severities: severities as ReferenceItemView[],
        priorities: priorities as ReferenceItemView[],
      },
      numbering: numbering
        ? { code: numbering.code, pattern: numbering.pattern, currentSequence: numbering.currentSequence }
        : null,
      notificationTemplates: templates
        .filter((t) => t.eventType.startsWith("complaint."))
        .map((t) => ({
          id: t.id,
          eventType: t.eventType,
          channel: t.channel,
          subjectTemplate: t.subjectTemplate,
          isActive: t.isActive,
        })),
      workflow,
      capabilities: {
        referenceDataCreate: true,
        referenceDataToggleActive: true,
        // Core currently supports create-only for numbering/templates and
        // versioned authoring for workflow — not surfaced as edits here.
        numberingEditable: false,
        notificationTemplateEditable: false,
        workflowEditable: false,
      },
    };
  }

  async createReferenceItem(
    actor: ActorContext,
    typeCode: string,
    item: { code: string; label: string; sortOrder?: number },
  ) {
    await this.rbac.requirePermission(actor.userId, "complaint.configure");
    this.assertComplaintRefType(typeCode);
    return this.configuration.createReferenceDataItemForTrustedCaller(
      actor.tenantId,
      actor.userId,
      typeCode,
      item,
    );
  }

  async setReferenceItemActive(
    actor: ActorContext,
    typeCode: string,
    itemId: string,
    isActive: boolean,
  ) {
    await this.rbac.requirePermission(actor.userId, "complaint.configure");
    this.assertComplaintRefType(typeCode);
    return this.configuration.setReferenceDataItemActiveForTrustedCaller(
      actor.tenantId,
      actor.userId,
      typeCode,
      itemId,
      isActive,
    );
  }
}
