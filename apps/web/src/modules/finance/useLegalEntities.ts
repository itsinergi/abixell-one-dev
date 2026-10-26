/**
 * Wave A6.2 — the legal-entity picker every Finance Advanced screen needs.
 *
 * Kernel records are per legal entity and several routes reject a call
 * without one, so each screen starts by choosing an entity. The list itself
 * is the same three lines everywhere; this hook keeps them in one place
 * instead of six.
 */
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export type LegalEntityOption = { id: string; name: string };

export function useLegalEntities(token: string) {
  const [entities, setEntities] = useState<LegalEntityOption[]>([]);
  const [legalEntityId, setLegalEntityId] = useState("");

  useEffect(() => {
    void (async () => {
      const list = await api.legalEntities(token).catch(() => [] as LegalEntityOption[]);
      setEntities(list);
      setLegalEntityId((current) => current || list[0]?.id || "");
    })();
  }, [token]);

  return { entities, legalEntityId, setLegalEntityId };
}

/** A fresh idempotency key for a mutation that requires one. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
