import { useState, type FormEvent } from "react";
import {
  api,
  ApiError,
  type DepartmentRow,
  type HierarchyHistoryEntry,
  type LegalEntityRow,
  type OrganizationUnitChangeRequest,
} from "../../../lib/api";
import { OverlayDialog } from "../../../shell/components/OverlayDialog";
import {
  Alert,
  Button,
  DataTable,
  Field,
  Input,
  Select,
  StatusPill,
  Textarea,
  type Column,
} from "../../../shell/components/ui";
import { useAdminResource } from "../console/useAdminResource";
import { AdminPanel, AdminSectionState } from "../console/AdminSection";

/**
 * Panel Admin — Organization category (Epic 15 Decision #2).
 *
 * Three structures that genuinely differ, kept apart rather than merged into
 * one "org" table:
 *
 *   Legal Entity   the official legal identity; a Tenant is not a company.
 *   Unit           the authorization scope hierarchy, changed through
 *                  change requests — a proposal is not a publish (§4.5 #12).
 *   Department     organises people; NOT an authorization scope, no scope id
 *                  anywhere in the data model.
 *
 * Reads are gated by their own codes and the API is authoritative; the
 * client's `canManage` only hides buttons.
 */
type OrgUnitRow = Awaited<ReturnType<typeof api.organizationUnits>>[number];

const STATUS_LABELS: Record<string, string> = {
  draft: "Draf",
  pending_review: "Menunggu tinjauan",
  published: "Terbit",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "published") return "success";
  if (status === "pending_review") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("id-ID");
}

/** `datetime-local` yields `YYYY-MM-DDTHH:mm` with no zone; the API refuses a
 *  zone-less effective date, so the tenant's own offset is attached here. */
