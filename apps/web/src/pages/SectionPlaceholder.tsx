/**
 * Checkpoint 1C.1 — Foundation placeholder for persona sections whose
 * experiences land in later checkpoints (1C.2–1C.6).
 *
 * This is an honest, routed "pending" state — NOT mock data and NOT a
 * fake dashboard. The route, navigation gating, shell, and component
 * foundation are all real and exercised here; only the section's own
 * data experience is intentionally not yet built.
 */
import { PageHeader, EmptyState } from "../shell/components/ui";

export function SectionPlaceholder({
  title,
  checkpoint,
  description,
}: {
  title: string;
  checkpoint: string;
  description: string;
}) {
  return (
    <div>
      <PageHeader title={title} subtitle={description} />
      <EmptyState
        title={`Coming in Checkpoint ${checkpoint}`}
        description="This area's navigation and access controls are in place. The interactive experience is being built as part of the next checkpoint."
      />
    </div>
  );
}
