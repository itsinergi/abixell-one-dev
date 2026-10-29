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
import type { MessageKey } from "../../../i18n/dictionaries/en";
import { useT } from "../../../i18n/LocaleProvider";

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

function getStatusLabel(t: ReturnType<typeof useT>, status: string): string {
  const statusMap: Record<string, MessageKey> = {
    draft: "orgPanel.statusDraft",
    pending_review: "orgPanel.statusPendingReview",
    published: "orgPanel.statusPublished",
    rejected: "orgPanel.statusRejected",
    cancelled: "orgPanel.statusCancelled",
  };
  const key = statusMap[status];
  return key ? t(key) : status;
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "published") return "success";
  if (status === "pending_review") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB");
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
  const t = useT();
  const units = useAdminResource(api.organizationUnits, t("orgPanel.loadUnitsFailed"));
  const entities = useAdminResource(api.legalEntities, t("orgPanel.loadEntitiesFailed"));
  const departments = useAdminResource(api.departments, t("orgPanel.loadDepartmentsFailed"));
  const requests = useAdminResource(
    (token) => api.organizationUnitChangeRequests(token, { status: "pending_review" }),
    t("orgPanel.loadRequestsFailed"),
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
        error instanceof ApiError ? error.message : t("orgPanel.loadHistoryFailed"),
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
        text: error instanceof ApiError ? error.message : t("orgPanel.actionFailed"),
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
        error instanceof ApiError ? error.message : t("orgPanel.saveFailed"),
      );
      return;
    } finally {
      setPending(false);
    }
    setDialog(null);
    onMessage({ type: "success", text: t("orgPanel.changesSaved") });
  }

  const entityColumns: Column<LegalEntityRow>[] = [
    { header: t("orgPanel.entityName"), mobileRole: "title", cell: (row) => row.displayName || row.name },
    {
      header: t("orgPanel.entityStatus"),
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={row.isActive ? "success" : "neutral"}>
          {row.isActive ? t("orgPanel.entityActive") : t("orgPanel.entityInactive")}
        </StatusPill>
      ),
    },
    { header: t("orgPanel.entityCountry"), cell: (row) => row.country ?? "—" },
    { header: t("orgPanel.entityCurrency"), cell: (row) => row.baseCurrency ?? "—" },
    { header: t("orgPanel.entityRegistration"), cell: (row) => <span className="font-mono text-xs">{row.registrationNo ?? "—"}</span> },
    {
      header: t("orgPanel.entityAction"),
      cell: (row) =>
        canManage && (
          <Button
            variant="ghost"
            disabled={actionPending === `entity:${row.id}`}
            onClick={() =>
              setActiveTarget({ kind: "entity", id: row.id, next: !row.isActive, name: row.displayName || row.name })
            }
          >
            {row.isActive ? t("orgPanel.entityDeactivate") : t("orgPanel.entityActivate")}
          </Button>
        ),
    },
  ];

  const unitColumns: Column<OrgUnitRow>[] = [
    { header: t("orgPanel.unitName"), mobileRole: "title", cell: (row) => row.name },
    {
      header: t("orgPanel.entityStatus"),
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={row.isActive ? "success" : "neutral"}>
          {row.isActive ? t("orgPanel.entityActive") : t("orgPanel.entityInactive")}
        </StatusPill>
      ),
    },
    { header: t("orgPanel.unitType"), cell: (row) => row.unitType },
    {
      header: t("orgPanel.unitParent"),
      cell: (row) =>
        row.parentId
          ? (units.data?.find((unit) => unit.id === row.parentId)?.name ?? "—")
          : <span className="text-ink-faint">{t("orgPanel.unitRoot")}</span>,
    },
    {
      header: t("orgPanel.unitHistory"),
      cell: (row) => (
        <Button variant="secondary" onClick={() => void loadHistory(row.id)}>
          {t("orgPanel.viewHistory")}
        </Button>
      ),
    },
  ];

  const departmentColumns: Column<DepartmentRow>[] = [
    { header: t("orgPanel.departmentName"), mobileRole: "title", cell: (row) => row.name },
    {
      header: t("orgPanel.entityStatus"),
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={row.isActive ? "success" : "neutral"}>
          {row.isActive ? t("orgPanel.entityActive") : t("orgPanel.entityInactive")}
        </StatusPill>
      ),
    },
    { header: t("orgPanel.departmentCode"), cell: (row) => <span className="font-mono text-xs">{row.code ?? "—"}</span> },
    {
      header: t("orgPanel.departmentParent"),
      cell: (row) =>
        row.parentDepartmentId
          ? (departments.data?.find((d) => d.id === row.parentDepartmentId)?.name ?? "—")
          : <span className="text-ink-faint">{t("orgPanel.unitRoot")}</span>,
    },
    {
      header: t("orgPanel.entityAction"),
      cell: (row) =>
        canManage && (
          <Button
            variant="ghost"
            onClick={() => setActiveTarget({ kind: "department", id: row.id, next: !row.isActive, name: row.name })}
          >
            {row.isActive ? t("orgPanel.entityDeactivate") : t("orgPanel.entityActivate")}
          </Button>
        ),
    },
  ];

  const requestColumns: Column<OrganizationUnitChangeRequest>[] = [
    {
      header: t("orgPanel.unitName"),
      mobileRole: "title",
      cell: (row) => units.data?.find((unit) => unit.id === row.organizationUnitId)?.name ?? row.organizationUnitId,
    },
    {
      header: t("orgPanel.entityStatus"),
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={statusTone(row.status)}>{getStatusLabel(t, row.status)}</StatusPill>
      ),
    },
    { header: t("orgPanel.requestedChange"), cell: (row) => (row.requestedAction === "move" ? t("orgPanel.fieldMoveParent") : t("orgPanel.fieldTombstone")) },
    { header: t("orgPanel.requestEffective"), cell: (row) => formatDate(row.requestedEffectiveFrom) },
    { header: t("orgPanel.requestReason"), cell: (row) => <span className="wrap-break-word">{row.reason}</span> },
    {
      header: t("orgPanel.entityAction"),
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
              {t("orgPanel.requestPublish")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setRequestTarget(row.id);
                setDialog("reject");
              }}
            >
              {t("orgPanel.requestReject")}
            </Button>
          </div>
        ),
    },
  ];

  const historyColumns: Column<HierarchyHistoryEntry>[] = [
    { header: t("orgPanel.fieldEffectiveFrom"), mobileRole: "title", cell: (row) => formatDate(row.effectiveFrom) },
    { header: t("orgPanel.historyUntil"), cell: (row) => formatDate(row.effectiveTo) },
    {
      header: t("orgPanel.unitParent"),
      cell: (row) =>
        row.parentOrganizationUnitId
          ? (units.data?.find((unit) => unit.id === row.parentOrganizationUnitId)?.name ?? row.parentOrganizationUnitId)
          : <span className="text-ink-faint">{t("orgPanel.unitRoot")}</span>,
    },
    { header: t("orgPanel.requestReason"), cell: (row) => <span className="wrap-break-word">{row.reason}</span> },
  ];

  const dialogTitle =
    dialog === "entity"
      ? t("orgPanel.createEntityTitle")
      : dialog === "unit"
        ? t("orgPanel.createUnitTitle")
        : dialog === "department"
          ? t("orgPanel.createDeptTitle")
          : dialog === "change"
            ? t("orgPanel.changeRequestTitle")
            : dialog === "reject"
              ? t("orgPanel.rejectTitle")
              : t("orgPanel.publishTitle");

  return (
    <div className="space-y-4">
      <AdminPanel
        title={t("orgPanel.legalEntitySection")}
        description={t("orgPanel.legalEntityDesc")}
        actions={
          canManage && <Button onClick={() => setDialog("entity")}>{t("orgPanel.createEntity")}</Button>
        }
      >
        <AdminSectionState {...entities} onRetry={entities.reload} loadingLabel={t("orgPanel.loadingEntities")}>
          <DataTable
            columns={entityColumns}
            rows={entities.data ?? []}
            keyOf={(row) => row.id}
            empty={<p className="text-sm text-ink-dim">{t("orgPanel.noEntities")}</p>}
          />
        </AdminSectionState>
      </AdminPanel>

      <AdminPanel
        title={t("orgPanel.orgUnitSection")}
        description={t("orgPanel.orgUnitDesc")}
        actions={
          canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setDialog("change")}>
                {t("orgPanel.requestChange")}
              </Button>
              <Button onClick={() => setDialog("unit")}>{t("orgPanel.createUnit")}</Button>
            </div>
          )
        }
      >
        <AdminSectionState {...units} onRetry={units.reload} loadingLabel={t("orgPanel.loadingUnits")}>
          <DataTable
            columns={unitColumns}
            rows={units.data ?? []}
            keyOf={(row) => row.id}
            empty={<p className="text-sm text-ink-dim">{t("orgPanel.noUnits")}</p>}
          />
        </AdminSectionState>
        {historyError && <Alert tone="error">{historyError}</Alert>}
        {selectedUnitId && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold text-ink">{t("orgPanel.hierarchyHistory")}</h3>
            <DataTable
              columns={historyColumns}
              rows={history ?? []}
              keyOf={(row) => row.id}
              empty={<p className="text-sm text-ink-dim">{t("orgPanel.noHistory")}</p>}
            />
          </div>
        )}
      </AdminPanel>

      <AdminPanel
        title={t("orgPanel.requestsSection")}
        description={t("orgPanel.requestsDesc")}
        actions={canManage && <Button onClick={() => setDialog("change")}>{t("orgPanel.requestChange")}</Button>}
      >
        <AdminSectionState {...requests} onRetry={requests.reload} loadingLabel={t("orgPanel.loadingRequests")}>
          <DataTable
            columns={requestColumns}
            rows={requests.data ?? []}
            keyOf={(row) => row.id}
            empty={<p className="text-sm text-ink-dim">{t("orgPanel.noRequests")}</p>}
          />
        </AdminSectionState>
      </AdminPanel>

      <AdminPanel
        title={t("orgPanel.departmentSection")}
        description={t("orgPanel.departmentDesc")}
        actions={canManage && <Button onClick={() => setDialog("department")}>{t("orgPanel.createDepartment")}</Button>}
      >
        <AdminSectionState {...departments} onRetry={departments.reload} loadingLabel={t("orgPanel.loadingDepartments")}>
          <DataTable
            columns={departmentColumns}
            rows={departments.data ?? []}
            keyOf={(row) => row.id}
            empty={<p className="text-sm text-ink-dim">{t("orgPanel.noDepartments")}</p>}
          />
        </AdminSectionState>
      </AdminPanel>

      <OverlayDialog
        open={activeTarget !== null}
        title={activeTarget?.next ? t("orgPanel.entityActivate") : t("orgPanel.entityDeactivate")}
        pending={actionPending !== null}
        onClose={() => setActiveTarget(null)}
        footer={
          <>
            <Button variant="secondary" disabled={actionPending !== null} onClick={() => setActiveTarget(null)}>
              {t("common.cancel")}
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
                  target.next ? t("orgPanel.entityActivated") : t("orgPanel.entityDeactivated"),
                ).then(() => setActiveTarget(null));
              }}
            >
              {actionPending !== null ? t("orgPanel.working") : activeTarget?.next ? t("orgPanel.entityActivate") : t("orgPanel.entityDeactivate")}
            </Button>
          </>
        }
      >
        {activeTarget && (
          <p>
            {t("orgPanel.confirmActivate", {
              action: activeTarget.next ? t("orgPanel.entityActivate") : t("orgPanel.entityDeactivate"),
              name: activeTarget.name,
            })}
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
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="organization-change" disabled={pending}>
              {pending ? t("orgPanel.working") : dialog === "publish" ? t("orgPanel.requestPublish") : t("common.save")}
            </Button>
          </>
        }
      >
        {dialogError && <Alert tone="error">{dialogError}</Alert>}
        <form id="organization-change" onSubmit={submit} className="space-y-3">
          <fieldset disabled={pending} className="space-y-3">
            {dialog === "entity" && (
              <>
                <Field label={t("orgPanel.fieldLegalName")} required>
                  <Input name="name" required minLength={2} />
                </Field>
                <Field label={t("orgPanel.fieldTradingName")}>
                  <Input name="displayName" />
                </Field>
                <Field label={t("orgPanel.fieldRegistrationNo")}>
                  <Input name="registrationNo" />
                </Field>
                <Field label={t("orgPanel.fieldCountry")}>
                  <Input name="country" placeholder="ID" />
                </Field>
                <Field label={t("orgPanel.fieldTimezone")} hint={t("orgPanel.timezoneHint")}>
                  <Input name="timezone" placeholder="Asia/Jakarta" />
                </Field>
                <Field label={t("orgPanel.fieldBaseCurrency")} hint={t("orgPanel.currencyHint")}>
                  <Input name="baseCurrency" maxLength={3} placeholder="IDR" />
                </Field>
                <Field label={t("orgPanel.fieldEmail")}>
                  <Input name="email" type="email" />
                </Field>
                <Field label={t("orgPanel.fieldPhone")}>
                  <Input name="phone" />
                </Field>
              </>
            )}

            {dialog === "unit" && (
              <>
                <Field label={t("orgPanel.fieldLegalEntity")} required>
                  <Select name="legalEntityId" required defaultValue="">
                    <option value="" disabled>
                      {t("orgPanel.selectLegalEntity")}
                    </option>
                    {entities.data?.map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {entity.displayName || entity.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("orgPanel.fieldParent")} hint={t("orgPanel.unitRootHint")}>
                  <Select name="parentId" defaultValue="">
                    <option value="">{t("orgPanel.noParentUnit")}</option>
                    {units.data?.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("orgPanel.fieldUnitName")} required>
                  <Input name="name" required />
                </Field>
                <Field label={t("orgPanel.fieldUnitType")} hint={t("orgPanel.unitTypeHint")}>
                  <Input name="unitType" />
                </Field>
              </>
            )}

            {dialog === "department" && (
              <>
                <Field label={t("orgPanel.fieldDeptName")} required>
                  <Input name="name" required maxLength={160} />
                </Field>
                <Field label={t("orgPanel.fieldDeptCode")} hint={t("orgPanel.codeHint")}>
                  <Input name="code" maxLength={64} />
                </Field>
                <Field label={t("orgPanel.fieldParentDept")}>
                  <Select name="parentId" defaultValue="">
                    <option value="">{t("orgPanel.noParentDept")}</option>
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
                <Field label={t("orgPanel.unitName")} required>
                  <Select name="organizationUnitId" required defaultValue="">
                    <option value="" disabled>
                      {t("orgPanel.selectUnit")}
                    </option>
                    {units.data?.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("orgPanel.fieldAction")} required>
                  <Select name="requestedAction" defaultValue="move">
                    <option value="move">{t("orgPanel.fieldMoveParent")}</option>
                    <option value="tombstone">{t("orgPanel.fieldTombstone")}</option>
                  </Select>
                </Field>
                <Field label={t("orgPanel.fieldNewParent")} hint={t("orgPanel.actionMoveHint")}>
                  <Select name="proposedParentOrganizationUnitId" defaultValue="">
                    <option value="">{t("orgPanel.moveRoot")}</option>
                    {units.data?.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("orgPanel.fieldReplacementUnit")} hint={t("orgPanel.actionTombstoneHint")}>
                  <Select name="requestedReplacementOrganizationUnitId" defaultValue="">
                    <option value="">{t("orgPanel.noReplacement")}</option>
                    {units.data?.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("orgPanel.fieldEffectiveFrom")} required hint={t("orgPanel.effectiveFromHint")}>
                  <Input name="requestedEffectiveFrom" type="datetime-local" required />
                </Field>
                <Field label={t("orgPanel.fieldReason")} required>
                  <Input name="reason" required />
                </Field>
                <p className="text-xs text-ink-faint">
                  {t("orgPanel.requestSentReview")}
                </p>
              </>
            )}

            {dialog === "publish" && (
              <Field label={t("orgPanel.fieldRequest")} required>
                <Select name="requestId" required defaultValue={requestTarget}>
                  <option value="" disabled>
                    {t("orgPanel.selectRequest")}
                  </option>
                  {(requests.data ?? []).map((request) => (
                    <option key={request.id} value={request.id}>
                      {units.data?.find((unit) => unit.id === request.organizationUnitId)?.name ?? request.organizationUnitId} — {getStatusLabel(t, request.status)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {dialog === "reject" && (
              <>
                <p className="text-sm text-ink-dim">
                  {t("orgPanel.rejectPrompt", {
                    unitName:
                      units.data?.find(
                        (unit) =>
                          unit.id ===
                          (requests.data ?? []).find((request) => request.id === requestTarget)
                            ?.organizationUnitId,
                      )?.name ?? requestTarget,
                  })}
                </p>
                <Field label={t("orgPanel.rejectReason")} required>
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