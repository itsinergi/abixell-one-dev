/**
 * Epic 4 Wave 2 §4.4 steps 12–14 — batch assignment of internal access.
 *
 * One selection set becomes one preview and one confirmation (§4.4 C). The
 * preview is a real server round trip, not a client-side echo: it resolves
 * every pair against the same policy the confirmation will run and returns a
 * content hash binding actor, target, and pairs. The confirmation submits the
 * exact previewed pairs with that hash, so a mid-flow change cannot be
 * committed under an earlier approval.
 *
 * After the server accepts the batch no UI path repeats the POST; verification
 * is a GET reload of the target's authoritative access, and a failure there
 * offers "retry verification" only.
 */
import { useCallback, useRef, useState } from "react";
import { useAuth } from "../../../auth/AuthContext";
import {
  api,
  ApiError,
  type AdminAssignmentBatchPreview,
  type AdminRoleAssignmentInput,
} from "../../../lib/api";
import { Alert, Button, Spinner } from "../../../shell/components/ui";
import { OverlayDialog } from "../../../shell/components/OverlayDialog";
import {
  AssignmentPairEditor,
  assignmentPairKey,
  errorMessage,
  useAssignmentOptions,
} from "./AdminAssignmentControls";

type Step =
  | "edit"
  | "previewing"
  | "review"
  | "pending"
  | "failed"
  | "unknown-outcome"
  | "verification-failed"
  | "success";

const SCOPE_LABELS: Record<string, string> = {
  tenant: "Tenant-wide",
  organization_unit: "Organization unit",
  customer: "Customer",
};

