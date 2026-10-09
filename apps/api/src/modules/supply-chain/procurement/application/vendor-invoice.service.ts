/**
 * Vendor Invoice Service (WP-PRO-01).
 *
 * Manages AP invoices (vendor invoices) for PO-based procurement,
 * state machine progression (draft → submitted → approved/rejected),
 * and emission of the `vendor.invoice.approved` accounting-ready event
 * to the outbox (ADR-0023 SCM-Finance boundary).
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type {
  CreateScmVendorInvoiceInput,
  ScmVendorInvoice,
  ScmVendorInvoiceFilter,
  ScmVendorInvoiceLine,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export class VendorInvoiceService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async createVendorInvoice(
    actor: ActorContext,
    input: Omit<CreateScmVendorInvoiceInput, "invoiceNumber" | "createdBy"> & {
      invoiceNumber?: string;
    },
  ): Promise<{ vendorInvoice: ScmVendorInvoice; lines: ScmVendorInvoiceLine[] }> {
    return this.delegate.createVendorInvoice(actor, input);
  }

  async getVendorInvoice(
    actor: ActorContext,
    vendorInvoiceId: string,
  ): Promise<{ vendorInvoice: ScmVendorInvoice; lines: ScmVendorInvoiceLine[] }> {
    return this.delegate.getVendorInvoice(actor, vendorInvoiceId);
  }

  async listVendorInvoices(
    actor: ActorContext,
    filter: ScmVendorInvoiceFilter = {},
  ): Promise<ScmVendorInvoice[]> {
    return this.delegate.listVendorInvoices(actor, filter);
  }

  async submitVendorInvoice(
    actor: ActorContext,
    vendorInvoiceId: string,
    comment?: string,
  ): Promise<{ vendorInvoice: ScmVendorInvoice; lines: ScmVendorInvoiceLine[] }> {
    return this.delegate.submitVendorInvoice(actor, vendorInvoiceId, comment);
  }

  /**
   * Approves a vendor invoice. Freezes accounting dimensions on lines
   * and records the `vendor.invoice.approved` accounting-ready event to the outbox.
   */
  async approveVendorInvoice(
    actor: ActorContext,
    vendorInvoiceId: string,
    comment?: string,
  ): Promise<{ vendorInvoice: ScmVendorInvoice; lines: ScmVendorInvoiceLine[] }> {
    return this.delegate.approveVendorInvoice(actor, vendorInvoiceId, comment);
  }
}
