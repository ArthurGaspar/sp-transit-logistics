import { lazy, Suspense, useEffect, useState } from "react";
import { useTheme } from "./theme";
import { Overview } from "./views/Overview";

const Insights = lazy(() => import("./views/Insights").then((m) => ({ default: m.Insights })));
const Optimizer = lazy(() => import("./views/Optimizer").then((m) => ({ default: m.Optimizer })));
const Model = lazy(() => import("./views/Model").then((m) => ({ default: m.Model })));
const Simulation = lazy(() => import("./views/Simulation").then((m) => ({ default: m.Simulation })));

type Tab = "overview" | "insights" | "optimizer" | "model" | "simulation";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Operations" },
  { id: "optimizer", label: "Route optimizer" },
  { id: "insights", label: "Transit atlas" },
  { id: "model", label: "Data & methods" },
  { id: "simulation", label: "Dispatch simulation" },
];

function tabFromHash(): Tab {
  const h = window.location.hash.slice(1).split("?")[0];
  return TABS.some((t) => t.id === h) ? (h as Tab) : "overview";
}

export function App() {
  const [location, setLocation] = useState(() => window.location.hash);
  const tab = tabFromHash();
  const { dark, choice, cycle } = useTheme();

  useEffect(() => {
    const onHash = () => setLocation(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#main-content" onClick={(e) => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
      <header className="topbar">
        <a className="brand" href="#overview" aria-label="SP Transit Logistics — operations desk">
          <span className="brand-mark" aria-hidden="true">sp<span>↗</span></span>
          <span className="brand-name">Transit Logistics<small>São Paulo / Grande ABC</small></span>
        </a>
        <nav className="tabs" aria-label="Project navigation">
          {TABS.map((t, i) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              aria-current={tab === t.id ? "page" : undefined}
            >
              <span className="nav-index">0{i}</span> {t.label}
            </a>
          ))}
        </nav>
        <button className="icon-btn" onClick={cycle} title="Theme: system → light → dark" aria-label={`Theme: ${choice}`}>
          {choice === "system" ? "◐ Auto" : choice === "light" ? "☀ Light" : "☾ Dark"}
        </button>
        <a className="icon-btn" href="https://github.com/ArthurGaspar/sp-transit-logistics" style={{ textDecoration: "none" }}>
          Source ↗
        </a>
      </header>
      <main id="main-content" className="workspace" key={location} tabIndex={-1}>
        <Suspense fallback={<div className="loading" role="status">Opening the workspace…</div>}>
          {tab === "overview" && <Overview />}
          {tab === "insights" && <Insights dark={dark} />}
          {tab === "optimizer" && <Optimizer dark={dark} />}
          {tab === "model" && <Model />}
          {tab === "simulation" && <Simulation />}
        </Suspense>
      </main>
    </div>
  );
}