export function AssignAccessDialog({
  targetUserId,
  targetName,
  targetEmail,
  onClose,
  onApplied,
  restoreFocusRef,
}: {
  targetUserId: string;
  targetName: string;
  targetEmail: string;
  onClose: () => void;
  onApplied: (message: string) => void;
  restoreFocusRef?: React.RefObject<HTMLElement>;
}) {
  const { session, logout } = useAuth();
  const token = session!.accessToken;
  const optionsState = useAssignmentOptions(true);
  const [pairs, setPairs] = useState<AdminRoleAssignmentInput[]>([]);
  const [step, setStep] = useState<Step>("edit");
  const [preview, setPreview] = useState<AdminAssignmentBatchPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acceptedIds, setAcceptedIds] = useState<string[] | null>(null);
  // A ref, not state: the confirm button can fire twice before a re-render
  // delivers the updated `pending`, and each POST is a real grant.
  const confirmInFlight = useRef(false);

  const pending = step === "previewing" || step === "pending";

  const closeDialog = useCallback(() => {
    if (pending) return;
    onClose();
  }, [onClose, pending]);

  async function requestPreview() {
    if (pending || pairs.length === 0) return;
    setStep("previewing");
    setError(null);
    try {
      const result = await api.previewAdminUserAssignments(token, targetUserId, {
        pairs,
      });
      setPreview(result);
      setStep("review");
    } catch (err) {
      setError(errorMessage(err, "The batch could not be reviewed."));
      setStep("edit");
    }
  }

  async function verifyAcceptedBatch(createdIds: string[]) {
    const authoritative = await api.adminUserAccess(token, targetUserId);
    const present = new Set(
      authoritative.roleAssignments.map((assignment) => assignment.id),
    );
    const missing = createdIds.filter((id) => !present.has(id));
    if (missing.length > 0) {
      throw new Error(
        "The authoritative reload did not contain every accepted assignment.",
      );
    }
    setStep("success");
    onApplied(
      `${createdIds.length} assignment${createdIds.length === 1 ? "" : "s"} added for ${targetName}.`,
    );
  }

  function verificationMessage(err: unknown): string {
    if (err instanceof ApiError && err.status === 401) {
      return "The batch was accepted, but your session expired before the updated access could be read back.";
    }
    if (err instanceof ApiError && err.status === 403) {
      return "The batch was accepted, but your current access cannot reload the user to verify it.";
    }
    const detail =
      err instanceof Error ? err.message : "The updated access could not be reloaded.";
    return `The batch was accepted, but verification could not be completed: ${detail}`;
  }

  async function confirmBatch() {
    if (confirmInFlight.current || pending || !preview) return;
    confirmInFlight.current = true;
    setStep("pending");
    setError(null);
    let createdIds: string[];
    try {
      const result = await api.confirmAdminUserAssignments(token, targetUserId, {
        pairs,
        previewHash: preview.previewHash,
        confirm: true,
      });
      createdIds = result.created.map((assignment) => assignment.id);
    } catch (err) {
      if (err instanceof ApiError) {
        // The server answered: the batch was refused, nothing was written.
        setError(errorMessage(err, "The batch could not be applied."));
        setStep("failed");
      } else {
        // No answer arrived. The POST may have been applied, so this flow must
        // not return to an editable confirm that could apply it a second time.
        setError(
          "The server did not answer. The batch may or may not have been applied; it will not be retried here. Verify the user's current access instead.",
        );
        setStep("unknown-outcome");
      }
      return;
    } finally {
      confirmInFlight.current = false;
    }

    setAcceptedIds(createdIds);
    try {
      await verifyAcceptedBatch(createdIds);
    } catch (err) {
      setError(verificationMessage(err));
      setStep("verification-failed");
    }
  }

  async function retryVerification() {
    if (pending || !acceptedIds) return;
    setStep("pending");
    setError(null);
    try {
      await verifyAcceptedBatch(acceptedIds);
    } catch (err) {
      setError(verificationMessage(err));
      setStep("verification-failed");
    }
  }

  // Read once so the closure below narrows: a property access on state inside
  // a callback cannot rely on the `||` chain's narrowing of it.
  const options = optionsState.options;
  const reviewDisabled =
    pairs.length === 0 ||
    options === null ||
    pairs.some(
      (pair) =>
        pair.scopeType === "customer" ||
        (pair.scopeType === "tenant" && !options.canAssignTenantScope),
    );

  return (
    <OverlayDialog
      open
      title={`Assign access · ${targetName}`}
      description={<span className="break-all">{targetEmail}</span>}
      pending={pending}
      onClose={closeDialog}
      restoreFocusRef={restoreFocusRef}
      size="lg"
      footer={
        step === "edit" || step === "previewing" ? (
          <>
            <Button
              variant="secondary"
              className="min-h-[44px]"
              onClick={closeDialog}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              className="min-h-[44px]"
              disabled={pending || reviewDisabled}
              onClick={() => void requestPreview()}
            >
              {step === "previewing" ? "Reviewing…" : "Review batch"}
            </Button>
          </>
        ) : step === "review" ? (
          <>
            <Button
              variant="secondary"
              className="min-h-[44px]"
              onClick={() => {
                setPreview(null);
                setStep("edit");
              }}
            >
              Back
            </Button>
            <Button className="min-h-[44px]" onClick={() => void confirmBatch()}>
              Confirm {preview?.pairs.length ?? 0}{" "}
              {(preview?.pairs.length ?? 0) === 1 ? "assignment" : "assignments"}
            </Button>
          </>
        ) : step === "failed" ? (
          <>
            <Button
              variant="secondary"
              className="min-h-[44px]"
              onClick={() => {
                setError(null);
                setStep("edit");
              }}
            >
              Back
            </Button>
          </>
        ) : step === "unknown-outcome" ? (
          <Button variant="secondary" className="min-h-[44px]" onClick={closeDialog}>
            Close
          </Button>
        ) : step === "verification-failed" ? (
          <>
            <Button
              variant="secondary"
              className="min-h-[44px]"
              onClick={closeDialog}
            >
              Close
            </Button>
            <Button
              className="min-h-[44px]"
              disabled={!acceptedIds}
              onClick={() => void retryVerification()}
            >
              Retry verification
            </Button>
          </>
        ) : step === "pending" ? (
          <Button className="min-h-[44px]" disabled>
            {acceptedIds ? "Verifying applied batch…" : "Applying batch…"}
          </Button>
        ) : null
      }
    >
      {step === "success" && (
        <Alert tone="success">
          The server confirmed the batch and the user's access was reloaded.
        </Alert>
      )}

      {step === "verification-failed" && (
        <div className="space-y-4">
          <Alert tone="warning">
            <div className="space-y-1">
              <p className="font-medium">Batch applied; verification reload failed.</p>
              <p>{error}</p>
              <p>
                Retry verification reloads the user's access with GET only. It will
                not repeat the assignment change.
              </p>
            </div>
          </Alert>
          {preview && <PreviewSummary preview={preview} applied />}
        </div>
      )}

      {step === "unknown-outcome" && (
        <div className="space-y-4">
          <Alert tone="warning">
            <div className="space-y-1">
              <p className="font-medium">Batch outcome unknown.</p>
              <p>{error}</p>
              <p>
                Reopen this user's access view to see the authoritative current
                state; this dialog will not repeat the change.
              </p>
            </div>
          </Alert>
          {preview && <PreviewSummary preview={preview} applied />}
        </div>
      )}

      {(step === "review" || step === "pending" || step === "failed") && preview && (
        <div className="space-y-5">
          {error && <Alert tone="error">{error}</Alert>}
          <PreviewSummary preview={preview} />
          {step === "pending" && (
            <Alert tone="info">
              {acceptedIds
                ? "The batch was already accepted. Access is being reloaded with GET only so the result can be verified. This dialog cannot be closed yet."
                : "The server is applying every pair in one transaction. This dialog cannot be closed yet."}
            </Alert>
          )}
        </div>
      )}

      {(step === "edit" || step === "previewing") && (
        <div className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          {optionsState.status === "loading" || optionsState.status === "idle" ? (
            <Spinner label="Loading governed choices…" />
          ) : optionsState.status === "session-expired" ? (
            <Alert tone="warning">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>Your session expired before the picker could be loaded.</span>
                <Button variant="secondary" onClick={logout}>
                  Sign in again
                </Button>
              </div>
            </Alert>
          ) : optionsState.status === "error" || optionsState.status === "denied" ? (
            <Alert tone="error">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  {optionsState.error ??
                    "Assignment options are unavailable to your current access."}
                </span>
                <Button variant="secondary" onClick={optionsState.reload}>
                  Retry
                </Button>
              </div>
            </Alert>
          ) : optionsState.options ? (
            <>
              <AssignmentPairEditor
                options={optionsState.options}
                pairs={pairs}
                onChange={setPairs}
              />
              <p className="text-sm text-ink-dim">
                The batch is applied in one transaction: if any pair is refused,
                none of them is written.
              </p>
            </>
          ) : null}
        </div>
      )}
    </OverlayDialog>
  );
}

