/**
 * Checkpoint 1C.7 — network-state awareness. Reports the browser's online/
 * offline state so the shell can tell the user when the app cannot reach the
 * server. This is UX only: there is no offline mutation queue (guard 18) —
 * failed actions surface real errors, never a fake success (guard 19).
 */
import { useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
