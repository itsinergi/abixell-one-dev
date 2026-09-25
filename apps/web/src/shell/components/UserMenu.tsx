/**
 * Epic 2 Wave 1 — avatar dropdown for shell header and drawer.
 *
 * Draft without direction (no DESIGN.md) — dials ENERGY 1 / RHYTHM 1 /
 * MOTION 1. Uses an initials circle, never an invented profile asset.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

function initialsOf(fullName?: string, email?: string): string {
  const name = (fullName ?? "").trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
  }
  const mail = (email ?? "").trim();
  return mail ? mail.slice(0, 2).toUpperCase() : "?";
}

export function UserMenu({
  fullName,
  email,
  onSignOut,
}: {
  fullName?: string;
  email?: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        buttonRef.current?.focus();
        return;
      }
      if (event.key === "Tab") {
        close();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
        if (!items || items.length === 0) return;
        const list = Array.from(items);
        const currentIndex = list.indexOf(document.activeElement as HTMLElement);
        const nextIndex =
          event.key === "ArrowDown"
            ? (currentIndex + 1) % list.length
            : (currentIndex - 1 + list.length) % list.length;
        list[nextIndex]?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  }, [open]);

  const initials = initialsOf(fullName, email);
  const displayName = fullName || "User";

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((prev) => !prev)}
        className="flex min-h-[44px] items-center gap-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-white"
        >
          {initials}
        </span>
        <span className="hidden min-w-0 flex-col items-start text-left sm:flex">
          <span className="max-w-[10rem] truncate text-sm font-medium text-slate-800">{displayName}</span>
          {email && <span className="max-w-[10rem] truncate text-xs text-slate-500">{email}</span>}
        </span>
      </button>
      {open && (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label="User menu"
          className="absolute right-0 z-30 mt-2 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          <div className="border-b border-slate-100 px-3 py-2 sm:hidden">
            <div className="truncate text-sm font-medium text-slate-800">{displayName}</div>
            {email && <div className="truncate text-xs text-slate-500">{email}</div>}
          </div>
          <NavLink
            to="/profile"
            role="menuitem"
            tabIndex={-1}
            onClick={close}
            className="block min-h-[44px] px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
          >
            Profile
          </NavLink>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              close();
              onSignOut();
            }}
            className="block min-h-[44px] w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
