/**
 * Epic 4 Wave 2 §4.4 step 11 — governed Create User.
 *
 * One confirmation creates the User together with an optional initial
 * assignment set. `pairs` defaults to empty on the server, so an account with
 * no assignment is valid and has no effective access; the browser never
 * fabricates one. Status is not settable here: the browser has no say in it,
 * and the account starts from the server's governed default.
 *
 * The initial pairs reuse the batch preview/confirm surface via
 * AssignmentPairEditor only as a choice editor — the create call itself is
 * one POST /admin/users whose in-transaction pair policy is the same one the
 * batch surface runs (§4.4 D).
 */
import { useCallback, useRef, useState } from "react";
import { useAuth } from "../../../auth/AuthContext";
import { api, type AdminRoleAssignmentInput } from "../../../lib/api";
import { Alert, Button, Field, Input } from "../../../shell/components/ui";
import { OverlayDialog } from "../../../shell/components/OverlayDialog";
import {
  AssignmentPairEditor,
  assignmentPairsHaveDuplicate,
  errorMessage,
  useAssignmentOptions,
} from "./AdminAssignmentControls";

type Step = "edit" | "pending" | "success";

export function AdminCreateUserDialog({
  onClose,
  onCreated,
  restoreFocusRef,
}: {
  onClose: () => void;
  onCreated: (message: string) => void;
  restoreFocusRef?: React.RefObject<HTMLElement>;
}) {
  const { session } = useAuth();
  const token = session!.accessToken;
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState<Step>("edit");
  const [error, setError] = useState<string | null>(null);
  const [showPairs, setShowPairs] = useState(false);
  const [pairs, setPairs] = useState<AdminRoleAssignmentInput[]>([]);
  // The governed choices are fetched only when the operator opts in, not on
  // every dialog open.
  const optionsState = useAssignmentOptions(showPairs);
  // A ref, not state: the create button can fire twice before a re-render
  // delivers the updated `pending`, and each POST creates a real user.
  const submitInFlight = useRef(false);

  const pending = step === "pending";

  const closeDialog = useCallback(() => {
    if (pending) return;
    onClose();
  }, [onClose, pending]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitInFlight.current || pending || !formRef.current) return;
    submitInFlight.current = true;
    const form = new FormData(formRef.current);
    const email = String(form.get("email") ?? "").trim();
    const fullName = String(form.get("fullName") ?? "").trim();
    const password = String(form.get("password") ?? "");

    if (email.length === 0 || fullName.length === 0 || password.length < 8) {
      setError("Email, full name, and a password of at least 8 characters are required.");
      return;
    }
    if (showPairs && assignmentPairsHaveDuplicate(pairs)) {
      setError("The same role and scope combination appears more than once.");
      return;
    }

    setStep("pending");
    setError(null);
    try {
      const result = await api.createAdminUser(token, {
        email,
        fullName,
        password,
        pairs: showPairs ? pairs : [],
      });
      setStep("success");
      onCreated(
        pairs.length > 0
          ? `User ${result.user.fullName} created with ${result.assignments.length} initial assignment${result.assignments.length === 1 ? "" : "s"}.`
          : `User ${result.user.fullName} created with no assignment.`,
      );
    } catch (err) {
      setError(errorMessage(err, "The user could not be created."));
      setStep("edit");
    } finally {
      submitInFlight.current = false;
    }
  }

  return (
    <OverlayDialog
      open
      title="Create user"
      description="Creates an account in this tenant. An initial assignment set is optional; a user with none has no effective access."
      pending={pending}
      onClose={closeDialog}
      restoreFocusRef={restoreFocusRef}
      size="lg"
      footer={
        step === "success" ? (
          <Button className="min-h-[44px]" onClick={closeDialog}>
            Done
          </Button>
        ) : (
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
              disabled={pending}
              onClick={() => formRef.current?.requestSubmit()}
            >
              {pending ? "Creating…" : "Create user"}
            </Button>
          </>
        )
      }
    >
      {step === "success" ? (
        <Alert tone="success">
          The user was created. The user list has been reloaded with the authoritative
          access view.
        </Alert>
      ) : (
        <form ref={formRef} onSubmit={submit} className="space-y-5">
          {error && <Alert tone="error">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" required>
              <Input
                name="email"
                type="email"
                required
                maxLength={255}
                autoComplete="off"
                disabled={pending}
              />
            </Field>
            <Field label="Full name" required>
              <Input
                name="fullName"
                required
                minLength={1}
                maxLength={200}
                autoComplete="off"
                disabled={pending}
              />
            </Field>
          </div>
          <Field
            label="Password"
            required
            hint="At least 8 characters. The initial password is hashed server-side."
          >
            <Input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              disabled={pending}
            />
          </Field>

          <div className="border-t border-line pt-4">
            {showPairs ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">
                    Initial assignments (optional)
                  </h3>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPairs([]);
                      setShowPairs(false);
                    }}
                    disabled={pending}
                  >
                    Remove initial assignments
                  </Button>
                </div>
                {optionsState.status === "loading" || optionsState.status === "idle" ? (
                  <p className="text-sm text-ink-dim">Loading governed choices…</p>
                ) : optionsState.options ? (
                  <AssignmentPairEditor
                    options={optionsState.options}
                    pairs={pairs}
                    onChange={setPairs}
                    addLabel="Add initial assignment"
                  />
                ) : (
                  <Alert tone="warning">
                    Assignment options could not be loaded. The user can still be
                    created without an initial assignment; access can be added after
                    creation.
                  </Alert>
                )}
              </div>
            ) : (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => setShowPairs(true)}
              >
                Add initial assignments
              </Button>
            )}
          </div>
          <p className="text-sm text-ink-dim">
            Account status starts from the governed default and cannot be set here.
            When initial assignments are included, they are applied in the same
            transaction: if one pair is refused, the user is not created.
          </p>
        </form>
      )}
    </OverlayDialog>
  );
}
