/**
 * Epic 4 Wave 1 — design tokens for the direction recorded in DESIGN.md.
 *
 * The product direction is "an instrument panel that is warm and calm": a
 * cool-neutral ground, one accent, and four status colors that are reserved
 * for status. Everything a page paints should name a token here rather than a
 * Tailwind palette value, so the dark theme can become the default later by
 * changing a single attribute instead of rewriting every component.
 *
 * Dark values are authored first because dark is the intended default. The
 * default is light for now (see the `theme` state in `useTheme`): 75 of 97 web
 * files still use literal palette classes, so switching the default before
 * those migrate would render dark headings on a dark background. Tokens are
 * complete for both themes today; only the default is deferred.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

export type ThemeChoice = "dark" | "light";

/** Kept in a versioned key so a future token revision can invalidate a stored
 * choice that was made against the old direction. */
const STORAGE_KEY = "abixell.theme.v1";

const ThemeContext = createContext<{
  theme: ThemeChoice;
  setTheme: (next: ThemeChoice) => void;
} | null>(null);

function readStoredTheme(): ThemeChoice | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : null;
  } catch {
    // Private mode / disabled storage: fall back to the default silently.
    return null;
  }
}

/**
 * Theme provider. The choice is applied as an attribute on `<html>` rather
 * than a class so it is readable from CSS and from a first-paint inline
 * script (see index.html), which is what keeps a reload from flashing the
 * wrong theme.
 */
export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setThemeState] = useState<ThemeChoice>(
    () => readStoredTheme() ?? "light",
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference is best-effort; the in-memory choice still applies.
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Falls back to the default rather than throwing so a component can be
 * rendered in isolation (tests, storybook) without the provider. */
export function useTheme() {
  const context = useContext(ThemeContext);
  return context ?? { theme: "light" as ThemeChoice, setTheme: () => {} };
}
