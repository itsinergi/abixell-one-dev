/**
 * Procurement Management — Top-level Module Barrel.
 *
 * Aggregates the Procurement bounded context (Strategic Sourcing, RFQ/Bidding,
 * Supplier Governance, Supplier Contracts, Service Acceptance / SES, and
 * Spend Analytics) for consumption by the composition root and API routes.
 */
export * from "./domain/index.js";
export * from "./application/index.js";
export * from "./infrastructure/index.js";
