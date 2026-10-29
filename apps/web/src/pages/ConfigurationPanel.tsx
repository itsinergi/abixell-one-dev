import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type AppParameter, type EffectiveParameterValue } from "../lib/api";
import { OverlayDialog } from "../shell/components/OverlayDialog";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Field,
  Input,
  Select,
  StatusPill,
  Textarea,
  type Column,
} from "../shell/components/ui";
import { useAdminResource } from "./admin/console/useAdminResource";
import { AdminSectionState } from "./admin/console/AdminSection";

/**
 * Epic 15 Decision #2 splits configuration into three categories. They share
 * this component — and with it one dialog, one refresh lifecycle, and one set
 * of permission gates — but never render the same blocks:
 *
 *   module    module activation + feature flags
 *   platform  tenant profile defaults + terminology
 *   system    reference catalogue + numbering + layered parameters
 */
export type ConfigurationSection = "module" | "platform" | "system";

type OrgUnitOption = { id: string; name: string };
type ModuleRow = Awaited<ReturnType<typeof api.configModules>>[number];
type FlagRow = Awaited<ReturnType<typeof api.configFeatureFlags>>[number];
type TermRow = Awaited<ReturnType<typeof api.configTerminology>>[number];
type RefItemRow = Awaited<ReturnType<typeof api.configReferenceDataItems>>[number];
type SequenceInfo = Awaited<ReturnType<typeof api.configNumberingSequence>>;

type Dialog =
  | { kind: "module"; row: ModuleRow; next: boolean }
  | { kind: "flag"; row: FlagRow; scopeId: string | null; scopeName: string; next: boolean }
  | { kind: "terminology"; row: TermRow }
  | { kind: "reference"; typeCode: string; typeName: string }
  | { kind: "parameter"; row: AppParameter };

function Panel({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="w-full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-ink">
          {title}
          {count !== undefined && (
            <span className="ml-2 text-sm font-normal text-ink-dim">({count})</span>
          )}
        </h3>
        {action}
      </div>
      {children}
    </Card>
  );
}

