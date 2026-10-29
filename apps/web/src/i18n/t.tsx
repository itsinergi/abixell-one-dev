/**
 * Message lookup. No i18n library: the surface is a few hundred keys, and a
 * context plus one function is all that is needed.
 *
 * `en.ts` is the canonical source and defines the key type; `id.ts` is typed
 * `Record<MessageKey, string>`, so a missing Indonesian string fails `tsc`
 * instead of rendering a raw key. That is the cheapest completeness check.
 *
 * ponytail: interpolation only, no plural or ICU. Indonesian has no count
 * inflection, so the only caller that would need it is English plurals — add
 * a library when a count-bearing string actually appears.
 */
import { en, type MessageKey } from "./dictionaries/en";
import { id } from "./dictionaries/id";
import type { Locale } from "./LocaleProvider";

export type { MessageKey };

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, id };

import type { ReactNode } from "react";

export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string;
export function translate(
  locale: Locale,
  key: MessageKey,
  params: Record<string, ReactNode>,
): ReactNode;
export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, ReactNode>,
): ReactNode {
  const template = DICTIONARIES[locale][key] ?? en[key];
  if (!params) return template;

  // If all params are strings/numbers, return string. Else JSX.
  const hasElement = Object.values(params).some(
    (v) => typeof v !== "string" && typeof v !== "number",
  );

  if (!hasElement) {
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  }

  // JSX elements present: split template into parts & interleave.
  const parts: ReactNode[] = [];
  let lastIdx = 0;
  const regex = /\{(\w+)\}/g;
  let match;

  while ((match = regex.exec(template)) !== null) {
    if (match.index > lastIdx) {
      parts.push(template.slice(lastIdx, match.index));
    }
    const name = match[1];
    parts.push(name in params ? params[name] : match[0]);
    lastIdx = regex.lastIndex;
  }

  if (lastIdx < template.length) {
    parts.push(template.slice(lastIdx));
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
