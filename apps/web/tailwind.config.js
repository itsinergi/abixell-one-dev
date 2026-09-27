/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Design tokens from DESIGN.md / index.css. Semantic names on purpose:
      // a component says `bg-panel`, not a palette value, so theme and accent
      // changes stay in CSS. `slate-*` and friends keep working untouched for
      // pages that have not migrated yet.
      colors: {
        ground: "var(--bg)",
        panel: "var(--surface)",
        "panel-2": "var(--surface-2)",
        "panel-3": "var(--surface-3)",
        line: "var(--border)",
        "line-strong": "var(--border-strong)",
        ink: "var(--text)",
        "ink-dim": "var(--text-dim)",
        "ink-faint": "var(--text-faint)",
        accent: {
          DEFAULT: "var(--accent)",
          line: "var(--accent-line)",
          soft: "var(--accent-soft)",
          on: "var(--accent-on)",
        },
        status: {
          ok: "var(--ok)",
          warn: "var(--warn)",
          danger: "var(--danger)",
          idle: "var(--idle)",
          "ok-soft": "var(--ok-soft)",
          "warn-soft": "var(--warn-soft)",
          "danger-soft": "var(--danger-soft)",
          "idle-soft": "var(--idle-soft)",
        },
      },
      // DESIGN.md §3 — dense: 32px table rows, 28px inline controls.
      height: {
        row: "var(--row)",
        control: "var(--control)",
      },
      minHeight: {
        row: "var(--row)",
        control: "var(--control)",
      },
      // DESIGN.md §5 — uniform 3px corners, no pill shapes.
      borderRadius: {
        DEFAULT: "var(--radius)",
      },
      // DESIGN.md §5 — control transitions only, 120ms.
      transitionDuration: {
        DEFAULT: "120ms",
      },
    },
  },
  plugins: [],
};
