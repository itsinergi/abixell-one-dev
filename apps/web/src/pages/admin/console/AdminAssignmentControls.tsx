/**
 * Epic 4 Wave 2 §4.4 step 15 — the governed assignment picker and pair editor.
 *
 * Every choice comes from GET /admin/assignment-options, already narrowed
 * server-side by the actor's delegation ceiling (§4.4 H) and closed-descendant
 * subtree (§4.4 E). The browser adds no scope of its own: tenant scope appears
 * only when the server says the actor may grant it, an ancestor unit renders
 * as disabled context rather than a choice, and customer scope is never
 * offered at all (§4.4 "Di luar cakupan": the Service Operation session has
 * not closed, so the governed surface refuses customer pairs).
 */
import { useCallback, useEffect, useRef, useState } from "react";

const rowIdCounter = { current: 0 };
import { useAuth } from "../../../auth/AuthContext";
import {
  api,
  ApiError,
  type AdminAssignmentOptions,
  type AdminRoleAssignmentInput,
} from "../../../lib/api";
import { Alert, Button, Field, Select } from "../../../shell/components/ui";

/* ------------------------------------------------------- options resource */

export type AssignmentOptionsStatus =
  | "idle"
  | "loading"
  | "ready"
  | "denied"
  | "session-expired"
  | "error";

export interface AssignmentOptionsState {
  status: AssignmentOptionsStatus;
  options: AdminAssignmentOptions | null;
  error: string | null;
  reload: () => void;
}

export function useAssignmentOptions(enabled: boolean): AssignmentOptionsState {
  const { session } = useAuth();
  const token = session!.accessToken;
  const [status, setStatus] = useState<AssignmentOptionsStatus>(
    enabled ? "loading" : "idle",
  );
  const [options, setOptions] = useState<AdminAssignmentOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const run = useCallback(async () => {
    if (!enabled) return;
    const requestGeneration = ++generation.current;
    setStatus("loading");
    setError(null);
    try {
      const result = await api.adminAssignmentOptions(token);
      if (requestGeneration !== generation.current) return;
      setOptions(result);
      setStatus("ready");
    } catch (err) {
      if (requestGeneration !== generation.current) return;
      setOptions(null);
      if (err instanceof ApiError && err.status === 403) {
        setStatus("denied");
      } else if (err instanceof ApiError && err.status === 401) {
        setStatus("session-expired");
      } else {
        setError(
          err instanceof ApiError ? err.message : "Failed to load assignment options",
        );
        setStatus("error");
      }
    }
  }, [enabled, token]);

  useEffect(() => {
    void run();
    return () => {
      generation.current += 1;
    };
  }, [run]);

  return { status, options, error, reload: run };
}

/* ----------------------------------------------------------- pair helpers */

/** Structural shape shared by an input pair and a previewed pair summary, so
 *  one key function serves the editor and the review list. */
export interface AssignmentPairIdentity {
  roleCode: string;
  scopeType: string;
  scopeLegalEntityId?: string | null;
  scopeOrganizationUnitId?: string | null;
  scopeCustomerId?: string | null;
}

/** Stable identity of a pair, mirroring the server's duplicate rejection. */
export function assignmentPairKey(pair: AssignmentPairIdentity): string {
  if (pair.scopeType === "tenant") return `${pair.roleCode}::tenant`;
  if (pair.scopeType === "legal_entity") {
    return `${pair.roleCode}::le:${pair.scopeLegalEntityId ?? ""}`;
  }
  if (pair.scopeType === "organization_unit") {
    return `${pair.roleCode}::ou:${pair.scopeOrganizationUnitId ?? ""}`;
  }
  return `${pair.roleCode}::customer:${pair.scopeCustomerId ?? ""}`;
}

