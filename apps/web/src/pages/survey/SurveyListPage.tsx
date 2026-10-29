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
import { useT } from "../../i18n/LocaleProvider";

export function SurveyListPage() {
  const t = useT();
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
      setError(err instanceof ApiError ? err.message : t("surveyList.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

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
      setCreateError(err instanceof ApiError ? err.message : t("surveyList.createFailed"));
    } finally {
      setCreating(false);
    }
  }

  const columns: Column<SurveyDefinition>[] = [
    { header: t("surveyList.colCode"), cell: (d) => <span className="font-mono text-ink">{d.code}</span> },
    { header: t("surveyList.colName"), cell: (d) => d.name },
    {
      header: t("surveyList.colStatus"),
      cell: (d) => <Badge>{d.isActive ? t("surveyList.active") : t("surveyList.inactive")}</Badge>,
    },
    { header: t("surveyList.colCreated"), cell: (d) => formatDateShort(d.createdAt) },
  ];

  return (
    <div>
      <PageHeader
        title={t("surveyList.title")}
        subtitle={t("surveyList.subtitle")}
        actions={<Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? t("surveyList.close") : t("surveyList.newSurvey")}</Button>}
      />

      {showCreate && (
        <Card className="mb-4 max-w-xl">
          <form onSubmit={handleCreate} className="space-y-3">
            <Field label={t("surveyList.colCode")} required hint={t("surveyList.codeHint")}>
              <Input name="code" required placeholder="csat" />
            </Field>
            <Field label={t("surveyList.colName")} required>
              <Input name="name" required placeholder={t("surveyList.namePlaceholder")} />
            </Field>
            <Field label={t("surveyList.fieldDescription")} hint={t("surveyList.optional")}>
              <Textarea name="description" rows={2} />
            </Field>
            {createError && <Alert tone="error">{createError}</Alert>}
            <Button type="submit" disabled={creating}>
              {creating ? t("surveyList.creating") : t("surveyList.create")}
            </Button>
          </form>
        </Card>
      )}

      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : loading ? (
        <Spinner label={t("surveyList.loading")} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(d) => d.id}
          onRowClick={(d) => navigate(`/surveys/${d.code}`)}
          empty={
            <EmptyState
              title={t("surveyList.emptyTitle")}
              description={t("surveyList.emptyDesc")}
              action={<Button onClick={() => setShowCreate(true)}>{t("surveyList.newSurvey")}</Button>}
            />
          }
        />
      )}
    </div>
  );
}
