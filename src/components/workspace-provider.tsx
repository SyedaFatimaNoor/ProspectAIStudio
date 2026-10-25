"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { emptyWorkspace, type Workspace } from "@/lib/types";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
const Context = createContext<{
  data: Workspace;
  loading: boolean;
  refresh: () => Promise<void>;
  action: (type: string, payload: Record<string, unknown>) => Promise<unknown>;
  notify: (message: string, error?: boolean) => void;
}>({
  data: emptyWorkspace,
  loading: true,
  refresh: async () => {},
  action: async () => {},
  notify: () => {},
});
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
  }, []);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/workspace");
      const result = await res.json();
      setData(result);
      if (result.error) notify(result.error, true);
    } catch {
      notify("Unable to connect. Check your connection and try again.", true);
    } finally {
      setLoading(false);
    }
  }, [notify]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (
      !data.user ||
      (!data.jobs.some((j) => ["queued", "running"].includes(j.status)) &&
        !data.runs.some((r) => ["queued", "running"].includes(r.status)))
    )
      return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [data.user, data.jobs, data.runs, refresh]);
  async function action(type: string, payload: Record<string, unknown>) {
    try {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, ...payload }),
      });
      const result = await res.json();
      if (!res.ok)
        throw new Error(result.error || "The action could not be completed.");
      await refresh();
      return result;
    } catch (e) {
      notify(e instanceof Error ? e.message : "Something went wrong.", true);
      throw e;
    }
  }
  return (
    <Context.Provider value={{ data, loading, refresh, action, notify }}>
      {children}
      {toast && (
        <div
          role="status"
          className={`toast ${toast.error ? "toast-error" : ""}`}
        >
          {toast.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
export const useWorkspace = () => useContext(Context);