export function assignmentPairsHaveDuplicate(
  pairs: AdminRoleAssignmentInput[],
): boolean {
  const seen = new Set<string>();
  for (const pair of pairs) {
    const key = assignmentPairKey(pair);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function scopeKeyOf(pair: AdminRoleAssignmentInput): string {
  if (pair.scopeType === "tenant") return "tenant";
  if (pair.scopeType === "legal_entity") {
    return `le:${pair.scopeLegalEntityId}`;
  }
  if (pair.scopeType === "organization_unit") {
    return `ou:${pair.scopeOrganizationUnitId}`;
  }
  return `customer:${pair.scopeCustomerId}`;
}

function pairFromSelection(
  roleCode: string,
  scopeKey: string,
  options: AdminAssignmentOptions,
): AdminRoleAssignmentInput | null {
  if (scopeKey === "tenant") {
    return options.canAssignTenantScope
      ? { roleCode, scopeType: "tenant" }
      : null;
  }
  if (scopeKey.startsWith("ou:")) {
    const unit = options.organizationUnits.find(
      (candidate) => `ou:${candidate.id}` === scopeKey,
    );
    if (!unit || !unit.selectable) return null;
    return {
      roleCode,
      scopeType: "organization_unit",
      scopeOrganizationUnitId: unit.id,
    };
  }
  // Neither Customer scope nor Legal Entity scope is offered by this picker
  // yet. Customer scope waits for the Service Operation session (Epic 5 G3
  // keeps it out); the Legal Entity option list is served by the API
  // (`AssignmentOptions.legalEntities`) and gets its control in the Epic 5 G3
  // UI card. Until that control exists, nothing can select either key, so the
  // editor offers none of them rather than inventing a choice the API would
  // have to second-guess.
  return null;
}

/* ------------------------------------------------------------ pair editor */

/**
 * Edits an ordered list of role + scope pairs. Rows only offer choices the
 * server marked selectable; disabled options stay visible as context (an
 * ancestor unit, a role beyond the delegation ceiling) so the operator sees
 * the boundary of their authority instead of a silently shortened list.
 */
export function AssignmentPairEditor({
  options,
  pairs,
  onChange,
  addLabel = "Add assignment",
}: {
  options: AdminAssignmentOptions;
  pairs: AdminRoleAssignmentInput[];
  onChange: (pairs: AdminRoleAssignmentInput[]) => void;
  addLabel?: string;
}) {
  const selectableRoles = options.roles.filter((role) => role.selectable);
  const hasSelectableScope =
    options.canAssignTenantScope ||
    options.organizationUnits.some((unit) => unit.selectable);
  // Stable per-row identity: a pair's content can repeat transiently while the
  // operator edits, and index keys would rebind focus and open select state to
  // a different row after a middle row is removed. Rows are added and removed
  // only in handlers; an external reset of `pairs` is reconciled after commit,
  // so render never mutates ref state.
  const [rowIds, setRowIds] = useState<number[]>(() =>
    pairs.map(() => ++rowIdCounter.current),
  );
  useEffect(() => {
    setRowIds((ids) => {
      if (ids.length === pairs.length) return ids;
      return pairs.map((_, i) => ids[i] ?? ++rowIdCounter.current);
    });
  }, [pairs, pairs.length]); // Content edits keep existing ids; length changes reconcile rows.

  const duplicateKeys = new Set<string>();
  const seen = new Set<string>();
  for (const pair of pairs) {
    const key = assignmentPairKey(pair);
    if (seen.has(key)) duplicateKeys.add(key);
    seen.add(key);
  }

  function updatePair(index: number, next: AdminRoleAssignmentInput | null) {
    if (!next) return;
    onChange(pairs.map((pair, i) => (i === index ? next : pair)));
  }

  function addPair() {
    const role = selectableRoles[0];
    if (!role) return;
    const scopeKey = options.canAssignTenantScope
      ? "tenant"
      : `ou:${options.organizationUnits.find((unit) => unit.selectable)?.id ?? ""}`;
    const pair = pairFromSelection(role.code, scopeKey, options);
    if (!pair) return;
    setRowIds([...rowIds, ++rowIdCounter.current]);
    onChange([...pairs, pair]);
  }

  function removePair(index: number) {
    setRowIds(rowIds.filter((_, i) => i !== index));
    onChange(pairs.filter((_, i) => i !== index));
  }

  const nothingSelectable =
    selectableRoles.length === 0 || !hasSelectableScope;

  return (
    <div className="space-y-3">
      {nothingSelectable && (
        <Alert tone="warning">
          No role and scope combination is assignable with your current access.
          The list below shows the boundary of your delegation as context.
        </Alert>
      )}
      {pairs.length === 0 ? (
        <p className="text-sm text-ink-dim">No assignments selected yet.</p>
      ) : (
        <ul className="space-y-3">
          {pairs.map((pair, index) => (
            <li key={rowIds[index] ?? index} className="rounded border border-line bg-panel-2 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={`Role ${index + 1}`} required>
                  <Select
                    value={pair.roleCode}
                    onChange={(event) =>
                      updatePair(
                        index,
                        pairFromSelection(event.target.value, scopeKeyOf(pair), options) ??
                          (event.target.value === pair.roleCode ? pair : null),
                      )
                    }
                  >
                    {options.roles.map((role) => (
                      <option key={role.code} value={role.code} disabled={!role.selectable}>
                        {role.name} ({role.code})
                        {!role.selectable ? " — outside your delegation" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={`Scope ${index + 1}`} required>
                  <Select
                    value={scopeKeyOf(pair)}
                    onChange={(event) =>
                      updatePair(index, pairFromSelection(pair.roleCode, event.target.value, options))
                    }
                  >
                    <option value="tenant" disabled={!options.canAssignTenantScope}>
                      Tenant-wide{!options.canAssignTenantScope ? " — not permitted for your access" : ""}
                    </option>
                    {options.organizationUnits.map((unit) => (
                      <option
                        key={unit.id}
                        value={`ou:${unit.id}`}
                        disabled={!unit.selectable}
                      >
                        {`${"— ".repeat(unit.depth)}${unit.name}${unit.selectable ? "" : " — context"}`}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {duplicateKeys.has(assignmentPairKey(pair)) && (
                <p className="mt-1 text-xs text-status-warn">
                  This role and scope combination appears more than once in the batch.
                </p>
              )}
              <Button
                variant="ghost"
                className="mt-2"
                onClick={() => removePair(index)}
              >
                Remove pair
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button variant="secondary" disabled={nothingSelectable} onClick={addPair}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- error message */

/** Shared refusal wording for governed access mutations. */
export function errorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  if (err.status === 401) {
    return "Your session expired. Sign in again before changing access.";
  }
  if (err.status === 403) {
    return "Your current access does not allow this change.";
  }
  if (err.status === 400 || err.status === 409 || err.status === 422) {
    return `The server rejected this access context: ${err.message}`;
  }
  return err.message || fallback;
}