function PreviewSummary({
  preview,
  applied = false,
}: {
  preview: AdminAssignmentBatchPreview;
  applied?: boolean;
}) {
  return (
    <section
      aria-labelledby="batch-preview-title"
      className="rounded border border-line-strong bg-panel-2 p-4"
    >
      <h3 id="batch-preview-title" className="text-sm font-semibold text-ink">
        {applied ? "Batch accepted by the server" : "What will be granted"}
      </h3>
      <ul className="mt-3 divide-y divide-line">
        {preview.pairs.map((pair) => (
          <li
            key={assignmentPairKey(pair)}
            className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink">{pair.roleName}</div>
              <code className="break-all font-mono text-xs text-ink-dim">
                {pair.roleCode}
              </code>
            </div>
            <div className="text-sm text-ink-dim sm:text-right">
              {SCOPE_LABELS[pair.scopeType] ?? pair.scopeType}
              {" · "}
              {pair.scopeType === "tenant"
                ? "Tenant-wide"
                : pair.scopeType === "legal_entity"
                  ? pair.scopeLegalEntityName ?? "Unknown Legal Entity"
                  : pair.scopeType === "organization_unit"
                    ? pair.scopeOrganizationUnitName ?? "Unknown organization unit"
                    : pair.scopeCustomerName ?? "Unknown customer"}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 break-all font-mono text-[11.5px] text-ink-faint">
        {preview.previewHash}
      </p>
      <p className="mt-1 text-xs text-ink-faint">
        This hash binds the confirmation to the pairs above for this user.
      </p>
    </section>
  );
}
