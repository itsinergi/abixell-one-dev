import {
  useEffect,
  useId,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}

/**
 * Shared modal foundation for governed, potentially destructive interactions.
 * Pending work cannot be dismissed, ensuring callers cannot hide an uncertain
 * mutation outcome while the server is still deciding it.
 */
export function OverlayDialog({
  open,
  title,
  description,
  pending = false,
  onClose,
  children,
  footer,
  initialFocusRef,
  restoreFocusRef: suppliedRestoreFocusRef,
  size = "md",
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  pending?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: React.RefObject<HTMLElement>;
  restoreFocusRef?: React.RefObject<HTMLElement>;
  size?: "md" | "lg";
}) {
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const descriptionId = `${generatedId}-description`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const capturedRestoreFocusRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(pending);
  const onCloseRef = useRef(onClose);
  pendingRef.current = pending;
  onCloseRef.current = onClose;

  if (open && capturedRestoreFocusRef.current === null) {
    capturedRestoreFocusRef.current =
      suppliedRestoreFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }

  useEffect(() => {
    if (!open) return;

    capturedRestoreFocusRef.current ??=
      suppliedRestoreFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      const target =
        initialFocusRef?.current ??
        (dialogRef.current ? focusableElements(dialogRef.current)[0] : null) ??
        dialogRef.current;
      target?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!pendingRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      capturedRestoreFocusRef.current?.focus();
      capturedRestoreFocusRef.current = null;
    };
  }, [initialFocusRef, open, suppliedRestoreFocusRef]);

  if (!open) return null;

  function handleBackdropClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!pending && event.target === event.currentTarget) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center overflow-y-auto bg-slate-950/50 p-0 sm:items-center sm:p-4"
      onMouseDown={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={pending || undefined}
        tabIndex={-1}
        className={`flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-t-xl bg-white shadow-2xl focus:outline-none sm:max-h-[calc(100dvh-2rem)] sm:rounded-xl ${
          size === "lg" ? "sm:max-w-3xl" : "sm:max-w-xl"
        }`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-slate-900">
              {title}
            </h2>
            {description && (
              <div id={descriptionId} className="mt-1 text-sm text-slate-500">
                {description}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close dialog"
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-xl leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