const LEVEL_LABELS: Record<string, string> = {
  S: "System",
  C: "Client",
  O: "Organization",
  product_default: "Default produk",
};

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function ConfigurationPanel({
  section,
  token,
  orgUnits,
  canManage,
  onMessage,
}: {
  section: ConfigurationSection;
  token: string;
  orgUnits: OrgUnitOption[];
  canManage: boolean;
  onMessage: (m: { type: "error" | "success"; text: string }) => void;
}) {
  const modules = useAdminResource(api.configModules, "Gagal memuat daftar module.");
  const flags = useAdminResource(api.configFeatureFlags, "Gagal memuat feature flag.");
  const terms = useAdminResource(api.configTerminology, "Gagal memuat terminology.");
  const types = useAdminResource(api.configReferenceDataTypes, "Gagal memuat tipe referensi.");
  const profile = useAdminResource(api.tenant, "Gagal memuat profil tenant.");
  const parameters = useAdminResource(api.configParameters, "Gagal memuat parameter.");

  const [scopeId, setScopeId] = useState("");
  const [typeCode, setTypeCode] = useState("");
  // Epic 15 Decision #12: one list of modules, click for that module's detail.
  const [detailModuleCode, setDetailModuleCode] = useState<string | null>(null);
  const detailModule = modules.data?.find((row) => row.moduleCode === detailModuleCode);
  const detailParameters = (parameters.data ?? []).filter(
    (row) => row.moduleCode === detailModuleCode,
  );
  const selectedScope = orgUnits.find((unit) => unit.id === scopeId);
  const selectedType = types.data?.find((type) => type.code === typeCode) ?? types.data?.[0];
  const effectiveScopeId = selectedScope?.id ?? "";
  const effectiveTypeCode = selectedType?.code ?? "";

  // Numbering is per-code and has no catalogue endpoint, so the operator names
  // the sequence instead of the screen guessing one.
  const [sequenceCode, setSequenceCode] = useState("");
  const [loadedSequence, setLoadedSequence] = useState<{ code: string; info: SequenceInfo } | null>(null);
  const [sequenceBusy, setSequenceBusy] = useState(false);
  const [sequenceError, setSequenceError] = useState<string | null>(null);

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [lastNumber, setLastNumber] = useState<string | null>(null);
  const busy = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const lifetime = useRef(0);
  useEffect(() => {
    lifetime.current += 1;
    return () => {
      lifetime.current += 1;
    };
  }, [token]);

  // Scoped loads keyed on the selected scope, awaited inside the write path so
  // no stale unit result can be attributed to the wrong scope.
  const [effectiveFlags, setEffectiveFlags] = useState<{
    scopeId: string;
    list: Array<{ code: string; isEnabled: boolean; source: string }>;
  } | null>(null);
  const [effectiveFlagsError, setEffectiveFlagsError] = useState<string | null>(null);
  const [refItems, setRefItems] = useState<{ typeCode: string; list: RefItemRow[] } | null>(null);
  const [refItemsError, setRefItemsError] = useState<string | null>(null);

  useEffect(() => {
    if (section !== "module" || !effectiveScopeId) {
      setEffectiveFlags(null);
      setEffectiveFlagsError(null);
      return;
    }
    let current = true;
    api
      .configEffectiveFeatureFlags(token, effectiveScopeId)
      .then((list) => {
        if (current) {
          setEffectiveFlags({ scopeId: effectiveScopeId, list });
          setEffectiveFlagsError(null);
        }
      })
      .catch((error: unknown) => {
        if (current)
          setEffectiveFlagsError(
            error instanceof ApiError ? error.message : "Gagal memuat nilai efektif per unit.",
          );
      });
    return () => {
      current = false;
    };
  }, [section, token, effectiveScopeId]);

  useEffect(() => {
    if (section !== "system" || !effectiveTypeCode) {
      setRefItems(null);
      setRefItemsError(null);
      return;
    }
    let current = true;
    api
      .configReferenceDataItems(token, effectiveTypeCode)
      .then((list) => {
        if (current) {
          setRefItems({ typeCode: effectiveTypeCode, list });
          setRefItemsError(null);
        }
      })
      .catch((error: unknown) => {
        if (current)
          setRefItemsError(
            error instanceof ApiError ? error.message : "Gagal memuat item referensi.",
          );
      });
    return () => {
      current = false;
    };
  }, [section, token, effectiveTypeCode]);

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

  async function loadSequence() {
    const code = sequenceCode.trim();
    if (!code) return;
    setSequenceBusy(true);
    setSequenceError(null);
    try {
      const info = await api.configNumberingSequence(token, code);
      setLoadedSequence({ code, info });
    } catch (error) {
      setLoadedSequence(null);
      setSequenceError(
        error instanceof ApiError && error.status === 404
          ? `Urutan '${code}' belum ada untuk tenant ini.`
          : error instanceof ApiError
            ? error.message
            : "Gagal memuat urutan.",
      );
    } finally {
      setSequenceBusy(false);
    }
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
          await api.setConfigFeatureFlag(token, target.row.code, {
            isEnabled: target.next,
            scopeType: target.scopeId ? "organization_unit" : "tenant",
            ...(target.scopeId ? { scopeOrganizationUnitId: target.scopeId } : {}),
          });
          break;
        case "terminology":
          await api.setConfigTerminology(token, target.row.code, String(data.get("value")));
          break;
        case "reference":
          await api.createConfigReferenceDataItem(token, target.typeCode, {
            code: String(data.get("code")),
            label: String(data.get("label")),
            sortOrder: data.get("sortOrder") ? Number(data.get("sortOrder")) : undefined,
          });
          break;
        case "parameter": {
          const level = String(data.get("level")) as "C" | "O";
          const raw = String(data.get("value") ?? "");
          await api.setConfigParameterValue(token, target.row.code, {
            level,
            value: parseParameterValue(target.row, raw),
            ...(level === "O" && effectiveScopeId ? { organizationUnitId: effectiveScopeId } : {}),
          });
          break;
        }
      }
    } catch (error) {
      if (generation === lifetime.current)
        setDialogError(
          error instanceof ApiError ? error.message : "Perubahan tidak dapat disimpan.",
        );
      return;
    } finally {
      busy.current = false;
      if (generation === lifetime.current) setPending(false);
    }
    if (generation !== lifetime.current) return;
    setDialog(null);
    onMessage({
      type: "success",
      text: target.kind === "parameter" ? "Nilai parameter disimpan." : "Konfigurasi disimpan.",
    });
    if (target.kind === "module") void modules.reload();
    if (target.kind === "flag") void flags.reload();
    if (target.kind === "terminology") void terms.reload();
    if (target.kind === "reference") {
      if (effectiveTypeCode)
        void api.configReferenceDataItems(token, effectiveTypeCode).then((list) =>
          setRefItems({ typeCode: effectiveTypeCode, list }),
        );
    }
    if (target.kind === "parameter") void parameters.reload();
  }

  async function generateNumber() {
    if (!loadedSequence || !canManage) return;
    setSequenceError(null);
    try {
      const result = await api.generateConfigNumber(token, loadedSequence.code);
      setLastNumber(result.number);
      const info = await api.configNumberingSequence(token, loadedSequence.code);
      setLoadedSequence({ code: loadedSequence.code, info });
    } catch (error) {
      setSequenceError(
        error instanceof ApiError ? error.message : "Gagal membuat nomor berikutnya.",
      );
    }
  }

  /* ------------------------------------------------------------- Columns */

  const moduleColumns: Column<ModuleRow>[] = [
    { header: "Module", mobileRole: "title", cell: (row) => row.moduleName },
    { header: "Kode", cell: (row) => <span className="font-mono text-xs">{row.moduleCode}</span> },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={row.isActive ? "success" : "neutral"}>
          {row.isActive ? "Aktif" : "Nonaktif"}
        </StatusPill>
      ),
    },
    {
      header: "Aksi",
      cell: (row) => (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            aria-pressed={detailModuleCode === row.moduleCode}
            onClick={() =>
              setDetailModuleCode(detailModuleCode === row.moduleCode ? null : row.moduleCode)
            }
          >
            {detailModuleCode === row.moduleCode ? "Tutup detail" : "Lihat konfigurasi"}
          </Button>
          {canManage && (
            <Button
              variant="ghost"
              onClick={(event) =>
                open({ kind: "module", row, next: !row.isActive }, event.currentTarget)
              }
            >
              {row.isActive ? "Nonaktifkan" : "Aktifkan"}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const flagColumns: Column<FlagRow>[] = [
    { header: "Feature", mobileRole: "title", cell: (row) => row.name },
    { header: "Nilai tenant", cell: (row) => (row.isEnabled ? "Aktif" : "Nonaktif") },
    {
      header: "Efektif di unit",
      cell: (row) => {
        if (!effectiveScopeId) return <span className="text-ink-faint">Pilih unit</span>;
        const value = effectiveFlags?.list.find((flag) => flag.code === row.code);
        return value ? `${value.isEnabled ? "Aktif" : "Nonaktif"} (${value.source})` : "—";
      },
    },
    {
      header: "Aksi",
      cell: (row) => {
        const value = effectiveFlags?.list.find((flag) => flag.code === row.code);
        return (
          canManage && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={(event) =>
                  open(
                    {
                      kind: "flag",
                      row,
                      scopeId: null,
                      scopeName: "Seluruh tenant",
                      next: !row.isEnabled,
                    },
                    event.currentTarget,
                  )
                }
              >
                {row.isEnabled ? "Nonaktifkan" : "Aktifkan"} tenant
              </Button>
              <Button
                variant="secondary"
                disabled={!selectedScope || !value}
                onClick={(event) => {
                  if (selectedScope && value)
                    open(
                      {
                        kind: "flag",
                        row,
                        scopeId: selectedScope.id,
                        scopeName: selectedScope.name,
                        next: !value.isEnabled,
                      },
                      event.currentTarget,
                    );
                }}
              >
                Override di unit
              </Button>
            </div>
          )
        );
      },
    },
  ];

  const termColumns: Column<TermRow>[] = [
    { header: "Kunci", mobileRole: "title", cell: (row) => <span className="font-mono text-xs">{row.code}</span> },
    { header: "Label", cell: (row) => row.value },
    { header: "Sumber", cell: (row) => (row.isOverridden ? "Override tenant" : "Default") },
    {
      header: "Aksi",
      cell: (row) =>
        canManage && (
          <Button variant="ghost" onClick={(event) => open({ kind: "terminology", row }, event.currentTarget)}>
            Ubah label
          </Button>
        ),
    },
  ];

  const itemColumns: Column<RefItemRow>[] = [
    { header: "Label", mobileRole: "title", cell: (row) => row.label },
    { header: "Kode", cell: (row) => <span className="font-mono text-xs">{row.code}</span> },
    { header: "Urutan", cell: (row) => row.sortOrder },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={row.isActive ? "success" : "neutral"}>
          {row.isActive ? "Aktif" : "Nonaktif"}
        </StatusPill>
      ),
    },
  ];

  const parameterColumns: Column<AppParameter>[] = [
    {
      header: "Parameter",
      mobileRole: "title",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span>{row.name}</span>
          {row.inUse === false && <StatusPill tone="neutral">Belum dipakai</StatusPill>}
        </div>
      ),
    },
    { header: "Kode", cell: (row) => <span className="font-mono text-xs">{row.code}</span> },
    { header: "Tipe", cell: (row) => row.parameterType },
    {
      header: "Level",
      cell: (row) => (
        <div className="flex gap-1">
          {row.allowedLevels.map((level) => (
            <Badge key={level}>{level}</Badge>
          ))}
          {row.isGuardrail && <StatusPill tone="warning">Guardrail</StatusPill>}
        </div>
      ),
    },
    { header: "Default", cell: (row) => <span className="font-mono text-xs">{describeValue(row.defaultValue)}</span> },
    {
      header: "Aksi",
      cell: (row) =>
        canManage &&
        row.inUse !== false && (
          <Button variant="ghost" onClick={(event) => open({ kind: "parameter", row }, event.currentTarget)}>
            Atur nilai
          </Button>
        ),
    },
  ];

  const title =
    dialog?.kind === "module"
      ? `${dialog.next ? "Aktifkan" : "Nonaktifkan"} module`
      : dialog?.kind === "flag"
        ? "Override feature flag"
        : dialog?.kind === "terminology"
          ? "Ubah terminology"
          : dialog?.kind === "reference"
            ? "Buat item referensi"
            : "Atur nilai parameter";

  const writeLevels = dialog?.kind === "parameter" ? dialog.row.allowedLevels.filter((l) => l !== "S") : [];

  return (
    <section className="space-y-4" aria-label="Konfigurasi dan metadata">
      {section === "module" && (
        <>
          <Panel title="Module" count={modules.data?.length}>
            <AdminSectionState {...modules} onRetry={modules.reload}>
              <DataTable columns={moduleColumns} rows={modules.data ?? []} keyOf={(row) => row.moduleId} />
            </AdminSectionState>
          </Panel>

          {detailModule && (
            <Panel
              title={`Konfigurasi ${detailModule.moduleName}`}
              count={detailParameters.length}
              action={
                <StatusPill tone={detailModule.isActive ? "success" : "neutral"}>
                  {detailModule.isActive ? "Aktif" : "Nonaktif"}
                </StatusPill>
              }
            >
              {!detailModule.isActive && (
                <Alert tone="warning">
                  Module ini nonaktif untuk tenant. Aktifkan lebih dulu agar pengaturannya berlaku.
                </Alert>
              )}
              {detailModule.moduleCode === "customer_complaint" && (
                <p className="mb-3 text-sm">
                  Kategori, SLA, dan eskalasi dikelola di{" "}
                  <Link className="underline" to="/administration/complaints">
                    Konfigurasi keluhan
                  </Link>
                  .
                </p>
              )}
              {detailParameters.length === 0 ? (
                <p className="text-sm text-ink-dim">
                  Module ini belum mendeklarasikan parameter. Pengaturannya muncul di sini setelah
                  module mendaftarkannya.
                </p>
              ) : (
                <DataTable
                  columns={parameterColumns}
                  rows={detailParameters}
                  keyOf={(row) => row.id}
                />
              )}
            </Panel>
          )}

          <Panel title="Feature flag" count={flags.data?.length}>
            <Field
              label="Scope organization unit"
              hint="Nilai di unit menimpa nilai tenant."
            >
              <Select value={effectiveScopeId} onChange={(event) => setScopeId(event.target.value)} disabled={!orgUnits.length}>
                <option value="">Pilih unit</option>
                {orgUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </Select>
            </Field>
            {effectiveFlagsError && <Alert tone="error">{effectiveFlagsError}</Alert>}
            <AdminSectionState {...flags} onRetry={flags.reload}>
              <DataTable columns={flagColumns} rows={flags.data ?? []} keyOf={(row) => row.code} />
            </AdminSectionState>
          </Panel>
        </>
      )}

      {section === "platform" && (
        <>
          <Panel title="Profil tenant">
            <AdminSectionState {...profile} onRetry={profile.reload}>
              {profile.data && (
                <TenantProfileForm
                  token={token}
                  profile={profile.data}
                  canManage={canManage}
                  onSaved={(next) => onMessage({ type: "success", text: next })}
                  onReload={() => void profile.reload()}
                />
              )}
            </AdminSectionState>
          </Panel>

          <Panel title="Terminology" count={terms.data?.length}>
            <AdminSectionState {...terms} onRetry={terms.reload}>
              <DataTable columns={termColumns} rows={terms.data ?? []} keyOf={(row) => row.code} />
            </AdminSectionState>
          </Panel>
        </>
      )}

      {section === "system" && (
        <>
          <Panel
            title="Data referensi"
            count={refItems?.list.length}
            action={
              canManage &&
              selectedType && (
                <Button
                  onClick={(event) =>
                    open({ kind: "reference", typeCode: selectedType.code, typeName: selectedType.name }, event.currentTarget)
                  }
                >
                  Buat item
                </Button>
              )
            }
          >
            <AdminSectionState {...types} onRetry={types.reload}>
              <Field label="Tipe referensi">
                <Select value={effectiveTypeCode} onChange={(event) => setTypeCode(event.target.value)} disabled={!types.data?.length}>
                  <option value="">Pilih tipe</option>
                  {types.data?.map((type) => (
                    <option key={type.code} value={type.code}>
                      {type.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </AdminSectionState>
            {refItemsError && <Alert tone="error">{refItemsError}</Alert>}
            <DataTable columns={itemColumns} rows={refItems?.list ?? []} keyOf={(row) => row.id} />
            <p className="mt-3 text-xs text-ink-faint">
              Panel ini membaca dan membuat item. Perubahan siklus hidup item belum tersedia di sini.
            </p>
          </Panel>

          <Panel title="Penomoran">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <Field label="Kode urutan" hint="Misalnya kode dokumen yang tenant ini pakai.">
                  <Input
                    value={sequenceCode}
                    onChange={(event) => setSequenceCode(event.target.value)}
                    placeholder="complaint_number"
                  />
                </Field>
              </div>
              <Button variant="secondary" onClick={() => void loadSequence()} disabled={!sequenceCode.trim() || sequenceBusy}>
                {sequenceBusy ? "Memuat…" : "Muat"}
              </Button>
            </div>
            {sequenceError && <Alert tone="error">{sequenceError}</Alert>}
            {loadedSequence && (
              <dl className="mt-4 space-y-1 text-sm">
                <dt className="text-ink-faint">Pola</dt>
                <dd className="font-mono text-xs">{loadedSequence.info.pattern}</dd>
                <dt className="text-ink-faint">Urutan saat ini</dt>
                <dd className="tabular-nums">{loadedSequence.info.currentSequence}</dd>
              </dl>
            )}
            {loadedSequence && canManage && (
              <Button className="mt-3" onClick={() => void generateNumber()}>
                Buat nomor berikutnya
              </Button>
            )}
            {lastNumber && <p className="mt-3 text-sm">Nomor terakhir: <span className="font-mono text-xs">{lastNumber}</span></p>}
            <p className="mt-3 text-xs text-ink-faint">
              Membuat nomor menaikkan urutan tersimpan dan tidak bisa dibatalkan di sini.
            </p>
          </Panel>

          <Panel title="Parameter" count={parameters.data?.length}>
            <AdminSectionState {...parameters} onRetry={parameters.reload}>
              <DataTable columns={parameterColumns} rows={parameters.data ?? []} keyOf={(row) => row.id} />
            </AdminSectionState>
            <p className="mt-3 text-xs text-ink-faint">
              Nilai System hanya dapat diubah pemegang otoritas platform, bukan dari layar ini.
            </p>
          </Panel>
        </>
      )}

      <OverlayDialog
        open={!!dialog}
        title={title}
        pending={pending}
        onClose={close}
        restoreFocusRef={triggerRef}
        footer={
          <>
            <Button variant="secondary" disabled={pending} onClick={close}>
              Batal
            </Button>
            <Button type="submit" form="configuration-change" disabled={pending || !canManage}>
              {pending ? "Menyimpan…" : dialog?.kind === "reference" ? "Buat" : "Simpan"}
            </Button>
          </>
        }
      >
        {dialogError && <Alert tone="error">{dialogError}</Alert>}
        <form id="configuration-change" onSubmit={submit} className="space-y-4">
          <fieldset disabled={pending} className="space-y-4">
            {dialog?.kind === "module" && (
              <p>
                {dialog.next ? "Aktifkan" : "Nonaktifkan"} {dialog.row.moduleName} untuk tenant ini?
              </p>
            )}
            {dialog?.kind === "flag" && (
              <>
                <p>
                  Set <strong>{dialog.row.name}</strong> menjadi{" "}
                  <strong>{dialog.next ? "Aktif" : "Nonaktif"}</strong>?
                </p>
                <p className="text-ink-dim">Scope: {dialog.scopeName}</p>
                <p className="text-xs text-ink-faint">
                  Override di unit tetap menimpa nilai tenant.
                </p>
              </>
            )}
            {dialog?.kind === "terminology" && (
              <>
                <p className="wrap-break-word font-mono text-xs text-ink-dim">Kunci: {dialog.row.code}</p>
                <Field label="Label" required>
                  <Input name="value" required defaultValue={dialog.row.value} />
                </Field>
              </>
            )}
            {dialog?.kind === "reference" && (
              <>
                <p className="text-ink-dim">Tipe: {dialog.typeName}</p>
                <Field label="Kode" required>
                  <Input name="code" required />
                </Field>
                <Field label="Label" required>
                  <Input name="label" required />
                </Field>
                <Field label="Urutan">
                  <Input name="sortOrder" type="number" step="1" />
                </Field>
              </>
            )}
            {dialog?.kind === "parameter" && (
              <>
                <p className="font-mono text-xs text-ink-dim">{dialog.row.code}</p>
                <p className="text-sm text-ink-dim">{dialog.row.description}</p>
                <EffectiveValue token={token} parameter={dialog.row} organizationUnitId={effectiveScopeId} />
                {writeLevels.length === 0 ? (
                  <Alert tone="warning">
                    Parameter ini hanya punya nilai System, yang memerlukan otoritas platform.
                  </Alert>
                ) : (
                  <>
                    <Field label="Level" required>
                      <Select name="level" defaultValue={writeLevels[0]}>
                        {writeLevels.map((level) => (
                          <option key={level} value={level}>
                            {LEVEL_LABELS[level]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {writeLevels.includes("O") && !effectiveScopeId && (
                      <Alert tone="warning">
                        Pilih organization unit di kategori Module untuk menulis nilai Organization.
                      </Alert>
                    )}
                    <ParameterValueField parameter={dialog.row} />
                  </>
                )}
              </>
            )}
          </fieldset>
        </form>
      </OverlayDialog>
    </section>
  );
}

/* --------------------------------------------------------- Sub-components */

/** The resolved value and the level it came from — the precedence badge that
 *  makes the S→C→O ladder legible instead of guessed (Decision #6). */
function EffectiveValue({
  token,
  parameter,
  organizationUnitId,
}: {
  token: string;
  parameter: AppParameter;
  organizationUnitId: string;
}) {
  const [state, setState] = useState<{
    value: unknown;
    sourceLevel: EffectiveParameterValue["sourceLevel"];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setState(null);
    setError(null);
    api
      .configParameterEffective(token, parameter.code, organizationUnitId || undefined)
      .then((result) => {
        if (current) setState({ value: result.value, sourceLevel: result.sourceLevel });
      })
      .catch((err: unknown) => {
        if (current)
          setError(err instanceof ApiError ? err.message : "Gagal membaca nilai efektif.");
      });
    return () => {
      current = false;
    };
  }, [token, parameter.code, organizationUnitId]);

  if (error) return <p className="text-xs text-status-danger">{error}</p>;
  if (!state) return <p className="text-xs text-ink-faint">Membaca nilai efektif…</p>;

  return (
    <div className="rounded border border-line bg-panel-2 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink-faint">Nilai efektif</span>
        <Badge>{LEVEL_LABELS[state.sourceLevel] ?? state.sourceLevel}</Badge>
      </div>
      <p className="mt-1 wrap-break-word font-mono text-xs text-ink">{describeValue(state.value)}</p>
    </div>
  );
}

function ParameterValueField({ parameter }: { parameter: AppParameter }) {
  const defaultValue = describeValue(parameter.defaultValue);
  if (parameter.parameterType === "boolean") {
    return (
      <Field label="Nilai" required>
        <Select name="value" defaultValue={defaultValue === "true" ? "true" : "false"}>
          <option value="true">true</option>
          <option value="false">false</option>
        </Select>
      </Field>
    );
  }
  if (parameter.parameterType === "json") {
    return (
      <Field label="Nilai (JSON)" required hint="Harus JSON yang valid.">
        <Textarea name="value" required defaultValue={defaultValue} rows={4} />
      </Field>
    );
  }
  const numeric = parameter.parameterType === "integer" || parameter.parameterType === "decimal";
  return (
    <Field label="Nilai" required>
      <Input
        name="value"
        required
        defaultValue={defaultValue === "—" ? "" : defaultValue}
        inputMode={numeric ? "decimal" : undefined}
        type={parameter.parameterType === "integer" ? "number" : undefined}
        step={parameter.parameterType === "integer" ? "1" : undefined}
      />
    </Field>
  );
}

/** Converts the form's text into the JSON shape the server validates against
 *  the parameter's schema — never a cast, since a wrong shape is a 400. */
function parseParameterValue(parameter: AppParameter, raw: string): unknown {
  switch (parameter.parameterType) {
    case "boolean":
      return raw === "true";
    case "integer":
      return Number.parseInt(raw, 10);
    case "decimal":
      return Number(raw);
    case "json":
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    default:
      return raw;
  }
}

/** Tenant-wide defaults (§4.5 Putaran 6). An empty field means "not
 *  configured" and clears the column; it never invents a value. */
function TenantProfileForm({
  token,
  profile,
  canManage,
  onSaved,
  onReload,
}: {
  token: string;
  profile: Awaited<ReturnType<typeof api.tenant>>;
  canManage: boolean;
  onSaved: (message: string) => void;
  onReload: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || pending) return;
    const data = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = String(data.get(key) ?? "").trim();
      return value === "" ? null : value;
    };
    setPending(true);
    setError(null);
    try {
      await api.updateTenantName(token, {
        name: String(data.get("name") ?? "").trim(),
        defaultTimezone: text("defaultTimezone"),
        defaultLocale: text("defaultLocale"),
        defaultCurrency: text("defaultCurrency")?.toUpperCase() ?? null,
        contactAdminName: text("contactAdminName"),
        contactAdminEmail: text("contactAdminEmail"),
        contactAdminPhone: text("contactAdminPhone"),
      });
      onSaved("Profil tenant disimpan.");
      onReload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Profil tenant tidak dapat disimpan.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Alert tone="error">{error}</Alert>}
      <fieldset disabled={pending || !canManage} className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama workspace" required>
          <Input name="name" required defaultValue={profile.name} minLength={2} maxLength={120} />
        </Field>
        <Field label="Zona waktu bawaan" hint="Diwarisi Legal Entity dan unit yang tidak menimpanya.">
          <Input name="defaultTimezone" defaultValue={profile.defaultTimezone ?? ""} placeholder="Asia/Jakarta" />
        </Field>
        <Field label="Locale bawaan">
          <Input name="defaultLocale" defaultValue={profile.defaultLocale ?? ""} placeholder="id-ID" />
        </Field>
        <Field label="Mata uang bawaan" hint="Tiga huruf kode ISO 4217.">
          <Input name="defaultCurrency" defaultValue={profile.defaultCurrency ?? ""} placeholder="IDR" maxLength={3} />
        </Field>
        <Field label="Nama admin kontak">
          <Input name="contactAdminName" defaultValue={profile.contactAdminName ?? ""} />
        </Field>
        <Field label="Email admin kontak">
          <Input name="contactAdminEmail" type="email" defaultValue={profile.contactAdminEmail ?? ""} />
        </Field>
        <Field label="Telepon admin kontak">
          <Input name="contactAdminPhone" defaultValue={profile.contactAdminPhone ?? ""} />
        </Field>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || !canManage}>
          {pending ? "Menyimpan…" : "Simpan profil"}
        </Button>
        {!canManage && <span className="text-xs text-ink-faint">Butuh izin tenant.update.</span>}
        <span className="text-xs text-ink-faint">Kosongkan sebuah kolom untuk menghapus nilainya.</span>
      </div>
    </form>
  );
}