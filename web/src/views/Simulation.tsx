import { useEffect, useRef, useState } from "react";
import { NumberField, Segmented, Slider, fmt } from "../components/ui";
import { load, type Scenario } from "../data";
import { DEFAULT_SIMULATION, DEMO_WORKLOAD, POLICIES, POLICY_LABELS, simulationWorkload,
  type Policy, type SimulationComparison, type SimulationResult, type SimulationSettings } from "../lib/simulation";

const COLORS: Record<Policy, string> = { fixed: "var(--accent)", nearest: "#4e9bbf", adaptive: "#6baf78" };
const ACTIVITY_COLORS = { travel: "var(--accent)", service: "#6baf78", pause: "var(--critical)", coordination: "#4e9bbf" };
const minScore = (runs: SimulationResult[]) => Math.min(...runs.map((r) => r.score));
const winners = (runs: SimulationResult[]) => runs.filter((r) => r.score <= minScore(runs) + 0.005).map((r) => POLICY_LABELS[r.policy]).join(" / ");
const minute = (n: number) => `${fmt.dec(n)} min`;

export function Simulation() {
  const [settings, setSettings] = useState<SimulationSettings>(DEFAULT_SIMULATION);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioId, setScenarioId] = useState("experiment");
  const [sampleError, setSampleError] = useState(false);
  const [comparison, setComparison] = useState<SimulationComparison | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [environment, setEnvironment] = useState<"calm" | "changed">("changed");
  const [policy, setPolicy] = useState<Policy>("adaptive");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const worker = useRef<Worker | null>(null);
  const revision = useRef(0);
  const selected = scenarios.find((s) => s.id === scenarioId);
  const workload = selected ? simulationWorkload(selected) : DEMO_WORKLOAD;

  useEffect(() => {
    load<Scenario[]>("scenarios.json").then(setScenarios).catch(() => setSampleError(true));
    const current = new Worker(new URL("../lib/simulation.worker.ts", import.meta.url), { type: "module" });
    worker.current = current;
    current.onmessage = (event: MessageEvent<{ requestId: number; comparison?: SimulationComparison; error?: string }>) => {
      if (event.data.requestId !== revision.current) return;
      setBusy(false);
      if (event.data.comparison) {
        setComparison(event.data.comparison);
        const run = event.data.comparison.changed.find((r) => r.policy === "adaptive")!;
        setTime(Math.ceil(Math.max(...run.entries.map((e) => e.at), ...run.activity.map((a) => a.to), 1)));
      } else setError(event.data.error ?? "Simulation failed. Try again.");
    };
    current.onerror = () => { setBusy(false); setError("Simulation failed. Reload the page to retry."); };
    current.postMessage({ requestId: ++revision.current, workload: DEMO_WORKLOAD, settings: DEFAULT_SIMULATION });
    return () => current.terminate();
  }, []);

  const run = comparison?.[environment].find((r) => r.policy === policy);
  const end = run ? Math.ceil(Math.max(...run.entries.map((e) => e.at), ...run.activity.map((a) => a.to), 1)) : 1;
  const cursor = Math.min(time, end);
  useEffect(() => {
    if (!playing) return;
    const interval = window.setInterval(() => setTime((t) => Math.min(t + 1, end)), 100);
    return () => window.clearInterval(interval);
  }, [playing, end]);
  useEffect(() => { if (time >= end) setPlaying(false); }, [time, end]);

  function invalidate() {
    revision.current++; setComparison(null); setError(""); setBusy(false); setPlaying(false); setTime(0);
  }
  function update<K extends keyof SimulationSettings>(key: K, value: SimulationSettings[K]) {
    invalidate(); setSettings((s) => ({ ...s, [key]: value }));
  }
  function calculate() {
    setBusy(true); setError(""); setPlaying(false); setComparison(null);
    worker.current?.postMessage({ requestId: ++revision.current, workload, settings });
  }
  function resetExperiment() {
    invalidate(); setScenarioId("experiment"); setSettings(DEFAULT_SIMULATION);
    setBusy(true);
    worker.current?.postMessage({ requestId: ++revision.current, workload: DEMO_WORKLOAD, settings: DEFAULT_SIMULATION });
  }
  const reversal = comparison && comparison.calm[0].score <= minScore(comparison.calm) + 0.005 && comparison.changed[0].score > minScore(comparison.changed) + 0.005;
  const crossover = comparison?.sweep.find((row) => row.scores.fixed > Math.min(...Object.values(row.scores)) + 0.005);

  function exportResults() {
    if (!comparison) return;
    const blob = new Blob([JSON.stringify({ workload, settings, comparison }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "dispatch-simulation.json"; a.click(); URL.revokeObjectURL(url);
  }

  return <div className="page simulation"><div className="page-inner">
    <header className="simulation-heading">
      <div><p className="eyebrow">04 / Dispatch experiment</p><h1>When the plan meets disruption</h1><p>Replay delivery events and compare three dispatch policies under the same changing conditions.</p></div>
      <button className="secondary" onClick={resetExperiment}>Restore proof scenario</button>
    </header>
    <div className="simulation-config">
      <section className="card">
        <h2>Workload & fleet</h2>
        <div className="field"><label htmlFor="sim-workload">Delivery workload</label><select id="sim-workload" value={scenarioId} onChange={(e) => {
          invalidate(); setScenarioId(e.target.value); setSettings((s) => ({ ...s, delayJob: "job-0" }));
        }}><option value="experiment">Reproducible disruption experiment · 9 orders</option>{scenarios.map((s) => <option value={s.id} key={s.id}>{s.name} · first {Math.min(s.points.length, 24)} orders</option>)}</select></div>
        {sampleError && <p className="small">Other workloads are unavailable. The built-in experiment is ready to use.</p>}
        <div className="grid-2">
          <NumberField label="Available vans" value={settings.vehicles} min={1} onChange={(v) => { const vehicles = Math.min(8, Math.floor(v)); invalidate(); setSettings((s) => ({ ...s, vehicles, outageVehicle: Math.min(s.outageVehicle, vehicles - 1) })); }} />
          <NumberField label="Boxes per van" value={settings.capacity} min={1} onChange={(v) => update("capacity", Math.floor(v))} />
          <NumberField label="Shift (minutes)" value={settings.shiftMinutes} min={30} onChange={(v) => update("shiftMinutes", Math.min(720, v))} />
          <NumberField label="Service per stop (min)" value={settings.serviceMinutes} min={0} onChange={(v) => update("serviceMinutes", Math.min(120, v))} />
        </div>
        <Slider label="Average speed" value={settings.speedKmh} min={8} max={45} step={1} format={(v) => `${v} km/h`} onChange={(v) => update("speedKmh", v)} />
        <p className="small">Synthetic delivery demand and deadlines. Minutes are measured from dispatch. New orders can only be loaded at the depot.</p>
      </section>
      <section className="card">
        <h2>Environment changes</h2>
        <Slider label="Traffic & service event time" value={settings.eventAt} min={0} max={180} step={1} format={minute} onChange={(v) => update("eventAt", v)} />
        <Slider label="East-side travel time" value={settings.trafficFactor} min={1} max={4} step={0.25} format={(v) => `×${v.toFixed(2)}`} onChange={(v) => update("trafficFactor", v)} />
        <div className="field"><label htmlFor="sim-delay-job">Delayed delivery</label><select id="sim-delay-job" value={settings.delayJob} onChange={(e) => update("delayJob", e.target.value)}>{workload.jobs.map((j) => <option value={j.id} key={j.id}>{j.name}</option>)}</select></div>
        <Slider label="Extra service delay" value={settings.delayMinutes} min={0} max={90} step={1} format={minute} onChange={(v) => update("delayMinutes", v)} />
        <p className="small">Traffic affects future departures whose leg midpoint is east of the depot. An ongoing leg keeps its departure estimate.</p>
      </section>
      <section className="card">
        <h2>Vehicle unavailability</h2>
        <div className="field"><label htmlFor="sim-outage-van">Affected vehicle</label><select id="sim-outage-van" value={settings.outageVehicle} onChange={(e) => update("outageVehicle", Number(e.target.value))}>{Array.from({ length: settings.vehicles }, (_, i) => <option key={i} value={i}>Van {i + 1}</option>)}</select></div>
        <Slider label="Outage starts" value={settings.outageAt} min={0} max={180} step={1} format={minute} onChange={(v) => update("outageAt", v)} />
        <Slider label="Unavailable for" value={settings.outageMinutes} min={0} max={180} step={1} format={minute} onChange={(v) => update("outageMinutes", v)} />
        <p className="small">The van pauses and resumes its current work after recovery. Parcels stay on that van. Completed deliveries and the current leg are preserved.</p>
        <p className="small">Partial reoptimization may reorder only the unvisited suffix at the next completed stop. Each change takes {settings.replanMinutes} coordination minutes.</p>
      </section>
    </div>
    <details className="card"><summary>Costs & policy rules</summary>
      <div className="simulation-costs">
        <NumberField label="Cost / km (R$)" value={settings.costPerKm} min={0} onChange={(v) => update("costPerKm", v)} />
        <NumberField label="Driver / hour (R$)" value={settings.costPerHour} min={0} onChange={(v) => update("costPerHour", v)} />
        <NumberField label="Late / minute (R$)" value={settings.lateCostPerMinute} min={0} onChange={(v) => update("lateCostPerMinute", v)} />
        <NumberField label="Unserved / order (R$)" value={settings.unservedCost} min={0} onChange={(v) => update("unservedCost", v)} />
        <NumberField label="Replan overhead (min)" value={settings.replanMinutes} min={0} onChange={(v) => update("replanMinutes", Math.min(30, v))} />
      </div>
      <p className="small">Score = distance cost + paid duty time + summed late minutes × late penalty + unserved orders × failure penalty. These are editable assumptions, not observed costs. Lower is better.</p>
      <ul className="simulation-rules">
        <li><b>Keep optimized plan:</b> minimize initial driving time; keep loaded delivery order. Later orders are loaded by release order on return to the depot.</li>
        <li><b>Nearest-neighbor:</b> initial nearest-neighbor tours; keep loaded order. Later orders are loaded nearest-first at the depot.</li>
        <li><b>Partial reoptimization:</b> same initial optimized tours; after a disruption, reorder affected unvisited stops if forecast cost improves after coordination overhead. Later orders are loaded by deadline. Local search does not guarantee a global optimum.</li>
      </ul>
      <p className="small">Fixed fleet and capacity; no parcel transfer or extra vans. All policies see only released orders and events that have occurred. New departures must allow service and a depot return within the shift; a disruption in flight can cause overtime. Duty includes service, pauses and depot waiting between tours. Distances are straight lines × {settings.circuity}; deadlines are soft penalties.</p>
    </details>
    <div className="row"><button className="primary" disabled={busy} onClick={calculate}>{busy ? "Running experiment…" : "Compare strategies"}</button>{comparison && <button className="secondary" onClick={exportResults}>Export experiment JSON</button>}<span className="small">Identical jobs, fleet, prices and event schedule · deterministic replay</span></div>
    {error && <p className="error" role="alert">{error}</p>}
    {!comparison && !busy && !error && <p role="status">Settings changed. Compare strategies to update the experiment.</p>}
    {comparison && <>
      <section className="callout" aria-live="polite">
        <h3>{reversal ? "The initially efficient plan is no longer the best" : "Results for these conditions"}</h3>
        <p>Calm conditions: <b>{winners(comparison.calm)}</b> at {fmt.brl(minScore(comparison.calm))}. With disruptions: <b>{winners(comparison.changed)}</b> at {fmt.brl(minScore(comparison.changed))}.</p>
        <p className="small">{reversal ? "The fixed optimized plan wins or ties before disruption, then loses under the same cost formula." : "A ranking reversal is not guaranteed for every workload or event setting."}{crossover && ` First sampled intensity where the fixed plan loses: ×${crossover.severity}. The exact crossover can lie between samples.`}</p>
      </section>
      <section className="card">
        <h2>Strategy comparison / complete runs</h2>
        <div className="simulation-table"><table><thead><tr><th scope="col">Strategy</th><th scope="col" className="num">Calm score</th><th scope="col" className="num">Changed score</th><th scope="col" className="num">Delivered</th><th scope="col" className="num">Late</th><th scope="col" className="num">Late min</th><th scope="col" className="num">Unserved</th><th scope="col" className="num">km</th><th scope="col" className="num">Replans</th></tr></thead><tbody>{comparison.changed.map((r, i) => <tr key={r.policy}>
          <th scope="row"><span className="simulation-dot" style={{ background: COLORS[r.policy] }} />{POLICY_LABELS[r.policy]}{r.score <= minScore(comparison.changed) + 0.005 && <small> · best changed score</small>}</th>
          <td className="num">{fmt.dec(comparison.calm[i].score, 2)}</td><td className="num">{fmt.dec(r.score, 2)}</td><td className="num">{r.delivered}/{workload.jobs.length}</td><td className="num">{r.late}</td><td className="num">{fmt.dec(r.latenessMinutes)}</td><td className="num">{r.unserved}</td><td className="num">{fmt.dec(r.km)}</td><td className="num">{r.replans}</td>
        </tr>)}</tbody></table></div>
        <p className="small">Scores in R$. Late minutes are summed across delivered orders. Undelivered orders incur a separate penalty.</p>
      </section>
      <Sensitivity comparison={comparison} />
      {run && <section className="card">
        <div className="section-bar"><h2>Replay / {minute(cursor)} after dispatch</h2><span>{run.deliveries.filter((d) => d.at <= cursor).length}/{workload.jobs.length} delivered so far</span></div>
        <div className="row">
          <Segmented label="Replay environment" options={[{ value: "calm", label: "Calm" }, { value: "changed", label: "With disruptions" }]} value={environment} onChange={(v) => { setPlaying(false); setEnvironment(v); setTime(0); }} />
          <div className="field"><label htmlFor="sim-policy">Replay policy</label><select id="sim-policy" value={policy} onChange={(e) => { setPlaying(false); setPolicy(e.target.value as Policy); setTime(0); }}>{POLICIES.map((p) => <option value={p} key={p}>{POLICY_LABELS[p]}</option>)}</select></div>
        </div>
        <div className="row simulation-playback"><button className="secondary" onClick={() => { if (cursor >= end) setTime(0); setPlaying(!playing); }}>{playing ? "Pause" : "Play replay"}</button><button className="secondary" onClick={() => { setPlaying(false); setTime(0); }}>Restart</button><button className="secondary" onClick={() => { setPlaying(false); setTime(Math.min(end, run.entries.find((e) => e.at > cursor + 0.0001)?.at ?? end)); }}>Next event</button><button className="secondary" onClick={() => { setPlaying(false); setTime(end); }}>Show full run</button></div>
        <Slider label="Simulation clock" value={cursor} min={0} max={end} step={0.1} format={minute} onChange={(v) => { setPlaying(false); setTime(v); }} />
        <div className="simulation-visual" tabIndex={0} role="region" aria-label="Vehicle activity chart"><svg className="simulation-timeline" viewBox={`0 0 860 ${settings.vehicles * 38 + 35}`} role="img" aria-label={`Vehicle activity through minute ${cursor.toFixed(1)}; travel, service, outage pauses and coordination`}>
          {Array.from({ length: settings.vehicles }, (_, i) => <g key={i}><text x="0" y={i * 38 + 22}>Van {i + 1}</text><line x1="65" x2="850" y1={i * 38 + 15} y2={i * 38 + 15} stroke="var(--border)" /></g>)}
          {run.activity.filter((a) => a.from < cursor).map((a, i) => <rect key={i} x={65 + a.from / end * 785} y={a.vehicle * 38 + 7} width={Math.max(0.5, (Math.min(cursor, a.to) - a.from) / end * 785)} height="18" fill={ACTIVITY_COLORS[a.kind]}><title>Van {a.vehicle + 1}: {a.kind} · {minute(a.from)}–{minute(a.to)}</title></rect>)}
          <line x1={65 + cursor / end * 785} x2={65 + cursor / end * 785} y1="0" y2={settings.vehicles * 38} stroke="var(--text-primary)" strokeDasharray="3 3" />
          <text x="65" y={settings.vehicles * 38 + 18}>0 min</text><text x="850" y={settings.vehicles * 38 + 18} textAnchor="end">{end} min</text>
        </svg></div>
        <div className="row small">{Object.entries(ACTIVITY_COLORS).map(([label, color]) => <span key={label}><span className="simulation-dot" style={{ background: color }} />{label}</span>)}</div>
        <p className="small">Complete run: {minute(run.dutyMinutes)} paid van time · {minute(run.overtimeMinutes)} overtime · operating cost {fmt.brl(run.operatingCost)} + penalties {fmt.brl(run.penaltyCost)}.</p>
        <div className="simulation-event-log" tabIndex={0} aria-label="Events up to the replay clock"><table><thead><tr><th scope="col">Minute</th><th scope="col">Vehicle</th><th scope="col">Event</th><th scope="col">What happened</th></tr></thead><tbody>{run.entries.filter((e) => e.at <= cursor + 0.0001).map((e, i) => <tr key={i}><td>{fmt.dec(e.at)}</td><td>{e.vehicle === undefined ? "—" : e.vehicle + 1}</td><td>{e.type}</td><td>{e.detail}{e.before && <div className="small">{e.before.map((id) => workload.jobs.find((j) => j.id === id)?.name).join(" → ")}<br />After: {e.after?.map((id) => workload.jobs.find((j) => j.id === id)?.name).join(" → ")}</div>}</td></tr>)}</tbody></table></div>
        <details className="simulation-manifest"><summary>Initial loaded routes & delivery outcomes</summary>{run.initialRoutes.map((route, i) => <p className="small" key={i}>Van {i + 1}: {route.map((id) => workload.jobs.find((j) => j.id === id)?.name).join(" → ") || "Idle at depot"}</p>)}
          <div className="simulation-table"><table><thead><tr><th scope="col">Order</th><th scope="col" className="num">Boxes</th><th scope="col" className="num">Release min</th><th scope="col" className="num">Deadline min</th><th scope="col" className="num">Completed min</th></tr></thead><tbody>{workload.jobs.map((j) => { const delivery = run.deliveries.find((d) => d.job === j.id && d.at <= cursor); return <tr key={j.id}><th scope="row">{j.name}</th><td className="num">{j.demand}</td><td className="num">{j.releaseAt}</td><td className="num">{j.dueAt}</td><td className="num">{delivery ? fmt.dec(delivery.at) : cursor >= end ? "Unserved" : "Pending"}</td></tr>; })}</tbody></table></div>
        </details>
      </section>}
    </>}
  </div></div>;
}

function Sensitivity({ comparison }: { comparison: SimulationComparison }) {
  const rows = comparison.sweep;
  const max = Math.max(1, ...rows.flatMap((r) => Object.values(r.scores)));
  const x = (severity: number) => 70 + severity / 2 * 735;
  const y = (score: number) => 225 - score / max * 195;
  return <section className="card"><h2>When does the ranking change?</h2><p className="small">Intensity scales the added traffic slowdown, service delay and outage duration together. Orders, deadlines, event start times and cost weights stay fixed. ×0 is calm; ×1 is the configured experiment.</p>
    <div className="simulation-visual" tabIndex={0} role="region" aria-label="Strategy cost chart"><svg viewBox="0 0 860 275" className="simulation-chart" role="img" aria-label="Strategy cost versus disruption intensity, from zero to twice the configured conditions">
      {[0, 0.5, 1].map((p) => <g key={p}><line x1="70" x2="805" y1={y(p * max)} y2={y(p * max)} stroke="var(--border)" /><text x="60" y={y(p * max) + 4} textAnchor="end">{fmt.int(p * max)}</text></g>)}
      {rows.map((r) => <text key={r.severity} x={x(r.severity)} y="250" textAnchor="middle">×{r.severity}</text>)}
      <text x="70" y="16">Score (R$) · lower is better</text>
      {POLICIES.map((p, i) => <g key={p}><polyline fill="none" stroke={COLORS[p]} strokeWidth="2.5" strokeDasharray={i === 2 ? "5 4" : undefined} points={rows.map((r) => `${x(r.severity)},${y(r.scores[p])}`).join(" ")} />{rows.map((r) => <circle key={r.severity} cx={x(r.severity)} cy={y(r.scores[p])} r="3" fill={COLORS[p]}><title>{POLICY_LABELS[p]} · intensity ×{r.severity} · R$ {fmt.dec(r.scores[p], 2)}</title></circle>)}</g>)}
    </svg></div>
    <div className="row small">{POLICIES.map((p) => <span key={p}><span className="simulation-dot" style={{ background: COLORS[p] }} />{POLICY_LABELS[p]}</span>)}</div>
    <details><summary>Show sampled scores</summary><div className="simulation-table"><table><thead><tr><th scope="col">Intensity</th>{POLICIES.map((p) => <th scope="col" className="num" key={p}>{POLICY_LABELS[p]}</th>)}</tr></thead><tbody>{rows.map((r) => <tr key={r.severity}><th scope="row">×{r.severity}</th>{POLICIES.map((p) => <td className="num" key={p}>{fmt.dec(r.scores[p], 2)}</td>)}</tr>)}</tbody></table></div></details>
  </section>;
}
