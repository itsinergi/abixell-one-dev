/**
 * Epic 2 Wave 1 — self-service profile.
 *
 * Draft without direction (no DESIGN.md) — dials ENERGY 1 / RHYTHM 1 /
 * MOTION 1. Form uses existing shell primitives and no decorative assets.
 */
import { useId, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError, api } from "../lib/api";
import { Alert, Button, Card, Field, Input, PageHeader } from "../shell/components/ui";

export function ProfilePage() {
  const { session, updateSession, logout } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState(session?.fullName ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  // Which field the last failure belongs to, so the message is announced and
  // focus lands where the fix is. `null` = form-level (or success).
  const [errorField, setErrorField] = useState<"fullName" | "password" | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const feedbackId = useId();

  function fail(field: "fullName" | "password", message: string, target: HTMLElement | null) {
    setErrorField(field);
    setFeedback({ tone: "error", message });
    target?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setErrorField(null);
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      fail("fullName", "Full name is required.", nameRef.current);
      return;
    }
    if (password && !currentPassword) {
      fail("password", "Enter your current password to set a new password.", newPasswordRef.current);
      return;
    }
    if (currentPassword && !password) {
      fail("password", "Enter a new password with your current password.", newPasswordRef.current);
      return;
    }
    if (password && password.length < 8) {
      fail("password", "New password must be at least 8 characters.", newPasswordRef.current);
      return;
    }

    setSaving(true);
    try {
      const updated = await api.updateProfile(session!.accessToken, {
        fullName: trimmedName,
        ...(password ? { password, currentPassword } : {}),
      });
      if (password) {
        // Backend revokes refresh tokens on password change. Clear local
        // session immediately instead of allowing a stale token to linger.
        logout();
        navigate("/login", { replace: true });
        return;
      }
      updateSession({ fullName: updated.fullName, email: updated.email });
      setFullName(updated.fullName);
      setFeedback({ tone: "success", message: "Profile updated." });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (/current password/i.test(error.message)) {
          fail("password", "Current password is not valid.", newPasswordRef.current);
        } else {
          // A 401 from app.authenticate (expired/invalid access token) is a
          // dead session, not a wrong password — reporting it as the latter
          // would send the user re-trying a correct password. Sign out.
          logout();
          navigate("/login", { replace: true });
          return;
        }
      } else {
        setFeedback({
          tone: "error",
          message: error instanceof ApiError ? error.message : "Unable to update profile.",
        });
      }
    } finally {
      setSaving(false);
    }
  }

  // `navigate(-1)` exits the app entirely when the user deep-linked or
  // reloaded onto /profile — there is no in-app history entry to go back to.
  const cancel = () => {
    if (window.history.length > 1 && window.history.state?.idx > 0) {
      navigate(-1);
    } else {
      navigate("/", { replace: true });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        subtitle="Manage your name and sign-in password."
      />
      <Card className="max-w-2xl">
        <form onSubmit={submit} className="space-y-5" noValidate>
          {feedback && (
            <Alert tone={feedback.tone}>
              {/* The Alert is the single live announcement. When the failure
                  belongs to a field, its input also points here through
                  aria-describedby, so the message is reachable from the field
                  itself and not only as a form-level alert. */}
              <span id={feedbackId}>{feedback.message}</span>
            </Alert>
          )}
          <Field label="Full name" required>
            <Input
              ref={nameRef}
              id="profile-full-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              required
              disabled={saving}
              aria-invalid={errorField === "fullName" || undefined}
              aria-describedby={errorField === "fullName" ? feedbackId : undefined}
            />
          </Field>
          <Field
            label="Email"
            hint="Email can only be changed by an administrator."
          >
            <Input value={session?.email ?? ""} readOnly aria-readonly="true" />
          </Field>
          <div className="border-t border-slate-200 pt-5">
            <h2 className="text-sm font-semibold text-slate-800">Change password</h2>
            <p className="mt-1 text-sm text-slate-500">
              Leave both password fields empty to keep your current password.
            </p>
            <div className="mt-4 space-y-4">
              <Field label="Current password" hint="Required when setting a new password.">
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={saving}
                />
              </Field>
              <Field label="New password" hint="At least 8 characters.">
                <Input
                  ref={newPasswordRef}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  disabled={saving}
                  aria-invalid={errorField === "password" || undefined}
                  aria-describedby={errorField === "password" ? feedbackId : undefined}
                />
              </Field>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Enabled while an existing name is blank: a disabled button
                gives no reason, and this form also carries a password-only
                change. Submitting instead announces what is missing and
                moves focus to that field (see fail()). */}
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button type="button" variant="secondary" onClick={cancel} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
