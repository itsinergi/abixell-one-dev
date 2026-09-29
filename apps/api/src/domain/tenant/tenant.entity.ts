import type { ActorContext } from "../shared-kernel/audit-context.js";

/**
 * Tenant — the workspace / data boundary (Epic 5 Gelombang 1 §4.5 Putaran 6).
 *
 * §4.5 principle 1: a Tenant is NOT the company profile. The official legal
 * identity lives on the Legal Entity; what a Tenant carries is the *defaults*
 * a Legal Entity or Organization Unit inherits when it does not override them
 * ("Tenant mempunyai default timezone. Legal Entity dan Organization Unit dapat
 * override bila perlu"), plus the administrator contact the platform can reach.
 */
export interface Tenant {
  id: string;
  code: string;
  name: string;
  status: string;
  /** Defaults inherited by Legal Entities and Organization Units that do not
   * override them. NULL means "not configured", never an invented value. */
  defaultTimezone: string | null;
  defaultLocale: string | null;
  defaultCurrency: string | null;
  contactAdminName: string | null;
  contactAdminEmail: string | null;
  contactAdminPhone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTenantInput {
  code: string;
  name: string;
}

export interface UpdateTenantInput {
  name: string;
  defaultTimezone?: string | null;
  defaultLocale?: string | null;
  defaultCurrency?: string | null;
  contactAdminName?: string | null;
  contactAdminEmail?: string | null;
  contactAdminPhone?: string | null;
}

/**
 * What `PATCH /tenants/me` returns: the name always, and the profile fields the
 * caller actually supplied. An omitted field is left untouched, so echoing it
 * back would claim a write that did not happen — and a field sent as `null` is
 * cleared deliberately, so it IS echoed.
 */
export interface UpdatedTenantProfile {
  name: string;
  defaultTimezone?: string | null;
  defaultLocale?: string | null;
  defaultCurrency?: string | null;
  contactAdminName?: string | null;
  contactAdminEmail?: string | null;
  contactAdminPhone?: string | null;
}

export interface TenantRepository {
  create(input: CreateTenantInput, createdBy: string | null): Promise<Tenant>;
  findById(id: string): Promise<Tenant | null>;
  findByCode(code: string): Promise<Tenant | null>;
  list(): Promise<Tenant[]>;
  updateName(input: UpdateTenantInput, actor: ActorContext): Promise<UpdatedTenantProfile>;
}
