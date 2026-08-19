/**
 * Checkpoint 1C.2 — resolves which Customer(s) the signed-in actor may act
 * within, from the backend-scoped `GET /customers` (Customer Data Scope,
 * ADR-0011). A Customer User sees only their own Customer(s); an internal
 * user in scope may see several and pick one. The frontend never widens
 * this set — it only renders what the authorized endpoint returned.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type Customer } from "../../lib/api";

export function useCustomerScope() {
  const { session } = useAuth();
  const token = session!.accessToken;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.customers(token);
      setCustomers(list);
      // Auto-select when the actor is scoped to exactly one Customer (the
      // common Customer-User case) so they never see a pointless picker.
      setSelectedId((current) => current || (list.length === 1 ? list[0].id : ""));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load your customers");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = customers.find((c) => c.id === selectedId) ?? null;
  return { token, customers, selected, selectedId, setSelectedId, loading, error, reload: load };
}
