/**
 * Receiving & Inspection Service (WMS-007).
 *
 * Manages the Receiving Gate: physical goods receipt against an ISSUED
 * Purchase Order, QA inspections (quality_hold -> unrestricted/quarantine),
 * and discrepancy logging. Atomically increments PO-line received quantity
 * within a Unit of Work (ADR-0023 hand-off).
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type {
  CreateScmDiscrepancyRecordInput,
  CreateScmInspectionInput,
  CreateScmReceivingRecordInput,
  ResolveScmDiscrepancyRecordInput,
  ScmDiscrepancyRecord,
  ScmDiscrepancyRecordFilter,
  ScmInspection,
  ScmReceivingLine,
  ScmReceivingRecord,
  ScmReceivingRecordFilter,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export class ReceivingInspectionService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async createReceivingRecord(
    actor: ActorContext,
    input: Omit<CreateScmReceivingRecordInput, "receiptNumber" | "createdBy"> & { receiptNumber?: string },
  ): Promise<{ receiving: ScmReceivingRecord; lines: ScmReceivingLine[] }> {
    return this.delegate.createReceivingRecord(actor, input);
  }

  async getReceivingRecord(
    actor: ActorContext,
    receivingRecordId: string,
  ): Promise<{ receiving: ScmReceivingRecord; lines: ScmReceivingLine[] }> {
    return this.delegate.getReceivingRecord(actor, receivingRecordId);
  }

  async listReceivingRecords(
    actor: ActorContext,
    filter?: ScmReceivingRecordFilter,
  ): Promise<ScmReceivingRecord[]> {
    return this.delegate.listReceivingRecords(actor, filter);
  }

  async createInspection(
    actor: ActorContext,
    input: Omit<CreateScmInspectionInput, "inspectionNumber" | "createdBy"> & { inspectionNumber?: string },
  ): Promise<ScmInspection> {
    return this.delegate.createInspection(actor, input);
  }

  async getInspectionByReceivingLine(
    actor: ActorContext,
    receivingLineId: string,
  ): Promise<ScmInspection | null> {
    return this.delegate.getInspectionByReceivingLine(actor, receivingLineId);
  }

  async createDiscrepancyRecord(
    actor: ActorContext,
    input: Omit<CreateScmDiscrepancyRecordInput, "createdBy">,
  ): Promise<ScmDiscrepancyRecord> {
    return this.delegate.createDiscrepancyRecord(actor, input);
  }

  async resolveDiscrepancyRecord(
    actor: ActorContext,
    input: Omit<ResolveScmDiscrepancyRecordInput, "resolvedBy"> & { resolvedBy?: string | null },
  ): Promise<ScmDiscrepancyRecord> {
    return this.delegate.resolveDiscrepancyRecord(actor, input);
  }

  async listDiscrepancyRecords(
    actor: ActorContext,
    filter?: ScmDiscrepancyRecordFilter,
  ): Promise<ScmDiscrepancyRecord[]> {
    return this.delegate.listDiscrepancyRecords(actor, filter);
  }
}
