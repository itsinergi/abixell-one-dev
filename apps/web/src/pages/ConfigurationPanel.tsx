import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../lib/api";
import { OverlayDialog } from "../shell/components/OverlayDialog";
import { Alert, Button, Card, DataTable, Field, Input, Select, type Column } from "../shell/components/ui";
import { useAdminResource } from "./admin/console/useAdminResource";
import { AdminSectionState } from "./admin/console/AdminSection";

type OrgUnitOption = { id: string; name: string };
type ModuleRow = Awaited<ReturnType<typeof api.configModules>>[number];
type FlagRow = Awaited<ReturnType<typeof api.configFeatureFlags>>[number];
type TermRow = Awaited<ReturnType<typeof api.configTerminology>>[number];
type RefItemRow = Awaited<ReturnType<typeof api.configReferenceDataItems>>[number];
type Dialog =
  | { kind: "module"; row: ModuleRow; next: boolean }
  | { kind: "flag"; row: FlagRow; scopeId: string | null; scopeName: string; next: boolean }
  | { kind: "terminology"; row: TermRow }
  | { kind: "reference"; typeCode: string; typeName: string }
  | { kind: "number" };
const numberingCode = "demo_ticket";

function Panel({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return <Card className="w-full"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="text-base font-semibold text-slate-900">{title}{count !== undefined && <span className="ml-2 text-sm font-normal text-slate-500">({count})</span>}</h3>{action}</div>{children}</Card>;
}

export function ConfigurationPanel({ token, orgUnits, canManage, onMessage }: {
  token: string;
  orgUnits: OrgUnitOption[];
  canManage: boolean;
  onMessage: (m: { type: "error" | "success"; text: string }) => void;
}) {
  const modules = useAdminResource(api.configModules, "Failed to load modules.");
  const flags = useAdminResource(api.configFeatureFlags, "Failed to load feature flags.");
  const terms = useAdminResource(api.configTerminology, "Failed to load terminology.");
  const types = useAdminResource(api.configReferenceDataTypes, "Failed to load reference types.");
  const numbering = useAdminResource((accessToken) => api.configNumberingSequence(accessToken, numberingCode), "Failed to load numbering.");
  const [scopeId, setScopeId] = useState("");
  const [typeCode, setTypeCode] = useState("");
  const selectedScope = orgUnits.find((unit) => unit.id === scopeId) ?? orgUnits[0];
  const selectedType = types.data?.find((type) => type.code === typeCode) ?? types.data?.[0];
  const effectiveScopeId = selectedScope?.id ?? "";
  const effectiveTypeCode = selectedType?.code ?? "";

  // Keyed loaders invalidate results when the selected scope/type changes.
  const effectiveLoader = useCallback(() => effectiveScopeId ? api.configEffectiveFeatureFlags(token, effectiveScopeId) : Promise.resolve([]), [token, effectiveScopeId]);
  const referenceLoader = useCallback(() => effectiveTypeCode ? api.configReferenceDataItems(token, effectiveTypeCode) : Promise.resolve([]), [token, effectiveTypeCode]);
  const effective = useScopedResource(effectiveLoader);
  const items = useScopedResource(referenceLoader);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [lastNumber, setLastNumber] = useState<string | null>(null);
  const busy = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const lifetime = useRef(0);
  useEffect(() => { lifetime.current += 1; return () => { lifetime.current += 1; }; }, [token]);

  function open(next: Dialog, trigger: HTMLButtonElement) {
    if (busy.current) return;
    triggerRef.current = trigger;
    setDialogError(null);
    setDialog(next);
  }
  function close() {
    if (busy.current) return;
    setDialog(null);
    setDialogError(null);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || !canManage || busy.current) return;
    const data = new FormData(event.currentTarget);
    const target = dialog;
    const generation = lifetime.current;
    busy.current = true;
    setPending(true);
    setDialogError(null);
    try {
      switch (target.kind) {
        case "module":
          await api.setConfigModuleActivation(token, target.row.moduleCode, target.next);
          break;
        case "flag":
          await api.setConfigFeatureFlag(token, target.row.code, { isEnabled: target.next, scopeType: target.scopeId ? "organization_unit" : "tenant", ...(target.scopeId ? { scopeOrganizationUnitId: target.scopeId } : {}) });
          break;
        case "terminology":
          await api.setConfigTerminology(token, target.row.code, String(data.get("value")));
          break;
        case "reference":
          await api.createConfigReferenceDataItem(token, target.typeCode, { code: String(data.get("code")), label: String(data.get("label")), sortOrder: data.get("sortOrder") ? Number(data.get("sortOrder")) : undefined });
          break;
        case "number": {
          const result = await api.generateConfigNumber(token, numberingCode);
          if (generation === lifetime.current) setLastNumber(result.number);
          break;
        }
      }
    } catch (error) {
      if (generation === lifetime.current) setDialogError(error instanceof ApiError ? error.message : "The change could not be saved.");
      return;
    } finally {
      busy.current = false;
      if (generation === lifetime.current) setPending(false);
    }
    if (generation !== lifetime.current) return;
    setDialog(null);
    onMessage({ type: "success", text: target.kind === "number" ? "Number generated." : "Configuration saved." });
    // Each reload reports its own failure, independently of the successful write.
    if (target.kind === "module") void modules.reload();
    if (target.kind === "flag") { void flags.reload(); effective.reload(); }
    if (target.kind === "terminology") void terms.reload();
    if (target.kind === "reference") items.reload();
    if (target.kind === "number") void numbering.reload();
  }

  const moduleColumns: Column<ModuleRow>[] = [
    { header: "Module", mobileRole: "title", cell: (row) => row.moduleName },
    { header: "Code", cell: (row) => row.moduleCode },
    { header: "Status", mobileRole: "status", cell: (row) => row.isActive ? "Active" : "Inactive" },
    { header: "Action", cell: (row) => canManage && <Button variant="ghost" onClick={(event) => open({ kind: "module", row, next: !row.isActive }, event.currentTarget)}>{row.isActive ? "Deactivate" : "Activate"}</Button> },
  ];
  const flagColumns: Column<FlagRow>[] = [
    { header: "Feature", mobileRole: "title", cell: (row) => row.name },
    { header: "Tenant value", cell: (row) => row.isEnabled ? "Enabled" : "Disabled" },
    { header: "Effective at unit", cell: (row) => { const value = effective.data?.find((flag) => flag.code === row.code); return effective.loading ? "Loading…" : value ? `${value.isEnabled ? "Enabled" : "Disabled"} (${value.source})` : "Unavailable"; } },
    { header: "Actions", cell: (row) => {
      const value = effective.data?.find((flag) => flag.code === row.code);
      return canManage && <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={(event) => open({ kind: "flag", row, scopeId: null, scopeName: "Entire tenant", next: !row.isEnabled }, event.currentTarget)}>{row.isEnabled ? "Disable" : "Enable"} tenant-wide</Button><Button variant="secondary" disabled={!selectedScope || !value || effective.loading || !!effective.error} onClick={(event) => { if (selectedScope && value) open({ kind: "flag", row, scopeId: selectedScope.id, scopeName: selectedScope.name, next: !value.isEnabled }, event.currentTarget); }}>Override at unit</Button></div>;
    } },
  ];
  const termColumns: Column<TermRow>[] = [
    { header: "Key", mobileRole: "title", cell: (row) => row.code },
    { header: "Label", cell: (row) => row.value },
    { header: "Source", cell: (row) => row.isOverridden ? "Tenant override" : "Default" },
    { header: "Action", cell: (row) => canManage && <Button variant="ghost" onClick={(event) => open({ kind: "terminology", row }, event.currentTarget)}>Edit label</Button> },
  ];
  const itemColumns: Column<RefItemRow>[] = [
    { header: "Label", mobileRole: "title", cell: (row) => row.label },
    { header: "Code", cell: (row) => row.code },
    { header: "Sort order", cell: (row) => row.sortOrder },
    { header: "Status", mobileRole: "status", cell: (row) => row.isActive ? "Active" : "Inactive" },
  ];
  const title = dialog?.kind === "module" ? `${dialog.next ? "Activate" : "Deactivate"} module` : dialog?.kind === "flag" ? "Override feature flag" : dialog?.kind === "terminology" ? "Edit terminology" : dialog?.kind === "reference" ? "Create reference item" : "Generate next number";

  return <section className="space-y-6" aria-label="Configuration and Metadata">
    <h2 className="text-lg font-semibold text-slate-900">Configuration &amp; Metadata</h2>
    <Panel title="Modules" count={modules.data?.length}><AdminSectionState {...modules} onRetry={modules.reload}><DataTable columns={moduleColumns} rows={modules.data ?? []} keyOf={(row) => row.moduleId} /></AdminSectionState></Panel>
    <Panel title="Feature Flags" count={flags.data?.length}>
      <Field label="Organization unit scope" hint="Unit overrides take precedence over tenant values."><Select value={effectiveScopeId} onChange={(event) => setScopeId(event.target.value)} disabled={!orgUnits.length}><option value="">Select a unit</option>{orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</Select></Field>
      {effective.error && <Alert tone="error">{effective.error}</Alert>}
      <AdminSectionState {...flags} onRetry={flags.reload}><DataTable columns={flagColumns} rows={flags.data ?? []} keyOf={(row) => row.code} /></AdminSectionState>
    </Panel>
    <Panel title="Terminology" count={terms.data?.length}><AdminSectionState {...terms} onRetry={terms.reload}><DataTable columns={termColumns} rows={terms.data ?? []} keyOf={(row) => row.code} /></AdminSectionState></Panel>
    <Panel title="Reference Data" count={items.data?.length} action={canManage && selectedType && types.status === "ready" && <Button onClick={(event) => open({ kind: "reference", typeCode: selectedType.code, typeName: selectedType.name }, event.currentTarget)}>Create Item</Button>}>
      <AdminSectionState {...types} onRetry={types.reload}><Field label="Reference type"><Select value={effectiveTypeCode} onChange={(event) => setTypeCode(event.target.value)} disabled={!types.data?.length}><option value="">Select a type</option>{types.data?.map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}</Select></Field></AdminSectionState>
      <AdminSectionState {...items} onRetry={items.reload}><DataTable columns={itemColumns} rows={items.data ?? []} keyOf={(row) => row.id} /></AdminSectionState>
      <p className="mt-3 text-xs text-slate-500">This general panel supports reading and creating items. Item lifecycle changes are not available here.</p>
    </Panel>
    <Panel title="Numbering" action={canManage && <Button onClick={(event) => open({ kind: "number" }, event.currentTarget)}>Generate next number</Button>}>
      <AdminSectionState {...numbering} onRetry={numbering.reload}>{numbering.data && <dl className="space-y-2 wrap-break-word text-sm"><dt>Sequence</dt><dd>{numberingCode}</dd><dt>Pattern</dt><dd>{numbering.data.pattern}</dd><dt>Current sequence</dt><dd>{numbering.data.currentSequence}</dd></dl>}</AdminSectionState>
      {lastNumber && <p className="mt-3 text-sm">Last generated: {lastNumber}</p>}
      <p className="mt-3 text-xs text-slate-500">Generate advances the stored sequence; it is not a preview. Sequence editing is not available.</p>
    </Panel>
    <OverlayDialog open={!!dialog} title={title} pending={pending} onClose={close} restoreFocusRef={triggerRef} footer={<><Button variant="secondary" disabled={pending} onClick={close}>Cancel</Button><Button type="submit" form="configuration-change" disabled={pending || !canManage}>{pending ? "Saving…" : dialog?.kind === "reference" ? "Create" : dialog?.kind === "number" ? "Generate" : "Confirm"}</Button></>}>
      {dialogError && <Alert tone="error">{dialogError}</Alert>}
      <form id="configuration-change" onSubmit={submit} className="space-y-4">
        <fieldset disabled={pending} className="space-y-4">
          {dialog?.kind === "module" && <p>{dialog.next ? "Activate" : "Deactivate"} {dialog.row.moduleName} for this tenant?</p>}
          {dialog?.kind === "flag" && <><p>Set <strong>{dialog.row.name}</strong> to <strong>{dialog.next ? "Enabled" : "Disabled"}</strong>?</p><p>Scope: {dialog.scopeName}</p><p className="text-sm text-slate-500">Existing unit overrides take precedence over tenant values.</p></>}
          {dialog?.kind === "terminology" && <><p className="wrap-break-word text-sm">Key: {dialog.row.code}</p><Field label="Label" required><Input name="value" required defaultValue={dialog.row.value} /></Field></>}
          {dialog?.kind === "reference" && <><p>Type: {dialog.typeName}</p><Field label="Code" required><Input name="code" required /></Field><Field label="Label" required><Input name="label" required /></Field><Field label="Sort order"><Input name="sortOrder" type="number" step="1" /></Field></>}
          {dialog?.kind === "number" && <p>Generate a number for {numberingCode}? This advances the stored sequence and cannot be undone here.</p>}
        </fieldset>
      </form>
    </OverlayDialog>
  </section>;
}

function useScopedResource<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null; denied: boolean; sessionExpired: boolean }>({ data: null, loading: true, error: null, denied: false, sessionExpired: false });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setState({ data: null, loading: true, error: null, denied: false, sessionExpired: false });
    load().then((data) => { if (current) setState({ data, loading: false, error: null, denied: false, sessionExpired: false }); }).catch((error: unknown) => {
      if (!current) return;
      const denied = error instanceof ApiError && error.status === 403;
      const sessionExpired = error instanceof ApiError && error.status === 401;
      setState({ data: null, loading: false, denied, sessionExpired, error: sessionExpired ? "Your session has expired. Sign in again." : denied ? "You do not have permission to read this resource." : error instanceof ApiError ? error.message : "Failed to load configuration." });
    });
    return () => { current = false; };
  }, [load, revision]);
  return { ...state, reload: () => setRevision((value) => value + 1) };
}