function withLocalOffset(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${value}:00${sign}${hh}:${mm}`;
}

export function OrganizationPanel({
  token,
  canManage,
  onMessage,
}: {
  token: string;
  canManage: boolean;
  onMessage: (m: { type: "error" | "success"; text: string }) => void;
}) {
  const units = useAdminResource(api.organizationUnits, "Gagal memuat organization unit.");
  const entities = useAdminResource(api.legalEntities, "Gagal memuat legal entity.");
  const departments = useAdminResource(api.departments, "Gagal memuat department.");
  const requests = useAdminResource(
    (t) => api.organizationUnitChangeRequests(t, { status: "pending_review" }),
    "Gagal memuat permintaan perubahan.",
  );

  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [history, setHistory] = useState<HierarchyHistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [dialog, setDialog] = useState<
    null | "entity" | "unit" | "department" | "change" | "publish" | "reject"
  >(null);
  const [requestTarget, setRequestTarget] = useState("");
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [activeTarget, setActiveTarget] = useState<{
    kind: "unit" | "department" | "entity";
    id: string;
    next: boolean;
    name: string;
  } | null>(null);

  async function loadHistory(unitId: string) {
    setSelectedUnitId(unitId);
    setHistory(null);
    setHistoryError(null);
    if (!unitId) return;
    try {
      setHistory(await api.organizationUnitHierarchy(token, unitId));
    } catch (error) {
      setHistoryError(
        error instanceof ApiError ? error.message : "Gagal memuat riwayat hierarki.",
      );
    }
  }

  async function runAction(key: string, action: () => Promise<void>, success: string) {
    setActionPending(key);
    try {
      await action();
      onMessage({ type: "success", text: success });
    } catch (error) {
      onMessage({
        type: "error",
        text: error instanceof ApiError ? error.message : "Tindakan tidak dapat diselesaikan.",
      });
    } finally {
      setActionPending(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (key: string) => {
      const value = String(data.get(key) ?? "").trim();
      return value === "" ? null : value;
    };
    setPending(true);
    setDialogError(null);
    try {
      switch (dialog) {
        case "entity":
          await api.createLegalEntity(token, {
            name: String(data.get("name") ?? "").trim(),
            registrationNo: text("registrationNo"),
            displayName: text("displayName"),
            country: text("country"),
            timezone: text("timezone"),
            baseCurrency: text("baseCurrency")?.toUpperCase() ?? null,
            email: text("email"),
            phone: text("phone"),
          });
          void entities.reload();
          void units.reload();
          break;
        case "unit":
          await api.createOrganizationUnit(token, {
            legalEntityId: String(data.get("legalEntityId") ?? ""),
            parentId: text("parentId"),
            name: String(data.get("name") ?? "").trim(),
            unitType: text("unitType") ?? undefined,
          });
          void units.reload();
          break;
        case "department":
          await api.createDepartment(token, {
            name: String(data.get("name") ?? "").trim(),
            code: text("code"),
            parentDepartmentId: text("parentId"),
          });
          void departments.reload();
          break;
        case "change": {
          const effectiveFrom = String(data.get("requestedEffectiveFrom") ?? "");
          await api.createOrganizationUnitChangeRequest(
            token,
            String(data.get("organizationUnitId") ?? ""),
            {
              requestedAction: String(data.get("requestedAction")) === "tombstone" ? "tombstone" : "move",
              proposedParentOrganizationUnitId: text("proposedParentOrganizationUnitId"),
              requestedReplacementOrganizationUnitId: text("requestedReplacementOrganizationUnitId"),
              requestedEffectiveFrom: withLocalOffset(effectiveFrom),
              reason: String(data.get("reason") ?? "").trim(),
              submitForReview: true,
            },
          );
          void requests.reload();
          break;
        }
        case "publish":
          await api.publishOrganizationUnitChangeRequest(token, String(data.get("requestId") ?? ""));
          void requests.reload();
          void units.reload();
          break;
        case "reject":
          await api.rejectOrganizationUnitChangeRequest(
            token,
            requestTarget,
            String(data.get("reviewReason") ?? "").trim(),
          );
          void requests.reload();
          break;
      }
    } catch (error) {
      setDialogError(
        error instanceof ApiError ? error.message : "Perubahan tidak dapat disimpan.",
      );
      return;
    } finally {
      setPending(false);
    }
    setDialog(null);
    onMessage({ type: "success", text: "Perubahan disimpan." });
  }

  const entityColumns: Column<LegalEntityRow>[] = [
    { header: "Nama", mobileRole: "title", cell: (row) => row.displayName || row.name },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={row.isActive ? "success" : "neutral"}>
          {row.isActive ? "Aktif" : "Nonaktif"}
        </StatusPill>
      ),
    },
    { header: "Negara", cell: (row) => row.country ?? "—" },
    { header: "Mata uang", cell: (row) => row.baseCurrency ?? "—" },
    { header: "Registrasi", cell: (row) => <span className="font-mono text-xs">{row.registrationNo ?? "—"}</span> },
    {
      header: "Aksi",
      cell: (row) =>
        canManage && (
          <Button
            variant="ghost"
            disabled={actionPending === `entity:${row.id}`}
            onClick={() =>
              setActiveTarget({ kind: "entity", id: row.id, next: !row.isActive, name: row.displayName || row.name })
            }
          >
            {row.isActive ? "Nonaktifkan" : "Aktifkan"}
          </Button>
        ),
    },
  ];

  const unitColumns: Column<OrgUnitRow>[] = [
    { header: "Unit", mobileRole: "title", cell: (row) => row.name },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={row.isActive ? "success" : "neutral"}>
          {row.isActive ? "Aktif" : "Nonaktif"}
        </StatusPill>
      ),
    },
    { header: "Tipe", cell: (row) => row.unitType },
    {
      header: "Induk",
      cell: (row) =>
        row.parentId
          ? (units.data?.find((unit) => unit.id === row.parentId)?.name ?? "—")
          : <span className="text-ink-faint">Akar</span>,
    },
    {
      header: "Riwayat",
      cell: (row) => (
        <Button variant="secondary" onClick={() => void loadHistory(row.id)}>
          Lihat riwayat
        </Button>
      ),
    },
  ];

  const departmentColumns: Column<DepartmentRow>[] = [
    { header: "Department", mobileRole: "title", cell: (row) => row.name },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={row.isActive ? "success" : "neutral"}>
          {row.isActive ? "Aktif" : "Nonaktif"}
        </StatusPill>
      ),
    },
    { header: "Kode", cell: (row) => <span className="font-mono text-xs">{row.code ?? "—"}</span> },
    {
      header: "Induk",
      cell: (row) =>
        row.parentDepartmentId
          ? (departments.data?.find((d) => d.id === row.parentDepartmentId)?.name ?? "—")
          : <span className="text-ink-faint">Akar</span>,
    },
    {
      header: "Aksi",
      cell: (row) =>
        canManage && (
          <Button
            variant="ghost"
            onClick={() => setActiveTarget({ kind: "department", id: row.id, next: !row.isActive, name: row.name })}
          >
            {row.isActive ? "Nonaktifkan" : "Aktifkan"}
          </Button>
        ),
    },
  ];

  const requestColumns: Column<OrganizationUnitChangeRequest>[] = [
    {
      header: "Unit",
      mobileRole: "title",
      cell: (row) => units.data?.find((unit) => unit.id === row.organizationUnitId)?.name ?? row.organizationUnitId,
    },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={statusTone(row.status)}>{STATUS_LABELS[row.status] ?? row.status}</StatusPill>
      ),
    },
    { header: "Tindakan", cell: (row) => (row.requestedAction === "move" ? "Pindah induk" : "Tombstone") },
    { header: "Berlaku", cell: (row) => formatDate(row.requestedEffectiveFrom) },
    { header: "Alasan", cell: (row) => <span className="wrap-break-word">{row.reason}</span> },
    {
      header: "Aksi",
      cell: (row) =>
        canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setRequestTarget(row.id);
                setDialog("publish");
              }}
            >
              Terbitkan
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setRequestTarget(row.id);
                setDialog("reject");
              }}
            >
              Tolak
            </Button>
          </div>
        ),
    },
  ];

  const historyColumns: Column<HierarchyHistoryEntry>[] = [
    { header: "Berlaku dari", mobileRole: "title", cell: (row) => formatDate(row.effectiveFrom) },
    { header: "Sampai", cell: (row) => formatDate(row.effectiveTo) },
    {
      header: "Induk",
      cell: (row) =>
        row.parentOrganizationUnitId
          ? (units.data?.find((unit) => unit.id === row.parentOrganizationUnitId)?.name ?? row.parentOrganizationUnitId)
          : <span className="text-ink-faint">Akar</span>,
    },
    { header: "Alasan", cell: (row) => <span className="wrap-break-word">{row.reason}</span> },
  ];

  const dialogTitle =
    dialog === "entity"
      ? "Buat legal entity"
      : dialog === "unit"
        ? "Buat organization unit"
        : dialog === "department"
          ? "Buat department"
          : dialog === "change"
            ? "Ajukan perubahan struktur"
            : dialog === "reject"
              ? "Tolak permintaan perubahan"
              : "Terbitkan permintaan perubahan";

  return (
    <div className="space-y-4">
      <AdminPanel
        title="Legal entity"
        description="Identitas hukum resmi. Tenant bukan profil perusahaan; default di sini diwarisi unit di bawahnya."
        actions={
          canManage && <Button onClick={() => setDialog("entity")}>Buat legal entity</Button>
        }
      >
        <AdminSectionState {...entities} onRetry={entities.reload} loadingLabel="Memuat legal entity…">
          <DataTable
            columns={entityColumns}
            rows={entities.data ?? []}
            keyOf={(row) => row.id}
            empty={<p className="text-sm text-ink-dim">Belum ada legal entity.</p>}
          />
        </AdminSectionState>
      </AdminPanel>

      <AdminPanel
        title="Organization unit"
        description="Hierarki yang menjadi scope otorisasi. Perubahan induk diajukan sebagai permintaan, bukan langsung diterapkan."
        actions={
          canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setDialog("change")}>
                Ajukan perubahan
              </Button>
              <Button onClick={() => setDialog("unit")}>Buat unit</Button>
            </div>
          )
        }
      >
        <AdminSectionState {...units} onRetry={units.reload} loadingLabel="Memuat organization unit…">
          <DataTable
            columns={unitColumns}
            rows={units.data ?? []}
            keyOf={(row) => row.id}
            empty={<p className="text-sm text-ink-dim">Belum ada organization unit.</p>}
          />
        </AdminSectionState>
        {historyError && <Alert tone="error">{historyError}</Alert>}
        {selectedUnitId && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold text-ink">Riwayat hierarki</h3>
            <DataTable
              columns={historyColumns}
              rows={history ?? []}
              keyOf={(row) => row.id}
              empty={<p className="text-sm text-ink-dim">Belum ada riwayat untuk unit ini.</p>}
            />
          </div>
        )}
      </AdminPanel>

      <AdminPanel
        title="Permintaan perubahan"
        description="Antrean tinjauan. Membuat permintaan dan menerbitkannya memerlukan izin berbeda."
        actions={canManage && <Button onClick={() => setDialog("change")}>Ajukan perubahan</Button>}
      >
        <AdminSectionState {...requests} onRetry={requests.reload} loadingLabel="Memuat permintaan…">
          <DataTable
            columns={requestColumns}
            rows={requests.data ?? []}
            keyOf={(row) => row.id}
            empty={<p className="text-sm text-ink-dim">Tidak ada permintaan menunggu tinjauan.</p>}
          />
        </AdminSectionState>
      </AdminPanel>

      <AdminPanel
        title="Department"
        description="Mengelompokkan orang. Department bukan scope otorisasi dan tidak dipakai untuk keputusan data scope."
        actions={canManage && <Button onClick={() => setDialog("department")}>Buat department</Button>}
      >
        <AdminSectionState {...departments} onRetry={departments.reload} loadingLabel="Memuat department…">
          <DataTable
            columns={departmentColumns}
            rows={departments.data ?? []}
            keyOf={(row) => row.id}
            empty={<p className="text-sm text-ink-dim">Belum ada department.</p>}
          />
        </AdminSectionState>
      </AdminPanel>

      <OverlayDialog
        open={activeTarget !== null}
        title={activeTarget?.next ? "Aktifkan entitas" : "Nonaktifkan entitas"}
        pending={actionPending !== null}
        onClose={() => setActiveTarget(null)}
        footer={
          <>
            <Button variant="secondary" disabled={actionPending !== null} onClick={() => setActiveTarget(null)}>
              Batal
            </Button>
            <Button
              disabled={actionPending !== null}
              onClick={() => {
                const target = activeTarget;
                if (!target) return;
                void runAction(
                  `${target.kind}:${target.id}`,
                  async () => {
                    if (target.kind === "department") {
                      await api.setDepartmentActive(token, target.id, target.next);
                      await departments.reload();
                    } else if (target.kind === "entity") {
                      await (target.next
                        ? api.activateLegalEntity(token, target.id)
                        : api.deactivateLegalEntity(token, target.id));
                      await entities.reload();
                    } else {
                      await (target.next
                        ? api.activateOrganizationUnit(token, target.id)
                        : api.deactivateOrganizationUnit(token, target.id));
                      await units.reload();
                    }
                  },
                  target.next ? "Entitas diaktifkan." : "Entitas dinonaktifkan.",
                ).then(() => setActiveTarget(null));
              }}
            >
              {actionPending !== null ? "Memproses…" : activeTarget?.next ? "Aktifkan" : "Nonaktifkan"}
            </Button>
          </>
        }
      >
        {activeTarget && (
          <p>
            {activeTarget.next ? "Aktifkan" : "Nonaktifkan"} <strong>{activeTarget.name}</strong>?
          </p>
        )}
      </OverlayDialog>

      <OverlayDialog
        open={dialog !== null}
        title={dialogTitle}
        pending={pending}
        onClose={() => {
          if (!pending) setDialog(null);
        }}
        footer={
          <>
            <Button variant="secondary" disabled={pending} onClick={() => setDialog(null)}>
              Batal
            </Button>
            <Button type="submit" form="organization-change" disabled={pending}>
              {pending ? "Menyimpan…" : dialog === "publish" ? "Terbitkan" : "Simpan"}
            </Button>
          </>
        }
      >
        {dialogError && <Alert tone="error">{dialogError}</Alert>}
        <form id="organization-change" onSubmit={submit} className="space-y-3">
          <fieldset disabled={pending} className="space-y-3">
            {dialog === "entity" && (
              <>
                <Field label="Nama hukum" required>
                  <Input name="name" required minLength={2} />
                </Field>
                <Field label="Nama dagang">
                  <Input name="displayName" />
                </Field>
                <Field label="Nomor registrasi">
                  <Input name="registrationNo" />
                </Field>
                <Field label="Negara">
                  <Input name="country" placeholder="ID" />
                </Field>
                <Field label="Zona waktu" hint="Kosong berarti mewarisi default tenant.">
                  <Input name="timezone" placeholder="Asia/Jakarta" />
                </Field>
                <Field label="Mata uang dasar" hint="Tiga huruf ISO 4217.">
                  <Input name="baseCurrency" maxLength={3} placeholder="IDR" />
                </Field>
                <Field label="Email">
                  <Input name="email" type="email" />
                </Field>
                <Field label="Telepon">
                  <Input name="phone" />
                </Field>
              </>
            )}

            {dialog === "unit" && (
              <>
                <Field label="Legal entity" required>
                  <Select name="legalEntityId" required defaultValue="">
                    <option value="" disabled>
                      Pilih legal entity
                    </option>
                    {entities.data?.map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {entity.displayName || entity.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Induk" hint="Kosong berarti unit akar di bawah Legal Entity.">
                  <Select name="parentId" defaultValue="">
                    <option value="">Tanpa induk</option>
                    {units.data?.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Nama unit" required>
                  <Input name="name" required />
                </Field>
                <Field label="Tipe unit" hint="Teks bebas, misalnya cabang atau gudang.">
                  <Input name="unitType" />
                </Field>
              </>
            )}

            {dialog === "department" && (
              <>
                <Field label="Nama" required>
                  <Input name="name" required maxLength={160} />
                </Field>
                <Field label="Kode" hint="Unik per tenant. Boleh dikosongkan.">
                  <Input name="code" maxLength={64} />
                </Field>
                <Field label="Department induk">
                  <Select name="parentId" defaultValue="">
                    <option value="">Tanpa induk</option>
                    {departments.data?.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}

            {dialog === "change" && (
              <>
                <Field label="Unit" required>
                  <Select name="organizationUnitId" required defaultValue="">
                    <option value="" disabled>
                      Pilih unit
                    </option>
                    {units.data?.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Tindakan" required>
                  <Select name="requestedAction" defaultValue="move">
                    <option value="move">Pindah induk</option>
                    <option value="tombstone">Tombstone</option>
                  </Select>
                </Field>
                <Field label="Induk baru" hint="Hanya untuk tindakan pindah.">
                  <Select name="proposedParentOrganizationUnitId" defaultValue="">
                    <option value="">Jadikan akar</option>
                    {units.data?.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Unit pengganti" hint="Hanya untuk tindakan tombstone.">
                  <Select name="requestedReplacementOrganizationUnitId" defaultValue="">
                    <option value="">Tanpa pengganti</option>
                    {units.data?.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Berlaku mulai" required hint="Waktu lokal; zona waktu tenant ditambahkan otomatis.">
                  <Input name="requestedEffectiveFrom" type="datetime-local" required />
                </Field>
                <Field label="Alasan" required>
                  <Input name="reason" required />
                </Field>
                <p className="text-xs text-ink-faint">
                  Permintaan dikirim untuk ditinjau. Menerbitkannya memerlukan izin tinjauan.
                </p>
              </>
            )}

            {dialog === "publish" && (
              <Field label="Permintaan" required>
                <Select name="requestId" required defaultValue={requestTarget}>
                  <option value="" disabled>
                    Pilih permintaan menunggu tinjauan
                  </option>
                  {(requests.data ?? []).map((request) => (
                    <option key={request.id} value={request.id}>
                      {units.data?.find((unit) => unit.id === request.organizationUnitId)?.name ?? request.organizationUnitId} — {STATUS_LABELS[request.status] ?? request.status}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {dialog === "reject" && (
              <>
                <p className="text-sm text-ink-dim">
                  Tolak permintaan{" "}
                  {units.data?.find(
                    (unit) =>
                      unit.id ===
                      (requests.data ?? []).find((request) => request.id === requestTarget)
                        ?.organizationUnitId,
                  )?.name ?? requestTarget}
                  ? Alasan tercatat di jejak audit.
                </p>
                <Field label="Alasan penolakan" required>
                  <Textarea name="reviewReason" required rows={3} />
                </Field>
              </>
            )}
          </fieldset>
        </form>
      </OverlayDialog>
    </div>
  );
}