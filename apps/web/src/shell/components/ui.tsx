/**
 * Checkpoint 1C.1 — Lightweight reusable component foundation.
 *
 * Intentionally minimal (FD-1C-03): only the generic primitives the 1C.1
 * experience foundation actually uses live here. Data-heavy primitives
 * (DataTable, Timeline, Form fields) are deferred to the checkpoints that
 * first need them, to avoid shipping unused abstractions. Every component
 * reuses the existing Tailwind design language (slate palette, subtle
 * borders, `text-sm` scale) rather than introducing a new visual system.
 */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/* ------------------------------------------------------------------ Button */

type ButtonVariant = "primary" | "secondary" | "ghost";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50",
  secondary:
    "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50",
  ghost: "text-slate-600 hover:bg-slate-100 disabled:opacity-50",
};

export function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex min-h-[36px] items-center justify-center rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 ${BUTTON_VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------- Card */

export function Card({
  className = "",
  children,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`}>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------- PageHeader */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- Badge */

export function Badge({
  children,
  className = "",
}: PropsWithChildren<{ className?: string }>) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ${className}`}
    >
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- StatusPill */

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const STATUS_TONES: Record<StatusTone, string> = {
  neutral: "bg-slate-100 text-slate-600",
  info: "bg-blue-50 text-blue-700",
  success: "bg-green-50 text-green-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
};

export function StatusPill({
  tone = "neutral",
  children,
}: PropsWithChildren<{ tone?: StatusTone }>) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------- EmptyState */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      {description && (
        <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- Spinner */

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"
      role="status"
      aria-live="polite"
    >
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
        aria-hidden="true"
      />
      {label}
    </div>
  );
}

/* ------------------------------------------------------------------- Alert */

type AlertTone = "error" | "success" | "info";

const ALERT_TONES: Record<AlertTone, string> = {
  error: "bg-red-50 text-red-700",
  success: "bg-green-50 text-green-700",
  info: "bg-blue-50 text-blue-700",
};

/** Inline feedback primitive — the foundation's feedback mechanism for
 * 1C.1. A global toast/queue is deliberately deferred until a page needs
 * cross-view notifications. */
export function Alert({
  tone = "info",
  children,
}: PropsWithChildren<{ tone?: AlertTone }>) {
  return (
    <div className={`rounded p-2 text-sm ${ALERT_TONES[tone]}`} role="alert">
      {children}
    </div>
  );
}

/* ------------------------------------------------- Form primitives (1C.2) */

const CONTROL_CLASS =
  "mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-50";

/** Labelled field wrapper — pairs a label with a control and optional hint. */
export function Field({
  label,
  required,
  hint,
  children,
}: PropsWithChildren<{ label: string; required?: boolean; hint?: ReactNode }>) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${CONTROL_CLASS} ${className}`} {...rest} />;
}

export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${CONTROL_CLASS} ${className}`} {...rest} />;
}

export function Select({
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${CONTROL_CLASS} ${className}`} {...rest}>
      {children}
    </select>
  );
}

/* --------------------------------------------------------- DataTable (1C.3) */

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  /** Optional extra classes for the cell (e.g. alignment, width). */
  className?: string;
}

/** Generic, responsive table. Horizontal-scrolls inside its own container so
 * the page never scrolls sideways. Rows are optionally clickable. */
export function DataTable<T>({
  columns,
  rows,
  keyOf,
  onRowClick,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <>
      {/* Mobile (Checkpoint 1C.7): stacked cards instead of a sideways-scrolling
          table, so dense operational/management tables stay usable on a phone. */}
      <ul className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <li
            key={keyOf(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`rounded-lg border border-slate-200 bg-white p-3 ${onRowClick ? "cursor-pointer active:bg-slate-50" : ""}`}
          >
            {columns.map((c, i) => (
              <div key={i} className="flex items-start justify-between gap-3 py-0.5">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{c.header}</span>
                <span className="text-right text-sm text-slate-700">{c.cell(row)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>

      {/* Desktop/tablet: the full table (still scrolls inside its own box). */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 sm:block">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((c, i) => (
                <th
                  key={i}
                  className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 ${c.className ?? ""}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => (
              <tr
                key={keyOf(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? "cursor-pointer hover:bg-slate-50" : ""}
              >
                {columns.map((c, i) => (
                  <td key={i} className={`px-3 py-2 align-middle text-slate-700 ${c.className ?? ""}`}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------------------------------------------------- Timeline (1C.2) */

export interface TimelineItem {
  key: string;
  title: string;
  timestamp?: string | null;
  detail?: ReactNode;
}

/** Vertical progress timeline — generic, ordered oldest→newest by caller. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">No activity recorded yet.</p>;
  }
  return (
    <ol className="relative ml-2 border-l border-slate-200">
      {items.map((item) => (
        <li key={item.key} className="mb-4 ml-4">
          <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-slate-300" />
          <div className="text-sm font-medium text-slate-800">{item.title}</div>
          {item.timestamp && (
            <div className="text-xs text-slate-400">
              {new Date(item.timestamp).toLocaleString()}
            </div>
          )}
          {item.detail && <div className="mt-0.5 text-sm text-slate-600">{item.detail}</div>}
        </li>
      ))}
    </ol>
  );
}
