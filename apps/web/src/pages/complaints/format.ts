/**
 * Checkpoint 1C.2 — presentation-only helpers for the Complaint experience.
 *
 * These map backend-authoritative values to display tone/labels ONLY.
 * They store no business rule and drive no behavior (guard 15): the
 * workflow lifecycle, SLA truth, and authorization all remain in the
 * backend. Tone selection here is purely cosmetic and safe to hardcode.
 */
import type { ComplaintSla } from "../../lib/api";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/** Cosmetic tone for a Workflow instance status. */
export function statusTone(instanceStatus: string | null | undefined): Tone {
  switch (instanceStatus) {
    case "approved":
      return "success";
    case "rejected":
    case "cancelled":
      return "danger";
    case "in_progress":
      return "info";
    default:
      return "neutral";
  }
}

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

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function formatDateShort(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
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
