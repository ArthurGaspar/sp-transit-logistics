import { useEffect, useState } from "react";
import { useTheme } from "./theme";
import { Insights } from "./views/Insights";
import { Model } from "./views/Model";
import { Optimizer } from "./views/Optimizer";

type Tab = "insights" | "optimizer" | "model";

const TABS: { id: Tab; label: string }[] = [
  { id: "insights", label: "Transit insights" },
  { id: "optimizer", label: "Route optimizer" },
  { id: "model", label: "Model & data" },
];

function tabFromHash(): Tab {
  const h = window.location.hash.slice(1);
  return TABS.some((t) => t.id === h) ? (h as Tab) : "insights";
}

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const { dark, choice, cycle } = useTheme();

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>SP Transit Logistics</h1>
          <span>São Paulo bus-network insights × delivery routing</span>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                window.location.hash = t.id;
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <button className="icon-btn" onClick={cycle} title="Theme: system → light → dark" aria-label={`Theme: ${choice}`}>
          {choice === "system" ? "◐ Auto" : choice === "light" ? "☀ Light" : "☾ Dark"}
        </button>
        <a className="icon-btn" href="https://github.com/ArthurGaspar/sp-transit-logistics" style={{ textDecoration: "none" }}>
          GitHub
        </a>
      </header>
      {tab === "insights" && <Insights dark={dark} />}
      {tab === "optimizer" && <Optimizer dark={dark} />}
      {tab === "model" && <Model />}
    </div>
  );
}
