/**
 * Formats a Numbering pattern (e.g. "TCK-{YYYY}-{SEQ:5}") into a concrete
 * number string. Supported tokens:
 *   {YYYY}   4-digit year
 *   {MM}     2-digit month
 *   {SEQ}    sequence number, no padding
 *   {SEQ:N}  sequence number, zero-padded to width N
 *
 * Pattern validity (must contain a {SEQ} token) is enforced by the
 * Schema Registry (area='numbering', key='pattern') before a pattern is
 * ever saved — see schema-registry-validator.ts — so this function does
 * not need to re-validate that.
 */
export function formatNumber(pattern: string, sequence: number, now: Date): string {
  return pattern
    .replace(/\{YYYY\}/g, String(now.getUTCFullYear()))
    .replace(/\{MM\}/g, String(now.getUTCMonth() + 1).padStart(2, "0"))
    .replace(/\{SEQ:(\d+)\}/g, (_match, width: string) =>
      String(sequence).padStart(Number(width), "0"),
    )
    .replace(/\{SEQ\}/g, String(sequence));
}
