/**
 * Checkpoint 1D.2 — Survey admin: definition list + create (survey.manage).
 * Real data from the 1D.1 API; backend authorizes.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type SurveyDefinition } from "../../lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Spinner,
  Textarea,
  type Column,
} from "../../shell/components/ui";
import { formatDateShort } from "../complaints/format";

export function SurveyListPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();

  const [rows, setRows] = useState<SurveyDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.surveys(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load surveys");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.createSurvey(token, {
        code: String(form.get("code")).trim(),
        name: String(form.get("name")).trim(),
        description: form.get("description") ? String(form.get("description")) : null,
      });
      navigate(`/surveys/${created.definition.code}`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Failed to create survey");
    } finally {
      setCreating(false);
    }
  }

  const columns: Column<SurveyDefinition>[] = [
    { header: "Code", cell: (d) => <span className="font-mono text-slate-800">{d.code}</span> },
    { header: "Name", cell: (d) => d.name },
    {
      header: "Status",
      cell: (d) => <Badge>{d.isActive ? "Active" : "Inactive"}</Badge>,
    },
    { header: "Created", cell: (d) => formatDateShort(d.createdAt) },
  ];

  return (
    <div>
      <PageHeader
        title="Surveys"
        subtitle="Author survey definitions, publish versions, and assign them."
        actions={<Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Close" : "New survey"}</Button>}
      />

      {showCreate && (
        <Card className="mb-4 max-w-xl">
          <form onSubmit={handleCreate} className="space-y-3">
            <Field label="Code" required hint="Unique per tenant, e.g. csat">
              <Input name="code" required placeholder="csat" />
            </Field>
            <Field label="Name" required>
              <Input name="name" required placeholder="Customer Satisfaction" />
            </Field>
            <Field label="Description" hint="Optional">
              <Textarea name="description" rows={2} />
            </Field>
            {createError && <Alert tone="error">{createError}</Alert>}
            <Button type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create survey"}
            </Button>
          </form>
        </Card>
      )}

      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : loading ? (
        <Spinner label="Loading surveys…" />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(d) => d.id}
          onRowClick={(d) => navigate(`/surveys/${d.code}`)}
          empty={
            <EmptyState
              title="No surveys yet"
              description="Create your first survey definition to get started."
              action={<Button onClick={() => setShowCreate(true)}>New survey</Button>}
            />
          }
        />
      )}
    </div>
  );
}
