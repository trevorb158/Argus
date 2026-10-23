import { useEffect, useState } from "react";

export type ThemeMode = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "kestrel.theme";

export function readStoredThemeMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "auto") {
      return value;
    }
    return "auto";
  } catch {
    return "auto";
  }
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "light" || mode === "dark") {
    return mode;
  }
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
  ) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "dark";
}

function applyTheme(theme: ResolvedTheme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readStoredThemeMode);

  useEffect(() => {
    applyTheme(resolveTheme(mode));
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Theme still works for this session if local storage is unavailable.
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "auto") return;
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme(query.matches ? "dark" : "light");
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, [mode]);

  return { mode, setMode };
}
