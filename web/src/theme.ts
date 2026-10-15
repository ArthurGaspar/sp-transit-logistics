import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "sptl-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // storage can be unavailable (private mode); fall back to the OS setting
  }
  return "system";
}

/** Returns whether the effective theme is dark, plus a toggle that cycles system → light → dark. */
export function useTheme(): { dark: boolean; choice: ThemeChoice; cycle: () => void } {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (choice === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", choice);
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // ignore
    }
  }, [choice]);

  const cycle = () => setChoice((c) => (c === "system" ? "light" : c === "light" ? "dark" : "system"));
  return { dark: choice === "dark" || (choice === "system" && systemDark), choice, cycle };
}
