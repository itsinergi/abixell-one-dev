/**
 * Generic Customer Complaint Engine (Checkpoint 1B). See the migration
 * header for why lifecycle/assignment/SLA are deliberately NOT columns
 * here — they live in the Workflow Engine (0D/0E), reached via
 * `workflowInstanceId`.
 */

export interface Complaint {
  id: string;
  tenantId: string;
  complaintNumber: string;
  customerId: string;
  customerContactId: string | null;
  contractId: string | null;
  projectId: string | null;
  siteId: string | null;
  serviceId: string | null;
  category: string;
  subcategory: string | null;
  description: string;
  priority: string;
  severity: string;
  source: string | null;
  channel: string | null;
  submittedByUserId: string;
  submittedAt: Date | null;
  rootCause: string | null;
  correctiveAction: string | null;
  preventiveAction: string | null;
  correctiveActionOwnerUserId: string | null;
  correctiveActionTargetDate: string | null;
  verificationNote: string | null;
  verifiedByUserId: string | null;
  verifiedAt: Date | null;
  customerConfirmationNote: string | null;
  customerConfirmedAt: Date | null;
  closureDate: Date | null;
  workflowInstanceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateComplaintInput {
  tenantId: string;
  customerId: string;
  customerContactId?: string | null;
  contractId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  serviceId?: string | null;
  complaintNumber: string;
  category: string;
  subcategory?: string | null;
  description: string;
  priority: string;
  severity: string;
  source?: string | null;
  channel?: string | null;
  submittedByUserId: string;
}

export interface UpdateInvestigationInput {
  rootCause?: string | null;
  correctiveAction?: string | null;
  preventiveAction?: string | null;
  correctiveActionOwnerUserId?: string | null;
  correctiveActionTargetDate?: string | null;
}

export interface UpdateVerificationInput {
  verificationNote: string | null;
  verifiedByUserId: string;
}

export interface UpdateCustomerConfirmationInput {
  customerConfirmationNote: string | null;
}

export interface ComplaintRepository {
  create(input: CreateComplaintInput, createdBy: string | null): Promise<Complaint>;
  findById(id: string): Promise<Complaint | null>;
  listByCustomer(customerId: string): Promise<Complaint[]>;
  listByCustomers(customerIds: string[]): Promise<Complaint[]>;
  setWorkflowInstance(id: string, workflowInstanceId: string): Promise<void>;
  markSubmitted(id: string, submittedAt: Date): Promise<void>;
  updateInvestigation(id: string, input: UpdateInvestigationInput, updatedBy: string | null): Promise<Complaint>;
  updateVerification(id: string, input: UpdateVerificationInput, updatedBy: string | null): Promise<Complaint>;
  updateCustomerConfirmation(
    id: string,
    input: UpdateCustomerConfirmationInput,
    updatedBy: string | null,
  ): Promise<Complaint>;
  markClosed(id: string, closureDate: Date): Promise<void>;
}
