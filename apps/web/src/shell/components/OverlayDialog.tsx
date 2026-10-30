import {
  useEffect,
  useId,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useT } from "../../i18n/LocaleProvider";

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

/** Stack of live dialogs, innermost last. Only the innermost one reacts to
 *  Escape, and the scroll lock is released only when the last dialog goes. */
const dialogStack: symbol[] = [];

/** Saved `body.style.overflow` from before the first dialog opened, plus how
 *  many live dialogs hold the lock. */
const scrollLock = { depth: 0, previous: "" };

function acquireScrollLock(): () => void {
  if (scrollLock.depth === 0) {
    scrollLock.previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLock.depth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLock.depth -= 1;
    if (scrollLock.depth === 0) {
      document.body.style.overflow = scrollLock.previous;
    }
  };
}

export function OverlayDialog({
  open,
  title,
  description,
  pending = false,
  stacked = false,
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
  /** True while another dialog is open above this one: this dialog then stops
   *  claiming to be the sole modal (no aria-modal, no background description
   *  for assistive tech). The stack order in the keydown handler above still
   *  decides who reacts to Escape and Tab. */
  stacked?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  // React 19: useRef<T>(null) yields RefObject<T | null>, so the props must
  // accept the null or every call site is a type error.
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
  size?: "md" | "lg";
}) {
  const t = useT();
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const descriptionId = `${generatedId}-description`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const capturedRestoreFocusRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(pending);
  const onCloseRef = useRef(onClose);

  // Mirror the latest props into refs so the keydown listener below stays
  // bound for the dialog's whole lifetime instead of re-subscribing on every
  // render. Written in an effect rather than during render: a render-phase
  // write is discarded when React abandons a render and applied twice under
  // StrictMode, either of which leaves the listener reading a value from a
  // render that never committed.
  useEffect(() => {
    pendingRef.current = pending;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    const dialogId = Symbol("overlay-dialog");
    dialogStack.push(dialogId);
    const releaseScrollLock = acquireScrollLock();

    capturedRestoreFocusRef.current ??=
      suppliedRestoreFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const focusFrame = window.requestAnimationFrame(() => {
      const target =
        initialFocusRef?.current ??
        (dialogRef.current ? focusableElements(dialogRef.current)[0] : null) ??
        dialogRef.current;
      target?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // A stacked dialog owns this keystroke: the innermost one either
        // closes or (while pending) refuses, and the outer one must not act
        // on the same press in either case.
        if (dialogStack[dialogStack.length - 1] !== dialogId) return;
        if (!pendingRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      // Tab belongs to the innermost dialog too; an outer one would otherwise
      // pull focus back into itself from inside the dialog stacked over it.
      if (dialogStack[dialogStack.length - 1] !== dialogId) return;

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
      const index = dialogStack.lastIndexOf(dialogId);
      const wasTopmost = index === dialogStack.length - 1;
      if (index !== -1) dialogStack.splice(index, 1);
      releaseScrollLock();
      // Restore focus when this was topmost. A dialog below may remain mounted
      // after a nested dialog closes; it is no longer inert at this point and
      // owns the captured trigger again. Never steal focus from a dialog above.
      if (wasTopmost) {
        const restoreTarget = capturedRestoreFocusRef.current;
        capturedRestoreFocusRef.current = null;
        window.requestAnimationFrame(() => restoreTarget?.focus());
      }
    };
  }, [initialFocusRef, open, suppliedRestoreFocusRef]);

  if (!open) return null;

  function handleBackdropClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!pending && event.target === event.currentTarget) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-70 flex items-end justify-center overflow-y-auto bg-black/50 p-0 sm:items-center sm:p-4"
      onMouseDown={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal={stacked ? undefined : "true"}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={pending || undefined}
        tabIndex={-1}
        className={`flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-t-lg border border-line bg-panel shadow-2xl focus:outline-hidden sm:max-h-[calc(100dvh-2rem)] sm:rounded ${
          size === "lg" ? "sm:max-w-3xl" : "sm:max-w-xl"
        }`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description && (
              <div id={descriptionId} className="mt-1 text-sm text-ink-dim">
                {description}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label={t("dialog.close")}
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded text-xl leading-none text-ink-dim hover:bg-panel-2 hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-line bg-panel-2 px-4 py-3 sm:px-5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
