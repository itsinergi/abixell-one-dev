/**
 * Phase 7 — Health, Safety & Environment (HSE-CORE-001/002/009/010).
 *
 * Register view with filtering for incidents and observations.
 * Shows record type, category, severity, location, responsible party,
 * lifecycle status, and allows navigation to detail view.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type HseRecord,
} from "../../lib/api";
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
  Select,
  Spinner,
  StatusPill,
  type Column,
} from "../../shell/components/ui";
import { formatDateShort } from "../../shared/format";

export function HseRegisterPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();

  const [records, setRecords] = useState<HseRecord[]>([]);
  const [categories, setCategories] = useState<{ code: string; label: string }[]>([]);
  const [severities, setSeverities] = useState<{ code: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterType, setFilterType] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(
        await api.hseRecords(token, {
          recordType: filterType || undefined,
          categoryCode: filterCategory || undefined,
          severityCode: filterSeverity || undefined,
          occurredFrom: filterFrom || undefined,
          occurredTo: filterTo || undefined,
          search: search || undefined,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load HSE records.");
    } finally {
      setLoading(false);
    }
  }, [token, filterType, filterCategory, filterSeverity, filterFrom, filterTo, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const [categoryList, severityList] = await Promise.all([
        api.configReferenceDataItems(token, "hse_category").catch(() => [] as { code: string; label: string }[]),
        api.configReferenceDataItems(token, "hse_severity").catch(() => [] as { code: string; label: string }[]),
      ]);
      setCategories(categoryList);
      setSeverities(severityList);
    })();
  }, [token]);

  const categoryLabel = (code: string | null) => {
    if (!code) return "—";
    return categories.find((c) => c.code === code)?.label ?? code;
  };

  const severityLabel = (code: string | null) => {
    if (!code) return "—";
    return severities.find((s) => s.code === code)?.label ?? code;
  };

  const columns: Column<HseRecord>[] = [
    { header: "Number", cell: (row) => <span className="font-medium">{row.recordNumber}</span> },
    { header: "Type", cell: (row) => <Badge>{row.recordType === "incident" ? "Incident" : "Observation"}</Badge> },
    { header: "Date", cell: (row) => formatDateShort(row.occurredAt) },
    { header: "Title", cell: (row) => row.title },
    { header: "Category", cell: (row) => categoryLabel(row.categoryCode) },
    { header: "Severity", cell: (row) => severityLabel(row.severityCode) },
    {
      header: "Status",
      cell: (row) =>
        row.workflowInstanceId ? (
          <StatusPill tone="info">In Progress</StatusPill>
        ) : (
          <StatusPill tone="warning">Not Started</StatusPill>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="HSE Register" subtitle="Health, safety, and environment incidents and observations." />

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex gap-2">
        <Button onClick={() => navigate("/hse/report")} variant="primary">
          Report New
        </Button>
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Number, title, description" />
          </Field>
          <Field label="Type">
            <Select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="">Any</option>
              <option value="incident">Incident</option>
              <option value="observation">Observation</option>
            </Select>
          </Field>
          <Field label="Category">
            <Select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Severity">
            <Select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)}>
              <option value="">All severities</option>
              {severities.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
          </Field>
        </div>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <DataTable
          columns={columns}
          rows={records}
          keyOf={(row) => row.id}
          onRowClick={(row) => navigate(`/hse/records/${row.id}`)}
          empty={
            <EmptyState
              title="No HSE records yet"
              description="Report the first incident or observation to get started."
            />
          }
        />
      )}
    </div>
  );
}
