import { useEffect, useState } from "react";
import { DataState, MunicipalityBreakdown, fmt } from "../components/ui";
import { load, type Meta, type Scenario } from "../data";
import { deleteDraft, readDraft } from "../lib/draft";
import { WorkloadPlot } from "../components/WorkloadPlot";

export function Overview() {
  const [data, setData] = useState<{ meta: Meta; scenarios: Scenario[] } | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState(readDraft);
  const [draftError, setDraftError] = useState(false);
  useEffect(() => {
    Promise.all([load<Meta>("meta.json"), load<Scenario[]>("scenarios.json")])
      .then(([meta, scenarios]) => { if (!scenarios.length) throw new Error("No workloads"); setData({ meta, scenarios }); })
      .catch(() => setError(true));
  }, []);
  if (error || !data) return <DataState error={error} />;
  const { meta, scenarios } = data;
  const scenario = scenarios[selected];
  const demand = scenario.points.reduce((sum, p) => sum + p.demand, 0);

  return <div className="page operations">
    <div className="desk">
      <header className="desk-heading">
        <div><p className="eyebrow">São Paulo / ABCD · Operations desk</p><h1>Workloads & coverage</h1></div>
        <div className="dataset-stamp"><span className="status-square" /> Dataset snapshot<strong>{new Date(meta.generatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</strong></div>
      </header>
      <div className="network-strip" aria-label="Network summary">
        <div><span>Network stops</span><strong>{fmt.int(meta.kpis.stops)}</strong></div>
        <div><span>Bus routes</span><strong>{fmt.int(meta.kpis.busRoutes)}</strong></div>
        <div><span>Low-access SP cells</span><strong>{fmt.pct(meta.kpis.spLowShare)}</strong></div>
        <div><span>Low-access SP border cells</span><strong>{fmt.pct(meta.kpis.borderLowShare)}<small> / {meta.kpis.borderCells} cells</small></strong></div>
        <a href="#insights">Network map <span aria-hidden="true">↗</span></a>
      </div>
      {meta.population && <p className="small data-note">Censo {meta.population.year}: {fmt.int(meta.population.totalResidents)} residents across São Paulo and Grande ABC · <a href="#model">Population by municipality ↗</a></p>}
      <section className="dispatch-board" aria-labelledby="workloads-heading">
        <div className="workload-list">
          <div className="section-bar"><h2 id="workloads-heading">Delivery workloads</h2><span>Sample data</span></div>
          <div className="workload-options" role="group" aria-label="Select workload">
            {scenarios.map((s, i) => <button key={s.id} aria-pressed={selected === i} onClick={() => setSelected(i)}>
              <span className="workload-code">0{i + 1}</span><span><strong>{s.name}</strong><small>{s.points.length} stops · {fmt.int(s.points.reduce((sum, p) => sum + p.demand, 0))} boxes</small></span><span className="workload-arrow" aria-hidden="true">↗</span>
            </button>)}
          </div>
          <div className="workload-actions"><a className="primary" href={`#optimizer?scenario=${scenario.id}`}>Plan selected workload <span aria-hidden="true">→</span></a><a className="text-link" href="#optimizer?empty=1">New plan / import CSV →</a></div>
          <p className="small data-note">Public locations · synthetic delivery demand</p>
        </div>
        <div className="workload-preview">
          <div className="preview-coordinates">{Math.abs(scenario.depot.lat).toFixed(4)} S / {Math.abs(scenario.depot.lon).toFixed(4)} W <span>DEPOT</span></div>
          <WorkloadPlot scenario={scenario} />
          <MunicipalityBreakdown points={scenario.points} />
          {scenario.depotMunicipality && <p className="small">Depot: {scenario.depotMunicipality}</p>}
          <div className="preview-facts"><div><strong>{scenario.points.length}</strong><span>delivery stops</span></div><div><strong>{demand}</strong><span>boxes to assign</span></div><div><strong>{Math.ceil(demand / 30)}<small> min.</small></strong><span>vans at 30 boxes*</span></div></div>
          <p className="small">*Capacity lower bound. Shift constraints may require more vans.</p>
        </div>
      </section>
      <div className="desk-lower">
        <section className="coverage-queue">
          <div className="section-bar"><h2>São Paulo side / Grande ABC border</h2><a href="#insights?border=1" className="text-link">Inspect on map ↗</a></div>
          <table><thead><tr><th>Nearest stop</th><th className="num">Buses/h</th><th className="num">Distance</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>
            {meta.abcBorderGaps.slice(0, 4).map((g) => <tr key={g.cell}><td><a href={`#insights?cell=${g.cell}&border=1`}>{g.nearestStop}</a></td><td className="num">{fmt.dec(g.busesPeak)}</td><td className="num">{fmt.int(g.nearestStopM)} m</td><td aria-hidden="true">↗</td></tr>)}
          </tbody></table>
          <p className="small data-note">07:00–08:00 weekday schedule · straight-line distance · population not measured</p>
        </section>
        <section className="device-draft">
          <div className="section-bar"><h2>Saved work</h2><span>This device</span></div>
          {draft ? <><h3>{draft.scenarioId === "custom" ? "Custom delivery plan" : scenarios.find((s) => s.id === draft.scenarioId)?.name ?? "Delivery plan"}</h3><p>{draft.points.length} stops · {draft.params.capacity} boxes/van · {draft.params.shiftHours}h shift</p><p className="small">Saved {new Date(draft.savedAt).toLocaleString("en-GB")}</p><div className="row"><a className="secondary" href="#optimizer?draft=1">Resume draft →</a><button className="text-button" onClick={() => { if (deleteDraft()) setDraft(null); else setDraftError(true); }}>Delete</button></div></> : <><h3>No saved draft</h3><p>Save stops and fleet settings from the planner to continue here later.</p><a className="text-link" href="#optimizer?empty=1">Create a plan →</a></>}
          {draftError && <p className="error" role="alert">The draft could not be deleted.</p>}
          <div className="data-availability"><span className={`status-square ${meta.speedModel.status === "trained" ? "ready" : "waiting"}`} /><div><strong>GPS speed model</strong><span>{meta.speedModel.status === "trained" ? "Available · experimental bus-speed proxy" : "No trained model · use average speed"}</span></div><a href="#model" aria-label="GPS speed model details">↗</a></div>
        </section>
      </div>
      <section className="card"><h2>Dispatch under disruption</h2><p>Explore delivery delays, traffic changes and vehicle outages. See when an initially efficient route loses to another dispatch policy.</p><a className="text-link" href="#simulation">Open dispatch simulation ↗</a></section>
      <footer className="desk-footer"><span>SP Transit Logistics / Arthur Gaspar</span><span>SPTrans · IBGE · OpenStreetMap <a href="#model">Data & methods ↗</a></span></footer>
    </div>
  </div>;
}
