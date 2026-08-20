/**
 * Checkpoint 1C.2 — presentation-only helpers for the Complaint experience.
 *
 * These map backend-authoritative values to display tone/labels ONLY.
 * They store no business rule and drive no behavior (guard 15): the
 * workflow lifecycle, SLA truth, and authorization all remain in the
 * backend. Tone selection here is purely cosmetic and safe to hardcode.
 */
import type { ComplaintSla } from "../../lib/api";
import type { Tone } from "../../shared/format";

// Module-neutral helpers now live in `shared/` (blueprint §11A). Re-exported
// here so existing Complaint imports keep working unchanged.
export { statusTone, formatDate, formatDateShort } from "../../shared/format";

/** Cosmetic tone for a severity code (values are Tenant configuration; the
 * common ones get a colour, anything else falls back to neutral). */
export function severityTone(severity: string | null | undefined): Tone {
  switch ((severity ?? "").toLowerCase()) {
    case "critical":
      return "danger";
    case "major":
      return "warning";
    case "minor":
      return "neutral";
    default:
      return "neutral";
  }
}

/** Human, customer-friendly SLA indicator derived only from the backend's
 * authoritative `dueAt` (no independent SLA computation — guard 10). */
export function slaIndicator(sla: ComplaintSla): { label: string; tone: Tone } | null {
  if (!sla || !sla.dueAt) return null;
  const due = new Date(sla.dueAt).getTime();
  const now = Date.now();
  if (now > due) return { label: "Overdue", tone: "danger" };
  // "Due soon" if within 24h — a display threshold, not a business rule.
  if (due - now < 24 * 60 * 60 * 1000) return { label: "Due soon", tone: "warning" };
  return { label: "On track", tone: "success" };
}
