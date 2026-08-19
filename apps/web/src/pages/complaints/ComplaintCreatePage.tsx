/**
 * Checkpoint 1C.2 — Create complaint. Uses only the existing Complaint
 * model fields; category / severity / priority options come from Tenant
 * Configuration reference data (never hardcoded). Submits to the real API
 * and surfaces backend validation/authorization errors safely.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type ComplaintCreateOptions } from "../../lib/api";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "../../shell/components/ui";
import { useCustomerScope } from "./useCustomerScope";

export function ComplaintCreatePage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetCustomerId = searchParams.get("customerId") ?? "";

  const { customers, selectedId, setSelectedId, loading: customersLoading } = useCustomerScope();
  const [options, setOptions] = useState<ComplaintCreateOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Honour a customerId passed from the list page.
  useEffect(() => {
    if (presetCustomerId) setSelectedId(presetCustomerId);
  }, [presetCustomerId, setSelectedId]);

  const loadOptions = useCallback(async () => {
    setOptionsError(null);
    try {
      setOptions(await api.complaintReferenceData(token));
    } catch (err) {
      setOptionsError(err instanceof ApiError ? err.message : "Failed to load form options");
    }
  }, [token]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedId) {
      setError("Please select a customer first.");
      return;
    }
    const form = new FormData(e.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createComplaint(token, {
        customerId: selectedId,
        category: String(form.get("category")),
        subcategory: form.get("subcategory") ? String(form.get("subcategory")) : null,
        severity: String(form.get("severity")),
        priority: String(form.get("priority")),
        description: String(form.get("description")),
      });
      navigate(`/complaints/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create the complaint");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="New complaint"
        subtitle="Tell us what happened. Your complaint will be routed and tracked automatically."
        actions={
          <Button variant="secondary" onClick={() => navigate("/complaints")}>
            Back to list
          </Button>
        }
      />

      {optionsError && <Alert tone="error">{optionsError}</Alert>}

      {customersLoading || !options ? (
        <Spinner label="Preparing the form…" />
      ) : (
        <Card className="max-w-xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            {customers.length > 1 && (
              <Field label="Customer" required>
                <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} required>
                  <option value="">Select a customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field label="Category" required>
              <Select name="category" required defaultValue="">
                <option value="" disabled>
                  Select a category…
                </option>
                {options.categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Subcategory" hint="Optional">
              <Input name="subcategory" placeholder="e.g. cleaning schedule" />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Severity" required>
                <Select name="severity" required defaultValue="">
                  <option value="" disabled>
                    Select…
                  </option>
                  {options.severities.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Priority" required>
                <Select name="priority" required defaultValue="">
                  <option value="" disabled>
                    Select…
                  </option>
                  {options.priorities.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Description" required>
              <Textarea name="description" required rows={5} placeholder="Describe the issue in detail" />
            </Field>

            {error && <Alert tone="error">{error}</Alert>}

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Create complaint"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate("/complaints")}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
