import type { Map as MlMap, MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapView, setGeoJson } from "../components/MapView";
import { DataState, MunicipalityBreakdown, NumberField, Segmented, Slider, Tile, fmt } from "../components/ui";
import { load, type Cells, type Meta, type Scenario, type ScenarioPoint } from "../data";
import { routeStyle } from "../lib/colors";
import { parseDeliveryCsv } from "../lib/csv";
import type { SolveRequest, SolveResponse } from "../lib/solver.worker";

import { DEFAULT_PARAMS, readDraft, saveDraft, workspaceQuery, type PlanParams } from "../lib/draft";

type ClickMode = "none" | "add" | "depot";
const MAX_POINTS = 250;

export function Optimizer({ dark }: { dark: boolean }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [cells, setCells] = useState<Cells | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioId, setScenarioId] = useState("custom");
  const [depot, setDepot] = useState<{ lat: number; lon: number } | null>(null);
  const [points, setPoints] = useState<ScenarioPoint[]>([]);
  const [mode, setMode] = useState<ClickMode>("none");
  const [params, setParams] = useState<PlanParams>(DEFAULT_PARAMS);
  const [draftNotice, setDraftNotice] = useState("");
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null);
  const [result, setResult] = useState<SolveResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [dataError, setDataError] = useState(false);
  const [solverError, setSolverError] = useState(false);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [map, setMap] = useState<MlMap | null>(null);
  const worker = useRef<Worker | null>(null);
  const revision = useRef(0);

  useEffect(() => {
    Promise.all([load<Meta>("meta.json"), load<Scenario[]>("scenarios.json"), load<Cells>("cells.json")]).then(([m, s, c]) => {
      setMeta(m);
      setScenarios(s);
      setCells(c);
      if (!s.length) throw new Error("No delivery scenarios available");
      const query = workspaceQuery();
      const draft = query.has("draft") ? readDraft() : null;
      if (draft) {
        setScenarioId(s.some((item) => item.id === draft.scenarioId) ? draft.scenarioId : "custom");
        setDepot(draft.depot);
        setPoints(draft.points);
        setParams({ ...draft.params, speedMode: c.speedWeekday ? draft.params.speedMode : "constant" });
        setDraftNotice("Draft restored · recalculate to update results");
      } else if (query.has("empty")) {
        setScenarioId("custom");
        setDepot(s[0].depot);
        setPoints([]);
      } else {
        const requested = query.get("scenario");
        applyScenario(s.find((item) => item.id === (requested === "abc-border" ? "abcd" : requested)) ?? s[0]);
      }
    }).catch(() => setDataError(true));
    worker.current = new Worker(new URL("../lib/solver.worker.ts", import.meta.url), { type: "module" });
    worker.current.onmessage = (e: MessageEvent<SolveResponse>) => {
      if (e.data.requestId !== revision.current) return;
      setResult(e.data);
      setBusy(false);
    };
    worker.current.onerror = () => {
      setBusy(false);
      setSolverError(true);
    };
    return () => worker.current?.terminate();
  }, []);

  function invalidatePlan() {
    revision.current++;
    setResult(null);
    setBusy(false);
    setSolverError(false);
    setDraftNotice("");
    setSelectedRoute(null);
  }

  const set = <K extends keyof PlanParams>(k: K, v: PlanParams[K]) => {
    invalidatePlan();
    setParams((p) => ({ ...p, [k]: v }));
  };

  function applyScenario(s: Scenario) {
    setScenarioId(s.id);
    setDepot(s.depot);
    setPoints(s.points);
    invalidatePlan();
    setCsvErrors([]);
    if (map) framePoints(map, s.depot, s.points);
  }

  function changeStops(next: ScenarioPoint[]) {
    setPoints(next.slice(0, MAX_POINTS));
    setScenarioId("custom");
    invalidatePlan();
  }

  function run() {
    if (!depot || !points.length || !worker.current || !cells) return;
    setBusy(true);
    setSolverError(false);
    const req: SolveRequest = {
      requestId: ++revision.current,
      depot,
      stops: points,
      capacity: params.capacity,
      maxRouteMinutes: params.shiftHours * 60,
      serviceMinutes: params.serviceMinutes,
      circuity: params.circuity,
      constantKmh: params.constantKmh,
    };
    if (params.speedMode === "model" && cells.speedWeekday) {
      req.cellSpeeds = {
        res: cells.res,
        cells: cells.cell,
        kmh: cells.speedWeekday.map((row) => row[params.hour]),
        vehicleFactor: params.vehicleFactor,
      };
    }
    worker.current.postMessage(req);
  }

  async function onFile(file: File) {
    const { points: parsed, errors } = parseDeliveryCsv(await file.text());
    setCsvErrors(errors.slice(0, 5).concat(parsed.length > MAX_POINTS ? [`Only the first ${MAX_POINTS} points are used.`] : []));
    if (parsed.length) {
      changeStops(parsed);
      const lats = parsed.map((p) => p.lat);
      const lons = parsed.map((p) => p.lon);
      map?.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 60 });
    }
  }

  // Map clicks add stops or move the depot, depending on the mode.
  const clickState = useRef({ mode, points });
  clickState.current = { mode, points };
  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapMouseEvent) => {
      const { mode: m, points: pts } = clickState.current;
      const ll = { lat: +e.lngLat.lat.toFixed(5), lon: +e.lngLat.lng.toFixed(5) };
      if (m === "add") changeStops([...pts, { ...ll, demand: 1, name: `Drop ${pts.length + 1}` }]);
      if (m === "depot") {
        setDepot(ll);
        invalidatePlan();
        setMode("none");
      }
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map]);

  useEffect(() => {
    if (map) map.getCanvas().style.cursor = mode === "none" ? "" : "crosshair";
  }, [map, mode]);

  // Frame the first scenario once; later theme rebuilds keep the user's camera.
  const framed = useRef(false);
  useEffect(() => {
    if (map && depot && !framed.current) {
      framed.current = true;
      framePoints(map, depot, points);
    }
  }, [map, depot, points]);

  const assignment = useMemo(() => {
    const a = new Map<number, number>();
    result?.best.routes.forEach((r, ri) => r.stops.forEach((s) => a.set(s, ri)));
    return a;
  }, [result]);

  // Draw stops, depot and routes.
  useEffect(() => {
    if (!map || !depot) return;
    const neutral = dark ? "#c3c2b7" : "#52514e";
    setGeoJson(map, "stops", {
      type: "FeatureCollection",
      features: points.map((p, i) => ({
        type: "Feature",
        properties: {
          color: assignment.has(i) ? routeStyle(assignment.get(i)!, dark).color : neutral,
          unassigned: result ? !assignment.has(i) : false,
        },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      })),
    });
    setGeoJson(map, "depot", {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [depot.lon, depot.lat] } }],
    });
    setGeoJson(map, "plan", {
      type: "FeatureCollection",
      features: (result?.best.routes ?? []).map((r, ri) => ({
        type: "Feature",
        properties: { ...routeStyle(ri, dark), routeIndex: ri },
        geometry: {
          type: "LineString",
          coordinates: [depot, ...r.stops.map((s) => points[s]), depot].map((p) => [p.lon, p.lat]),
        },
      })),
    });
    if (!map.getLayer("plan-solid")) {
      const surface = dark ? "#1a1a19" : "#fcfcfb";
      map.addLayer({
        id: "plan-solid", type: "line", source: "plan", filter: ["!", ["get", "dashed"]],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "plan-dashed", type: "line", source: "plan", filter: ["get", "dashed"],
        layout: { "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-dasharray": [2, 1.5] },
      });
      map.addLayer({
        id: "stops", type: "circle", source: "stops",
        paint: {
          "circle-radius": 5,
          "circle-color": ["get", "color"],
          "circle-stroke-color": ["case", ["get", "unassigned"], "#d03b3b", surface],
          "circle-stroke-width": ["case", ["get", "unassigned"], 3, 2],
        },
      });
      map.addLayer({
        id: "depot", type: "circle", source: "depot",
        paint: { "circle-radius": 9, "circle-color": dark ? "#ffffff" : "#0b0b0b", "circle-stroke-color": surface, "circle-stroke-width": 3 },
      });
    }
  }, [map, depot, points, result, assignment, dark]);

  useEffect(() => {
    if (!map?.getLayer("plan-solid")) return;
    // Route colors remain consistent between the table, stops and map.
    map.setPaintProperty("plan-solid", "line-opacity", selectedRoute === null ? 0.9 : ["case", ["==", ["get", "routeIndex"], selectedRoute], 1, 0.15]);
    map.setPaintProperty("plan-dashed", "line-opacity", selectedRoute === null ? 0.9 : ["case", ["==", ["get", "routeIndex"], selectedRoute], 1, 0.15]);
  }, [map, result, selectedRoute]);

  if (dataError || !meta || !cells) return <DataState error={dataError} />;

  const hasModel = cells.speedWeekday !== null;
  const cost = (r: { km: number; minutes: number }) => r.km * params.costPerKm + (r.minutes / 60) * params.costPerHour;
  const best = result?.best;
  const naive = result?.naive;
  const totalDemand = points.reduce((s, p) => s + p.demand, 0);
  const scenario = scenarios.find((item) => item.id === scenarioId);
  const depotCity = depot?.lat === scenario?.depot.lat && depot?.lon === scenario?.depot.lon ? scenario?.depotMunicipality : undefined;

  function exportCsv() {
    if (!best) return;
    const rows = [["route", "sequence", "name", "lat", "lon", "demand"]];
    best.routes.forEach((r, ri) =>
      r.stops.forEach((s, k) => rows.push([String(ri + 1), String(k + 1), points[s].name, String(points[s].lat), String(points[s].lon), String(points[s].demand)])),
    );
    const blob = new Blob([rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "optimized-routes.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="layout optimizer-layout">
      <aside className="panel">
        <section className="panel-intro">
          <p className="eyebrow">01 / Dispatch</p>
          <h1>Route planner</h1>
          <span className="small">{points.length} stops · {fmt.int(totalDemand)} boxes · {scenarioId === "custom" ? "Custom workload" : "Sample workload"}</span>
        </section>
        <div className="plan-commands">
          <button className="primary" onClick={run} disabled={busy || !points.length || !depot}>{busy ? "Calculating…" : `Calculate ${points.length} stops`}</button>
          <button className="secondary" disabled={!points.length || !depot} onClick={() => {
            if (!depot) return;
            const saved = saveDraft({ version: 1, savedAt: new Date().toISOString(), scenarioId, depot, points, params });
            setDraftNotice(saved ? "Draft saved on this device" : "Draft could not be saved on this device");
          }}>Save draft</button>
          {draftNotice && <p className="small" role="status">{draftNotice}</p>}
          {solverError && <p className="error" role="alert">Calculation failed. Retry or reload the page.</p>}
        </div>
        <section>
          <h2>Stops & depot</h2>
          <div className="field">
            <label htmlFor="scenario">Workload</label>
            <select
              id="scenario"
              value={scenarioId}
              onChange={(e) => {
                const s = scenarios.find((x) => x.id === e.target.value);
                if (s) applyScenario(s);
              }}
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
              {scenarioId === "custom" && <option value="custom">Custom workload</option>}
            </select>
          </div>
          <p className="small" style={{ marginTop: 6 }}>{scenario?.description ?? "Custom delivery locations."}</p>
          <MunicipalityBreakdown points={points} />
          <p className="small">Depot: {depotCity && `${depotCity} · `}{depot?.lat.toFixed(4)}, {depot?.lon.toFixed(4)}</p>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="secondary" style={{ display: "inline-block" }}>
              Upload CSV
              <input className="file-input" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            <button className="secondary" onClick={() => changeStops([])}>Clear stops</button>
          </div>
          <p className="small" style={{ marginTop: 6 }}>
            <code>lat, lon, demand, name</code> · CSV stays in this browser.
          </p>
          {csvErrors.map((e) => (
            <div className="error" key={e}>{e}</div>
          ))}
        </section>

        <section>
          <h2>Vehicle & shift</h2>
          <div className="grid-2">
            <NumberField label="Van capacity (boxes)" value={params.capacity} min={1} onChange={(v) => set("capacity", v)} />
            <NumberField label="Shift length (h)" value={params.shiftHours} min={1} step={0.5} onChange={(v) => set("shiftHours", v)} />
            <NumberField label="Minutes per stop" value={params.serviceMinutes} min={0} onChange={(v) => set("serviceMinutes", v)} />
            <NumberField label="Detour factor" value={params.circuity} min={1} step={0.05} onChange={(v) => set("circuity", v)} />
            <NumberField label="Cost per km (R$)" value={params.costPerKm} min={0} step={0.1} onChange={(v) => set("costPerKm", v)} />
            <NumberField label="Driver cost per hour (R$)" value={params.costPerHour} min={0} onChange={(v) => set("costPerHour", v)} />
          </div>
        </section>

        <section>
          <h2>Travel estimates</h2>
          <Segmented
            label="Speed source"
            value={params.speedMode}
            onChange={(v) => set("speedMode", v)}
            options={[
              { value: "constant", label: "Average speed" },
              { value: "model", label: "Bus-GPS model", disabled: !hasModel, hint: "Available once the live speed model is trained" },
            ]}
          />
          <div style={{ marginTop: 10 }}>
            {params.speedMode === "constant" ? (
              <Slider label="Average van speed" value={params.constantKmh} min={8} max={45} step={1} format={(v) => `${v} km/h`} onChange={(v) => set("constantKmh", v)} />
            ) : (
              <div className="grid-2">
                <Slider label="Departure hour" value={params.hour} min={0} max={23} step={1} format={(h) => `${h}:00`} onChange={(v) => set("hour", v)} />
                <Slider label="Van vs bus speed" value={params.vehicleFactor} min={1} max={2} step={0.05} format={(v) => `×${v.toFixed(2)}`} onChange={(v) => set("vehicleFactor", v)} />
              </div>
            )}
          </div>
          {!hasModel && (
            <p className="small" style={{ marginTop: 6 }}>
              GPS model unavailable. Using the average speed above.
            </p>
          )}
        </section>

        <details className="stop-editor">
          <summary>Stop manifest <span>{points.length}</span></summary>
          <ol>{points.map((point, i) => <li key={i}><span title={point.name}>{point.name}</span><input aria-label={`Boxes for ${point.name}`} type="number" min="1" value={point.demand} onChange={(e) => { const demand = Number(e.target.value); if (Number.isFinite(demand) && demand > 0) changeStops(points.map((p, j) => j === i ? { ...p, demand } : p)); }} /><button className="text-button" aria-label={`Remove ${point.name}`} onClick={() => changeStops(points.filter((_, j) => j !== i))}>×</button></li>)}</ol>
        </details>
      </aside>
      <div className="map">
        <MapView dark={dark} onReady={setMap} />
        <div className="map-toolbar"><span className="map-title">SP / ABCD <small>Delivery map</small></span><Segmented label="Map click action" value={mode} onChange={(m) => setMode(mode === m ? "none" : m)} options={[{ value: "add", label: "Add stop" }, { value: "depot", label: "Move depot" }]} /></div>
        <div className="map-footnote">{mode === "add" ? "Click the map to place a delivery stop" : mode === "depot" ? "Click the map to set the depot" : "● Delivery stop   ◉ Depot   ─ Estimated route"}</div>
      </div>
      <aside className="results-panel" aria-label="Route results">
        <div className="section-bar"><h2>Dispatch plan</h2><span>{busy ? "Calculating" : best ? "Calculated" : "Not calculated"}</span></div>
        {best && naive && (
          <section aria-live="polite">

            <div className="tiles">
              <Tile value={best.routes.length} label="Vans needed" delta={`vs ${naive.routes.length} nearest-neighbor`} />
              <Tile value={`${fmt.int(best.km)} km`} label="Total distance" delta={savings(naive.km, best.km, "km")} />
              <Tile value={fmt.hours(best.minutes)} label="Total van time" delta={`incl. ${params.serviceMinutes} min per stop`} />
              <Tile value={fmt.brl(cost(best))} label="Estimated cost" delta={savings(cost(naive), cost(best), "R$")} />
            </div>
            {best.unassigned.length > 0 && (
              <p className="error" style={{ marginTop: 8 }}>
                {best.unassigned.length} stop(s) can't be served: demand above van capacity or too far for one shift. They're ringed in red.
              </p>
            )}
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Route</th>
                  <th className="num">Stops</th>
                  <th className="num">Load</th>
                  <th className="num">km</th>
                  <th className="num">Time</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {best.routes.map((r, ri) => {
                  const st = routeStyle(ri, dark);
                  return (
                    <tr key={ri}>
                      <td>
                        <span className="row" style={{ gap: 6 }}>
                          <span
                            className="swatch line"
                            style={{ background: st.dashed ? `repeating-linear-gradient(90deg, ${st.color} 0 5px, transparent 5px 8px)` : st.color }}
                          />
                          <button className="route-select" aria-pressed={selectedRoute === ri} aria-label={`Inspect route ${ri + 1}`} onClick={() => {
                            setSelectedRoute(selectedRoute === ri ? null : ri);
                            if (map) framePoints(map, depot!, r.stops.map((i) => points[i]));
                          }}>{ri + 1}</button>
                        </span>
                      </td>
                      <td className="num">{r.stops.length}</td>
                      <td className="num">{fmt.int(r.load)}/{params.capacity}</td>
                      <td className="num">{fmt.dec(r.km)}</td>
                      <td className="num">{fmt.hours(r.minutes)}</td>
                      <td className="num">{fmt.brl(cost(r))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {selectedRoute !== null && best.routes[selectedRoute] && <div className="route-sequence"><div className="section-bar"><h3>Route {selectedRoute + 1} / stop order</h3><button className="text-button" onClick={() => { setSelectedRoute(null); if (map && depot) framePoints(map, depot, points); }}>All routes</button></div><ol>{best.routes[selectedRoute].stops.map((i) => <li key={i}><span>{points[i].name}</span><small>{points[i].demand} boxes</small></li>)}</ol></div>}
            <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
              <span className="small">Solved in {fmt.int(result!.ms)} ms in your browser.</span>
              <button className="secondary" onClick={exportCsv}>Export CSV</button>
            </div>
            <details className="planning-notes"><summary>Comparison baseline</summary><p className="small">Nearest-neighbor dispatch: visit the closest remaining stop that fits capacity and shift, then return to the depot. Both plans use the same travel estimates.</p></details>
          </section>
        )}

        {!best && <div className="plan-empty"><div className="empty-hex" aria-hidden="true">{points.length}</div><h3>{points.length ? "Stops ready for assignment" : "No delivery stops"}</h3><p>{points.length ? `${fmt.int(totalDemand)} boxes · ${params.capacity} boxes per van` : "Import a CSV or add stops on the map."}</p>{points.length > 0 && <div className="capacity-bound"><strong>{Math.ceil(totalDemand / params.capacity)}</strong><span>minimum vans by capacity<br /><small>Before shift constraints</small></span></div>}</div>}
        <details className="planning-notes"><summary>Distance & cost assumptions</summary><p className="small">Straight-line km × {params.circuity} detour factor. Average speed {params.constantKmh} km/h{params.speedMode === "model" ? " (fallback; GPS proxy selected)" : ""}. No road routing or delivery time windows. Costs are estimates.</p></details>
      </aside>
    </div>
  );
}

function savings(before: number, after: number, unit: "km" | "R$"): string {
  const saved = before - after;
  if (before <= 0 || saved <= 0) return "same as nearest-neighbor";
  const amount = unit === "km" ? `${fmt.int(saved)} km` : fmt.brl(saved);
  return `${amount} (${fmt.pct(saved / before)}) saved vs nearest-neighbor`;
}

function framePoints(map: MlMap, depot: { lat: number; lon: number }, points: ScenarioPoint[]) {
  const locations = [depot, ...points];
  const lons = locations.map((p) => p.lon);
  const lats = locations.map((p) => p.lat);
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 50, maxZoom: 13, duration: 0 });
}
