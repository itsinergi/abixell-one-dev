/**
 * Phase 4 — Supplier master (SCM-CORE-002 / SCM-CORE-013).
 *
 * Deliberately plain: no scorecard, rating, qualification, or tender
 * analytics — those are Advanced supplier-performance capabilities.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type SupplierRecord } from "../../lib/api";
import {
  Alert,
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

export function SuppliersPage() {
  const { session } = useAuth();
  const token = session!.accessToken;

  const [rows, setRows] = useState<SupplierRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.suppliers(token, { search: search || undefined }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load suppliers.");
    } finally {
      setLoading(false);
    }
  }, [token, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<SupplierRecord>[] = [
    { header: "Code", cell: (row) => <span className="font-medium">{row.code}</span> },
    { header: "Name", cell: (row) => row.name },
    { header: "Contact", cell: (row) => row.contactName ?? "—" },
    { header: "Email", cell: (row) => row.email ?? "—" },
    {
      header: "State",
      cell: (row) => (
        <StatusPill tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Suppliers" subtitle="Who you buy from." />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Add a supplier</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Code" required>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. acme" />
          </Field>
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Contact">
            <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button
              disabled={busy || !code || !name}
              onClick={async () => {
                setBusy(true);
                setError(null);
                setNotice(null);
                try {
                  await api.createSupplier(token, {
                    code,
                    name,
                    contactName: contactName || null,
                    email: email || null,
                  });
                  setNotice("Supplier created.");
                  setCode("");
                  setName("");
                  setContactName("");
                  setEmail("");
                  await load();
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : "Could not create the supplier.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Create
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <Field label="Search">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or code" />
        </Field>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(row) => row.id}
          empty={<EmptyState title="No suppliers yet" description="Add one above before raising purchase orders." />}
        />
      )}
    </div>
  );
}
