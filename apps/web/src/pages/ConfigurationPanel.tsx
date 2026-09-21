import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";

/**
 * Checkpoint 0C — Configuration & Metadata panel.
 *
 * Proves, from the UI down to PostgreSQL, that Module Activation, Feature
 * Flags (with Configuration Scope precedence), Terminology, Reference Data,
 * and Numbering are genuine Tenant Configuration — nothing here is
 * hardcoded per client. Every label rendered from `terminology` comes from
 * the Configuration API, not from a literal string in this component.
 */

type OrgUnitOption = { id: string; name: string };

type ModuleRow = {
  moduleId: string;
  moduleCode: string;
  moduleName: string;
  isActive: boolean;
};

type FlagRow = { code: string; name: string; isEnabled: boolean; source: string };

type TermRow = { code: string; defaultLabel: string; value: string; isOverridden: boolean };

type RefTypeRow = { code: string; name: string };
type RefItemRow = { id: string; code: string; label: string; sortOrder: number; isActive: boolean };

export function ConfigurationPanel({
  token,
  orgUnits,
  canManage,
  onMessage,
}: {
  token: string;
  orgUnits: OrgUnitOption[];
  canManage: boolean;
  onMessage: (m: { type: "error" | "success"; text: string }) => void;
}) {
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [scopeOrgUnitId, setScopeOrgUnitId] = useState<string>("");
  const [effectiveFlags, setEffectiveFlags] = useState<FlagRow[]>([]);
  const [terminology, setTerminology] = useState<TermRow[]>([]);
  const [refTypes, setRefTypes] = useState<RefTypeRow[]>([]);
  const [refTypeCode, setRefTypeCode] = useState<string>("");
  const [refItems, setRefItems] = useState<RefItemRow[]>([]);
  const [numberingCode] = useState("demo_ticket");
  const [numberingInfo, setNumberingInfo] = useState<{ pattern: string; currentSequence: number } | null>(
    null,
  );
  const [lastGeneratedNumber, setLastGeneratedNumber] = useState<string | null>(null);

  const orgUnitLabel =
    terminology.find((t) => t.code === "organization_unit.label")?.value ?? "Organization Unit";

  const refresh = useCallback(async () => {
    try {
      const [moduleList, flagList, termList, refTypeList] = await Promise.all([
        api.configModules(token),
        api.configFeatureFlags(token),
        api.configTerminology(token),
        api.configReferenceDataTypes(token),
      ]);
      setModules(moduleList);
      setFlags(flagList);
      setTerminology(termList);
      setRefTypes(refTypeList);
      if (!refTypeCode && refTypeList.length > 0) {
        setRefTypeCode(refTypeList[0].code);
      }
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed to load Configuration" });
    }
    try {
      const info = await api.configNumberingSequence(token, numberingCode);
      setNumberingInfo(info);
    } catch {
      setNumberingInfo(null);
    }
  }, [token, onMessage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (orgUnits.length > 0 && !scopeOrgUnitId) {
      setScopeOrgUnitId(orgUnits[0].id);
    }
  }, [orgUnits, scopeOrgUnitId]);

  useEffect(() => {
    if (!scopeOrgUnitId) return;
    api
      .configEffectiveFeatureFlags(token, scopeOrgUnitId)
      .then(setEffectiveFlags)
      .catch((err) =>
        onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed to resolve flags" }),
      );
  }, [token, scopeOrgUnitId, onMessage]);

  useEffect(() => {
    if (!refTypeCode) return;
    api
      .configReferenceDataItems(token, refTypeCode)
      .then(setRefItems)
      .catch(() => setRefItems([]));
  }, [token, refTypeCode]);

  async function toggleModule(code: string, next: boolean) {
    try {
      await api.setConfigModuleActivation(token, code, next);
      onMessage({ type: "success", text: `Module '${code}' ${next ? "activated" : "deactivated"}.` });
      refresh();
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  async function toggleTenantFlag(code: string, next: boolean) {
    try {
      await api.setConfigFeatureFlag(token, code, { isEnabled: next, scopeType: "tenant" });
      onMessage({ type: "success", text: `Feature Flag '${code}' set to ${next} (tenant scope).` });
      refresh();
      if (scopeOrgUnitId) {
        api.configEffectiveFeatureFlags(token, scopeOrgUnitId).then(setEffectiveFlags);
      }
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  async function overrideAtScope(code: string, next: boolean) {
    if (!scopeOrgUnitId) return;
    try {
      await api.setConfigFeatureFlag(token, code, {
        isEnabled: next,
        scopeType: "organization_unit",
        scopeOrganizationUnitId: scopeOrgUnitId,
      });
      onMessage({
        type: "success",
        text: `Feature Flag '${code}' overridden to ${next} for the selected ${orgUnitLabel}.`,
      });
      const [flagList, effective] = await Promise.all([
        api.configFeatureFlags(token),
        api.configEffectiveFeatureFlags(token, scopeOrgUnitId),
      ]);
      setFlags(flagList);
      setEffectiveFlags(effective);
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  async function handleTerminologySubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const code = String(form.get("code"));
    const value = String(form.get("value"));
    try {
      await api.setConfigTerminology(token, code, value);
      onMessage({ type: "success", text: `Terminology '${code}' updated.` });
      e.currentTarget.reset();
      refresh();
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  async function handleCreateRefItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api.createConfigReferenceDataItem(token, refTypeCode, {
        code: String(form.get("code")),
        label: String(form.get("label")),
        sortOrder: form.get("sortOrder") ? Number(form.get("sortOrder")) : undefined,
      });
      onMessage({ type: "success", text: "Reference Data item created." });
      e.currentTarget.reset();
      const items = await api.configReferenceDataItems(token, refTypeCode);
      setRefItems(items);
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  async function handleGenerateNumber() {
    try {
      const result = await api.generateConfigNumber(token, numberingCode);
      setLastGeneratedNumber(result.number);
      const info = await api.configNumberingSequence(token, numberingCode);
      setNumberingInfo(info);
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-sm font-semibold text-slate-500">
        Configuration &amp; Metadata
      </h2>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Module Activation */}
        <section className="rounded border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">Module Activation</h3>
          <ul className="space-y-1 text-sm text-slate-700">
            {modules.map((m) => (
              <li key={m.moduleId} className="flex items-center justify-between">
                <span>{m.moduleName}</span>
                <button
                  disabled={!canManage}
                  onClick={() => toggleModule(m.moduleCode, !m.isActive)}
                  className={`rounded px-2 py-0.5 text-xs ${
                    m.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                  } disabled:opacity-50`}
                >
                  {m.isActive ? "Active" : "Inactive"}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Feature Flags + Configuration Scope */}
        <section className="rounded border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">
            Feature Flags — Configuration Scope
          </h3>
          <select
            value={scopeOrgUnitId}
            onChange={(e) => setScopeOrgUnitId(e.target.value)}
            className="mb-2 w-full rounded border border-slate-300 px-2 py-1 text-xs"
          >
            {orgUnits.map((u) => (
              <option key={u.id} value={u.id}>
                Resolve as: {u.name}
              </option>
            ))}
          </select>
          <ul className="space-y-2 text-sm text-slate-700">
            {flags.map((f) => {
              const effective = effectiveFlags.find((e) => e.code === f.code);
              return (
                <li key={f.code} className="border-b border-slate-100 pb-2">
                  <div className="flex items-center justify-between">
                    <span>{f.name}</span>
                    <span className="text-xs text-slate-400">catalog: {String(f.isEnabled)}</span>
                  </div>
                  {effective && (
                    <div className="mt-1 text-xs">
                      Effective at selected unit:{" "}
                      <span className="font-medium">{String(effective.isEnabled)}</span>{" "}
                      <span className="text-slate-400">(source: {effective.source})</span>
                    </div>
                  )}
                  {canManage && (
                    <div className="mt-1 flex gap-2">
                      <button
                        onClick={() => toggleTenantFlag(f.code, !f.isEnabled)}
                        className="rounded bg-slate-100 px-2 py-0.5 text-xs"
                      >
                        Set tenant-wide {String(!f.isEnabled)}
                      </button>
                      <button
                        onClick={() => overrideAtScope(f.code, !(effective?.isEnabled ?? false))}
                        className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white"
                      >
                        Override at selected unit: {String(!(effective?.isEnabled ?? false))}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* Terminology */}
        <section className="rounded border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">Terminology</h3>
          <ul className="space-y-1 text-sm text-slate-700">
            {terminology.map((t) => (
              <li key={t.code} className="flex items-center justify-between">
                <span>
                  {t.code} — <span className="font-medium">{t.value}</span>
                </span>
                {t.isOverridden && <span className="text-xs text-slate-400">(overridden)</span>}
              </li>
            ))}
          </ul>
          {canManage && (
            <form onSubmit={handleTerminologySubmit} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
              <div className="text-xs font-medium text-slate-500">Override a Terminology key</div>
              <select name="code" required className="w-full rounded border border-slate-300 px-2 py-1 text-sm">
                {terminology.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.code}
                  </option>
                ))}
              </select>
              <input
                name="value"
                placeholder="New label"
                required
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <button type="submit" className="rounded bg-slate-900 px-3 py-1 text-sm text-white">
                Save
              </button>
            </form>
          )}
        </section>

        {/* Reference Data */}
        <section className="rounded border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">Reference Data</h3>
          <select
            value={refTypeCode}
            onChange={(e) => setRefTypeCode(e.target.value)}
            className="mb-2 w-full rounded border border-slate-300 px-2 py-1 text-xs"
          >
            {refTypes.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
          <ul className="space-y-1 text-sm text-slate-700">
            {refItems.map((item) => (
              <li key={item.id}>
                {item.label} <span className="text-xs text-slate-400">({item.code})</span>
              </li>
            ))}
          </ul>
          {canManage && (
            <form onSubmit={handleCreateRefItem} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
              <div className="text-xs font-medium text-slate-500">Add item</div>
              <input name="code" placeholder="Code" required className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
              <input name="label" placeholder="Label" required className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
              <input name="sortOrder" type="number" placeholder="Sort order" className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
              <button type="submit" className="rounded bg-slate-900 px-3 py-1 text-sm text-white">
                Create
              </button>
            </form>
          )}
        </section>

        {/* Numbering */}
        <section className="rounded border border-slate-200 bg-white p-4 lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold">Numbering</h3>
          {numberingInfo ? (
            <div className="text-sm text-slate-700">
              Sequence <span className="font-mono">{numberingCode}</span> — pattern{" "}
              <span className="font-mono">{numberingInfo.pattern}</span>, current sequence:{" "}
              {numberingInfo.currentSequence}
            </div>
          ) : (
            <div className="text-sm text-slate-400">No sequence yet.</div>
          )}
          {canManage && (
            <button
              onClick={handleGenerateNumber}
              className="mt-2 rounded bg-slate-900 px-3 py-1 text-sm text-white"
            >
              Generate next number
            </button>
          )}
          {lastGeneratedNumber && (
            <div className="mt-2 text-sm">
              Last generated: <span className="font-mono font-medium">{lastGeneratedNumber}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
