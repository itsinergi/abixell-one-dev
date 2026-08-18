/**
 * Deliberately minimal template renderer — `{{field}}` / `{{nested.path}}`
 * interpolation against a Domain Event's payload, no conditionals or
 * loops. Same anti-overengineering posture as 0D's ConditionExpression: a
 * full templating language is not needed to prove Notification Templates
 * are genuine Tenant Configuration (doc 05/06), not hardcoded strings.
 */
export function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const value = path
      .split(".")
      .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), data);
    return value === undefined || value === null ? "" : String(value);
  });
}
