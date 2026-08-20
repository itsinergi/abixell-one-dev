/**
 * Phase 2 — minimum Service Definition administration (SO-CORE-001 /
 * SO-CORE-007), so the module's Core is genuinely usable without database
 * seeding. Deliberately NOT a low-code service designer: it maintains
 * finite, structured Client Configuration only.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type ServiceChecklistTemplateItem, type ServiceDefinition } from "../../lib/api";
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
  StatusPill,
  type Column,
} from "../../shell/components/ui";

export function ServiceDefinitionsPage() {
  const { session } = useAuth();
  const token = session!.accessToken;

  const [definitions, setDefinitions] = useState<ServiceDefinition[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<ServiceChecklistTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [itemLabel, setItemLabel] = useState("");
  const [itemRequired, setItemRequired] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDefinitions(await api.serviceDefinitions(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load service types.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDefinition = useCallback(
    async (definitionCode: string) => {
      setSelected(definitionCode);
      setError(null);
      try {
        const detail = await api.serviceDefinition(token, definitionCode);
        setChecklist(detail.checklist);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load the checklist.");
      }
    },
    [token],
  );

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<ServiceDefinition>[] = [
    { header: "Code", cell: (row) => <span className="font-medium">{row.code}</span> },
    { header: "Name", cell: (row) => row.name },
    { header: "Category", cell: (row) => row.category ?? "—" },
    {
      header: "State",
      cell: (row) => (
        <StatusPill tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Service Types" subtitle="Define the reusable services your teams deliver." />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Add a service type</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Code" required>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. site_cleaning" />
          </Field>
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
          </Field>
          <div className="flex items-end">
            <Button
              disabled={busy || !code || !name}
              onClick={async () => {
                await run(() => api.createServiceDefinition(token, { code, name }), "Service type created.");
                setCode("");
                setName("");
                await load();
              }}
            >
              Create
            </Button>
          </div>
        </div>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <DataTable
          columns={columns}
          rows={definitions}
          keyOf={(row) => row.id}
          onRowClick={(row) => void openDefinition(row.code)}
          empty={<EmptyState title="No service types yet" description="Create one above to start planning work." />}
        />
      )}

      {selected ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">
            Checklist for <Badge>{selected}</Badge>
          </h2>
          {checklist.length === 0 ? (
            <p className="text-sm text-slate-500">No checklist items yet.</p>
          ) : (
            <ul className="mb-4 space-y-1 text-sm text-slate-800">
              {checklist.map((item) => (
                <li key={item.id}>
                  {item.label} {item.isRequired ? <Badge>Required</Badge> : null}
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Item code" required>
              <Input value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
            </Field>
            <Field label="Label" required>
              <Input value={itemLabel} onChange={(e) => setItemLabel(e.target.value)} />
            </Field>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={itemRequired}
                  onChange={(e) => setItemRequired(e.target.checked)}
                />
                Required
              </label>
              <Button
                variant="secondary"
                disabled={busy || !itemCode || !itemLabel}
                onClick={async () => {
                  await run(
                    () =>
                      api.addServiceChecklistItem(token, selected, {
                        code: itemCode,
                        label: itemLabel,
                        isRequired: itemRequired,
                        sortOrder: checklist.length + 1,
                      }),
                    "Checklist item added.",
                  );
                  setItemCode("");
                  setItemLabel("");
                  await openDefinition(selected);
                }}
              >
                Add item
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
