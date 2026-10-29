/**
 * Bilingual UI (English + Indonesian).
 *
 * Mirrors `theme/ThemeProvider.tsx` on purpose: a versioned localStorage key,
 * an attribute on `<html>` so CSS and a pre-paint script can read it, and a
 * hook that falls back to the default instead of throwing.
 *
 * Persistence is per browser for now. Moving the choice to `users.preferred_locale`
 * is recorded as technical debt; see docs/technical-debt-register.md.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { translate, type MessageKey } from "./t";

export type Locale = "en" | "id";

/** Must stay in sync with the pre-paint script in index.html. */
export const LOCALE_STORAGE_KEY = "abixell.locale.v1";

const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (next: Locale) => void;
} | null>(null);

function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored === "en" || stored === "id" ? stored : null;
  } catch {
    // Private mode / disabled storage: fall back to the default silently.
    return null;
  }
}

export function LocaleProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale() ?? "en");

  useEffect(() => {
    document.documentElement.setAttribute("lang", locale);
    document.documentElement.setAttribute("data-locale", locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Preference is best-effort; the in-memory choice still applies.
    }
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Falls back to the default rather than throwing so a component can be
 *  rendered in isolation without the provider. */
export function useLocale() {
  const context = useContext(LocaleContext);
  return context ?? { locale: "en" as Locale, setLocale: () => {} };
}

/** `t(key, params)` type: string params return a string (usable in attributes
 *  like `placeholder` or `aria-label`); a ReactNode param returns a ReactNode
 *  (usable directly in JSX, e.g. `{count}` as a `<span>`). */
export type Translate = {
  (key: MessageKey, params?: Record<string, string | number>): string;
  (key: MessageKey, params: Record<string, ReactNode>): ReactNode;
};

/** Bound `t(key, params)`. Re-created only when the locale changes, so a
 *  component's render is one lookup per string and nothing else. */
export function useT(): Translate {
  const { locale } = useLocale();
  return useCallback(
    ((key: MessageKey, params?: Record<string, ReactNode>) =>
      translate(locale, key, params as Record<string, string | number>)) as Translate,
    [locale],
  );
}
