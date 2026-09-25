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
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
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
      className={`inline-flex min-h-[44px] items-center justify-center rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 sm:min-h-[36px] ${BUTTON_VARIANTS[variant]} ${className}`}
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
    <section className={`rounded-lg border border-slate-200 bg-white p-3 sm:p-4 lg:p-6 ${className}`}>
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
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{actions}</div>}
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

type AlertTone = "error" | "success" | "info" | "warning";

const ALERT_TONES: Record<AlertTone, string> = {
  error: "border border-red-200 bg-red-50 text-red-800",
  success: "border border-green-200 bg-green-50 text-green-800",
  info: "border border-blue-200 bg-blue-50 text-blue-800",
  warning: "border border-amber-200 bg-amber-50 text-amber-900",
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
  "mt-1 min-h-[44px] w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50 sm:min-h-[36px]";

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

/** Forwards its ref so a field can take focus programmatically (e.g. moving
 * focus to the input a validation failure belongs to). Additive: callers
 * that pass no ref are unaffected. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...rest }, ref) {
    return <input ref={ref} className={`${CONTROL_CLASS} ${className}`} {...rest} />;
  },
);

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
  /** Optional role used to create a stronger stacked-card hierarchy. */
  mobileRole?: "title" | "status" | "detail";
}

/** Generic, responsive table. Horizontal-scrolls inside its own container so
 * the page never scrolls sideways. Rows are optionally clickable. */
export function DataTable<T>({
  columns,
  rows,
  keyOf,
  onRowClick,
  empty,
  mobileBreakpoint = "sm",
}: {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  /** `md` keeps cards through 767px for dense admin views. Default preserves
   * every existing caller's original 640px transition. */
  mobileBreakpoint?: "sm" | "md";
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  const cardVisibility = mobileBreakpoint === "md" ? "md:hidden" : "sm:hidden";
  const tableVisibility = mobileBreakpoint === "md" ? "hidden md:block" : "hidden sm:block";

  return (
    <>
      {/* Mobile (Checkpoint 1C.7): stacked cards instead of a sideways-scrolling
          table, so dense operational/management tables stay usable on a phone. */}
      <ul className={`space-y-3 ${cardVisibility}`}>
        {rows.map((row) => {
          const titleColumns = columns.filter((column) => column.mobileRole === "title");
          const statusColumns = columns.filter((column) => column.mobileRole === "status");
          const detailColumns = columns.filter(
            (column) => column.mobileRole !== "title" && column.mobileRole !== "status",
          );
          const hasHierarchy = titleColumns.length > 0 || statusColumns.length > 0;

          return (
            <li
              key={keyOf(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`rounded-lg border border-slate-200 bg-white p-3 ${onRowClick ? "cursor-pointer active:bg-slate-50" : ""}`}
            >
              {hasHierarchy && (
                <div className="mb-2 flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
                  <div className="min-w-0 space-y-0.5">
                    {titleColumns.map((column, index) => (
                      <div key={index} className="break-words text-sm font-semibold text-slate-900">
                        {column.cell(row)}
                      </div>
                    ))}
                  </div>
                  <div className="shrink-0 space-y-1 text-right">
                    {statusColumns.map((column, index) => (
                      <div key={index}>{column.cell(row)}</div>
                    ))}
                  </div>
                </div>
              )}
              {(hasHierarchy ? detailColumns : columns).map((column, index) => (
                <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] items-start gap-3 py-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {column.header}
                  </span>
                  <span className="min-w-0 break-words text-right text-sm text-slate-700">
                    {column.cell(row)}
                  </span>
                </div>
              ))}
            </li>
          );
        })}
      </ul>

      {/* Desktop/tablet: the full table (still scrolls inside its own box). */}
      <div className={`${tableVisibility} overflow-x-auto rounded-lg border border-slate-200`}>
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column, index) => (
                <th
                  key={index}
                  scope="col"
                  className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 ${column.className ?? ""}`}
                >
                  {column.header}
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
                {columns.map((column, index) => (
                  <td key={index} className={`px-3 py-2 align-middle text-slate-700 ${column.className ?? ""}`}>
                    {column.cell(row)}
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

/* ------------------------------------------------------ Permission denied */

export function PermissionDeniedState({
  permission,
  action,
}: {
  permission?: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState
      title="You do not have access to this area"
      description={
        <>
          {permission ? (
            <>
              Viewing this area requires permission{" "}
              <code className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                {permission}
              </code>
              .
            </>
          ) : (
            "Your roles do not grant permission to view this area."
          )}{" "}
          Ask an administrator if you expect access.
        </>
      }
      action={action}
    />
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
