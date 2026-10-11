import type { ActorContext } from "../../../../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../../application/rbac/rbac.service.js";
import type {
  UomCategory,
  UomRepository,
  UnitConversion,
  UnitOfMeasure,
} from "../domain/uom.entity.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FACTOR_PATTERN = /^\d+(\.\d{1,6})?$/;
const QUANTITY_PATTERN = /^\d+(\.\d{1,6})?$/;
const CATEGORIES: UomCategory[] = ["qty", "vol", "mass", "length"];

/**
 * UoM Central (WP-MD-02). CRUD for units of measure and simple-factor
 * conversions (K4), plus `convertQuantity` — the single conversion entry
 * point other modules (e.g. catering in WP-MD-03) call.
 */
export class UomService {
  constructor(
    private readonly repo: UomRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  // ===================================================================
  // Units
  // ===================================================================

  async createUnit(
    actor: ActorContext,
    input: { code: string; name: string; baseUnitCode: string; category: UomCategory },
  ): Promise<UnitOfMeasure> {
    await this.rbac.requirePermission(actor, "supply_chain.configure");
    if (!CATEGORIES.includes(input.category)) {
      throw new ValidationError("Unknown UoM category: " + input.category);
    }
    const code = input.code.toUpperCase().trim();
    if (!code) throw new ValidationError("code is required");

    if (await this.repo.findUnitByCode(actor.tenantId, code)) {
      throw new ConflictError("Unit code already exists: " + code);
    }

    const unit = await this.repo.createUnit({
      tenantId: actor.tenantId,
      code,
      name: input.name,
      baseUnitCode: input.baseUnitCode.toUpperCase().trim(),
      category: input.category,
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "uom.unit.created",
      entityType: "unit_of_measure",
      entityId: unit.id,
      metadata: { code: unit.code, category: unit.category },
    });
    return unit;
  }

  async listUnits(
    actor: ActorContext,
    filter: { category?: UomCategory; activeOnly?: boolean } = {},
  ): Promise<UnitOfMeasure[]> {
    await this.rbac.requirePermission(actor, "supply_chain.read");
    return this.repo.listUnits(actor.tenantId, filter);
  }

  async getUnit(actor: ActorContext, code: string): Promise<UnitOfMeasure> {
    await this.rbac.requirePermission(actor, "supply_chain.read");
    const unit = await this.repo.findUnitByCode(actor.tenantId, code.toUpperCase().trim());
    if (!unit) throw new NotFoundError("UnitOfMeasure", code);
    return unit;
  }

  async deactivateUnit(actor: ActorContext, code: string): Promise<UnitOfMeasure> {
    await this.rbac.requirePermission(actor, "supply_chain.configure");
    const unit = await this.getUnit(actor, code);
    const updated = await this.repo.updateUnit(unit.id, { isActive: false }, actor.userId);
    if (!updated) throw new NotFoundError("UnitOfMeasure", code);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "uom.unit.deactivated",
      entityType: "unit_of_measure",
      entityId: unit.id,
      metadata: { code: unit.code },
    });
    return updated;
  }

  // ===================================================================
  // Conversions (K4 — simple factor)
  // ===================================================================

  async createConversion(
    actor: ActorContext,
    input: {
      fromUnitCode: string;
      toUnitCode: string;
      factor: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
  ): Promise<UnitConversion> {
    await this.rbac.requirePermission(actor, "supply_chain.configure");
    this.validateDate(input.effectiveFrom, "effectiveFrom");
    if (input.effectiveTo) this.validateDate(input.effectiveTo, "effectiveTo");
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
      throw new ValidationError("effectiveTo must be >= effectiveFrom");
    }
    if (!FACTOR_PATTERN.test(input.factor)) {
      throw new ValidationError("factor must be a positive number with up to 6 decimals");
    }
    if (!(Number(input.factor) > 0)) throw new ValidationError("factor must be > 0");

    const from = await this.repo.findUnitByCode(actor.tenantId, input.fromUnitCode.toUpperCase().trim());
    const to = await this.repo.findUnitByCode(actor.tenantId, input.toUnitCode.toUpperCase().trim());
    if (!from) throw new NotFoundError("UnitOfMeasure", input.fromUnitCode);
    if (!to) throw new NotFoundError("UnitOfMeasure", input.toUnitCode);
    if (from.id === to.id) throw new ValidationError("fromUnit and toUnit must differ");
    if (from.category !== to.category) {
      throw new ValidationError(`Cannot convert across categories: ${from.category} -> ${to.category}`);
    }
    if (await this.repo.findConversionExact(actor.tenantId, from.id, to.id)) {
      throw new ConflictError("Conversion already exists for this unit pair");
    }

    const conversion = await this.repo.createConversion({
      tenantId: actor.tenantId,
      fromUnitId: from.id,
      toUnitId: to.id,
      factor: input.factor,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "uom.conversion.created",
      entityType: "unit_conversion",
      entityId: conversion.id,
      metadata: { from: from.code, to: to.code, factor: conversion.factor },
    });
    return conversion;
  }

  async listConversions(actor: ActorContext, fromUnitCode?: string): Promise<UnitConversion[]> {
    await this.rbac.requirePermission(actor, "supply_chain.read");
    let fromUnitId: string | undefined;
    if (fromUnitCode) {
      fromUnitId = (await this.getUnit(actor, fromUnitCode)).id;
    }
    return this.repo.listConversions(actor.tenantId, fromUnitId);
  }

  /** 1 from_unit = factor to_unit, so result = qty * factor. The decimal
   * arithmetic stays in PostgreSQL (never a JS float). If no direct
   * from→to row exists but the inverse to→from does, the result is
   * qty / inverseFactor. */
  async convertQuantity(
    actor: ActorContext,
    fromUnitCode: string,
    toUnitCode: string,
    quantity: string,
    onDate?: string,
  ): Promise<{ quantity: string; fromUnit: string; toUnit: string; factor: string }> {
    await this.rbac.requirePermission(actor, "supply_chain.read");
    if (!QUANTITY_PATTERN.test(quantity)) {
      throw new ValidationError("quantity must be a non-negative number with up to 6 decimals");
    }
    const from = await this.getUnit(actor, fromUnitCode);
    const to = await this.getUnit(actor, toUnitCode);
    const date = onDate ?? new Date().toISOString().slice(0, 10);
    if (onDate) this.validateDate(onDate, "onDate");

    let factor: string;
    if (from.id === to.id) {
      factor = "1";
    } else {
      const direct = await this.repo.findConversion(actor.tenantId, from.id, to.id, date);
      if (direct) {
        factor = direct.factor;
      } else {
        const inverse = await this.repo.findConversion(actor.tenantId, to.id, from.id, date);
        if (!inverse) {
          throw new NotFoundError("UnitConversion", `${from.code} -> ${to.code}`);
        }
        factor = await this.repo.inverseFactor(inverse.factor);
      }
    }

    const result = await this.repo.multiplyNumeric(quantity, factor);
    return { quantity: result, fromUnit: from.code, toUnit: to.code, factor };
  }

  // ===================================================================
  // Validation helpers
  // ===================================================================

  private validateDate(value: string, field: string): void {
    if (!DATE_PATTERN.test(value)) {
      throw new ValidationError(`${field} must be YYYY-MM-DD, got: ${value}`);
    }
  }
}
