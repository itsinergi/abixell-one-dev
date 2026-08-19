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
import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";

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
      className={`inline-flex items-center justify-center rounded px-3 py-1.5 text-sm font-medium transition-colors ${BUTTON_VARIANTS[variant]} ${className}`}
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
