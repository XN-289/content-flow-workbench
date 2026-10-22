import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Tone, ViewKey, WorkbenchState } from "../lib/types";

type ThemeMode = "auto" | "light" | "dark";
type Toast = { id: number; text: string; tone: Tone };

interface Store {
  state: WorkbenchState | null;
  error: string | null;
  loading: boolean;
  busy: string | null;
  refresh: () => Promise<void>;
  mutate: (key: string, fn: () => Promise<any>, successText?: string) => Promise<any>;
  view: ViewKey;
  setView: (view: ViewKey) => void;
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  activeTopicId: string | null;
  setActiveTopic: (id: string | null) => void;
  toasts: Toast[];
  notify: (text: string, tone?: Tone) => void;
  dismiss: (id: number) => void;
}

const StoreContext = createContext<Store | null>(null);

const VIEWS: ViewKey[] = ["overview", "flow", "workflow", "system"];
const VIEW_PATHS: Record<ViewKey, string> = {
  overview: "/",
  flow: "/flow",
  workflow: "/workflow",
  system: "/system"
};

function viewFromLocation(): ViewKey {
  const legacyHash = window.location.hash.replace("#", "");
  const fromHash = VIEWS.find((view) => view === legacyHash);
  if (fromHash) return fromHash;

  const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
  return VIEWS.find((view) => VIEW_PATHS[view] === normalizedPath) || "overview";
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WorkbenchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(1);

  const [theme, setThemeState] = useState<ThemeMode>(() => (localStorage.getItem("cfw.theme") as ThemeMode) || "auto");
  const [view, setViewState] = useState<ViewKey>(viewFromLocation);
  const [activeTopicId, setActiveTopicState] = useState<string | null>(() => localStorage.getItem("cfw.topic"));

  const notify = useCallback((text: string, tone: Tone = "neutral") => {
    const id = toastId.current++;
    setToasts((prev) => [...prev, { id, text, tone }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), tone === "danger" ? 8000 : 4000);
  }, []);

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((item) => item.id !== id)), []);

  const refresh = useCallback(async () => {
    try {
      const next = await api.state();
      setState(next);
      setError(null);
    } catch (err: any) {
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (key: string, fn: () => Promise<any>, successText?: string) => {
      setBusy(key);
      try {
        const result = await fn();
        await refresh();
        if (successText) notify(successText, "success");
        return result;
      } catch (err: any) {
        notify(err.message || "操作失败", "danger");
        throw err;
      } finally {
        setBusy(null);
      }
    },
    [refresh, notify]
  );

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    localStorage.setItem("cfw.theme", mode);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "auto" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.setAttribute("data-theme", resolved);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const setView = useCallback((next: ViewKey) => {
    setViewState(next);
    window.history.pushState({ view: next }, "", VIEW_PATHS[next]);
  }, []);

  useEffect(() => {
    const onLocationChange = () => {
      setViewState(viewFromLocation());
    };
    window.addEventListener("popstate", onLocationChange);
    window.addEventListener("hashchange", onLocationChange);
    return () => {
      window.removeEventListener("popstate", onLocationChange);
      window.removeEventListener("hashchange", onLocationChange);
    };
  }, []);

  const setActiveTopic = useCallback((id: string | null) => {
    setActiveTopicState(id);
    if (id) localStorage.setItem("cfw.topic", id);
    else localStorage.removeItem("cfw.topic");
  }, []);

  // 当前选题默认取第一个，保证工作区永远有稳定上下文
  useEffect(() => {
    if (!state?.topics?.length) return;
    if (!activeTopicId || !state.topics.some((topic: any) => topic.id === activeTopicId)) {
      setActiveTopic(state.topics[0].id);
    }
  }, [state, activeTopicId, setActiveTopic]);

  const value = useMemo<Store>(
    () => ({
      state,
      error,
      loading,
      busy,
      refresh,
      mutate,
      view,
      setView,
      theme,
      setTheme,
      activeTopicId,
      setActiveTopic,
      toasts,
      notify,
      dismiss
    }),
    [state, error, loading, busy, refresh, mutate, view, setView, theme, setTheme, activeTopicId, setActiveTopic, toasts, notify, dismiss]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("StoreProvider missing");
  return store;
}

export const NAV_ITEMS: { key: ViewKey; label: string }[] = [
  { key: "overview", label: "总览" },
  { key: "flow", label: "信息流" },
  { key: "workflow", label: "工作流" },
  { key: "system", label: "系统" }
];
