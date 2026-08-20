/**
 * Phase 5 — Asset status presentation.
 *
 * Display mapping ONLY. The backend is authoritative for what an asset's
 * status is and for what may be done in it; this file decides how the four
 * Core values read on screen and nothing else.
 */
import type { AssetStatusValue } from "../../lib/api";
import type { Tone } from "../../shared/format";

const LABELS: Record<AssetStatusValue, string> = {
  in_use: "In use",
  idle: "Idle",
  retired: "Retired",
  disposed: "Disposed",
};

export function assetStatusLabel(status: AssetStatusValue): string {
  return LABELS[status] ?? status;
}

export function assetStatusTone(status: AssetStatusValue): Tone {
  switch (status) {
    case "in_use":
      return "success";
    case "idle":
      return "warning";
    case "disposed":
      return "danger";
    default:
      return "neutral";
  }
}
