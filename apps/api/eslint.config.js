// Minimal flat ESLint config for Checkpoint 0A. Extended with stricter
// domain-boundary rules (e.g. no cross-layer imports) in a later checkpoint.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
);
