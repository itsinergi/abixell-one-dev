/**
 * UoM Central (WP-MD-02) — units of measure master + conversion engine.
 *
 * K3: `items.unit_of_measure` free text was backfilled into this master by
 * the migration; new items should reference a unit row. K4: conversion is
 * a simple factor only (1 from_unit = factor to_unit); composite
 * conversions (density, temperature) are deliberately out of scope.
 */

export type UomCategory = "qty" | "vol" | "mass" | "length";

export interface UnitOfMeasure {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  baseUnitCode: string;
  category: UomCategory;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UnitConversion {
  id: string;
  tenantId: string;
  fromUnitId: string;
  toUnitId: string;
  /** numeric(18,6) arrives as a string — kept as a string end to end. */
  factor: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateUomInput {
  tenantId: string;
  code: string;
  name: string;
  baseUnitCode: string;
  category: UomCategory;
  createdBy: string | null;
}

export interface CreateConversionInput {
  tenantId: string;
  fromUnitId: string;
  toUnitId: string;
  factor: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string | null;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface UomRepository {
  createUnit(input: CreateUomInput): Promise<UnitOfMeasure>;
  updateUnit(id: string, input: { isActive: boolean }, updatedBy: string | null): Promise<UnitOfMeasure | null>;
  findUnitById(tenantId: string, id: string): Promise<UnitOfMeasure | null>;
  findUnitByCode(tenantId: string, code: string): Promise<UnitOfMeasure | null>;
  listUnits(tenantId: string, filter: { category?: UomCategory; activeOnly?: boolean }): Promise<UnitOfMeasure[]>;

  createConversion(input: CreateConversionInput): Promise<UnitConversion>;
  findConversion(
    tenantId: string,
    fromUnitId: string,
    toUnitId: string,
    onDate: string,
  ): Promise<UnitConversion | null>;
  findConversionExact(tenantId: string, fromUnitId: string, toUnitId: string): Promise<UnitConversion | null>;
  listConversions(tenantId: string, fromUnitId?: string): Promise<UnitConversion[]>;

  /** Exact-decimal helpers — the arithmetic never happens in a JS float. */
  inverseFactor(factor: string): Promise<string>;
  multiplyNumeric(quantity: string, factor: string): Promise<string>;
}
