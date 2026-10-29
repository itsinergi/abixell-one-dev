/**
 * Module-neutral presentation helpers (Phase 2).
 *
 * `shared/` holds technical building blocks with no product semantics
 * (blueprint §11A) — these map backend-authoritative values to display
 * tone/text ONLY. They carry no business rule and drive no behaviour:
 * lifecycle, SLA truth, and authorization all remain in the backend.
 *
 * This also retires the "shared date formatter" debt: the Complaint module
 * now re-exports these instead of owning them, so other modules no longer
 * import presentation helpers from a business module's folder.
 */
import { translate } from "../i18n/t";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/** `document.documentElement.lang` is kept in sync by `LocaleProvider` and
 * the pre-paint script in index.html, so it is the one place a module
 * outside React can read the active locale without a second source of
 * truth. Falls back to "en" when read before either has run (SSR, tests). */
function activeLocale(): "en" | "id" {
  return typeof document !== "undefined" && document.documentElement.lang === "id" ? "id" : "en";
}

function localeTag(): string {
  return activeLocale() === "id" ? "id-ID" : "en-US";
}

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

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(localeTag());
}

export function formatDateShort(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(localeTag());
}

/** Groups a decimal string for display without converting it to a number. */
export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = "00"] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cents = (fraction + "00").slice(0, 2);
  return `${negative ? "−" : ""}${grouped},${cents}`;
}

/** Display-only due-date indicator derived solely from a backend-provided
 * timestamp — never an independent SLA computation. */
export function dueIndicator(dueAt: string | null | undefined): { label: string; tone: Tone } | null {
  if (!dueAt) return null;
  const due = new Date(dueAt).getTime();
  const now = Date.now();
  const locale = activeLocale();
  if (now > due) return { label: translate(locale, "due.overdue"), tone: "danger" };
  if (due - now < 24 * 60 * 60 * 1000) return { label: translate(locale, "due.soon"), tone: "warning" };
  return { label: translate(locale, "due.onTrack"), tone: "success" };
}
