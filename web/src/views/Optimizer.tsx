import type { Map as MlMap, MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapView, setGeoJson } from "../components/MapView";
import { NumberField, Segmented, Slider, Tile, fmt } from "../components/ui";
import { load, type Cells, type Meta, type Scenario, type ScenarioPoint } from "../data";
import { routeStyle } from "../lib/colors";
import { parseDeliveryCsv } from "../lib/csv";
import type { SolveRequest, SolveResponse } from "../lib/solver.worker";

type ClickMode = "none" | "add" | "depot";
type SpeedMode = "constant" | "model";

interface Params {
  capacity: number;
  shiftHours: number;
  serviceMinutes: number;
  circuity: number;
  constantKmh: number;
  speedMode: SpeedMode;
  hour: number;
  vehicleFactor: number;
  costPerKm: number;
  costPerHour: number;
}

const MAX_POINTS = 250;

export function Optimizer({ dark }: { dark: boolean }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [cells, setCells] = useState<Cells | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioId, setScenarioId] = useState("abc-border");
  const [depot, setDepot] = useState<{ lat: number; lon: number } | null>(null);
  const [points, setPoints] = useState<ScenarioPoint[]>([]);
  const [mode, setMode] = useState<ClickMode>("none");
  const [params, setParams] = useState<Params>({
    capacity: 30,
    shiftHours: 8,
    serviceMinutes: 5,
    circuity: 1.3,
    constantKmh: 20,
    speedMode: "constant",
    hour: 10,
    vehicleFactor: 1.3,
    costPerKm: 1.2,
    costPerHour: 35,
  });
  const [result, setResult] = useState<SolveResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [map, setMap] = useState<MlMap | null>(null);
  const worker = useRef<Worker | null>(null);

  useEffect(() => {
    Promise.all([load<Meta>("meta.json"), load<Scenario[]>("scenarios.json"), load<Cells>("cells.json")]).then(([m, s, c]) => {
      setMeta(m);
      setScenarios(s);
      setCells(c);
      applyScenario(s[0]);
    });
    worker.current = new Worker(new URL("../lib/solver.worker.ts", import.meta.url), { type: "module" });
    worker.current.onmessage = (e: MessageEvent<SolveResponse>) => {
      setResult(e.data);
      setBusy(false);
    };
    return () => worker.current?.terminate();
  }, []);

  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));

  function applyScenario(s: Scenario) {
    setScenarioId(s.id);
    setDepot(s.depot);
    setPoints(s.points);
    setResult(null);
    map?.flyTo({ center: [s.depot.lon, s.depot.lat], zoom: 11.5 });
  }

  function changeStops(next: ScenarioPoint[]) {
    setPoints(next.slice(0, MAX_POINTS));
    setScenarioId("custom");
    setResult(null);
  }

  function run() {
    if (!depot || !points.length || !worker.current || !cells) return;
    setBusy(true);
    const req: SolveRequest = {
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
        setResult(null);
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
      map.jumpTo({ center: [depot.lon, depot.lat], zoom: 11.5 });
    }
  }, [map, depot]);

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
        properties: routeStyle(ri, dark),
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

  if (!meta || !cells) return <div className="loading">Loading…</div>;

  const hasModel = cells.speedWeekday !== null;
  const cost = (r: { km: number; minutes: number }) => r.km * params.costPerKm + (r.minutes / 60) * params.costPerHour;
  const best = result?.best;
  const naive = result?.naive;
  const totalDemand = points.reduce((s, p) => s + p.demand, 0);

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
    <div className="layout">
      <aside className="panel">
        <section>
          <h2>1 · Delivery points</h2>
          <div className="field">
            <label htmlFor="scenario">Demo scenario</label>
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
              {scenarioId === "custom" && <option value="custom">Custom points</option>}
            </select>
          </div>
          <p className="small" style={{ marginTop: 6 }}>
            {scenarios.find((s) => s.id === scenarioId)?.description ?? "Your own points."} {points.length} stops, {fmt.int(totalDemand)} boxes.
          </p>
          <div className="row">
            <Segmented
              label="Map click action"
              value={mode}
              onChange={(m) => setMode(mode === m ? "none" : m)}
              options={[
                { value: "add", label: "Click to add stops" },
                { value: "depot", label: "Move depot" },
              ]}
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="secondary" style={{ display: "inline-block" }}>
              Upload CSV
              <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            <button className="secondary" onClick={() => changeStops([])}>Clear stops</button>
          </div>
          <p className="small" style={{ marginTop: 6 }}>
            CSV columns: <code>lat, lon, demand, name</code> (header optional; <code>;</code> with decimal commas works too). Files never leave your browser.
          </p>
          {csvErrors.map((e) => (
            <div className="error" key={e}>{e}</div>
          ))}
        </section>

        <section>
          <h2>2 · Fleet & costs</h2>
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
          <h2>3 · Travel speed</h2>
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
              The location- and hour-aware speed model switches on once enough live Olho Vivo GPS data has been collected. See the Model tab.
            </p>
          )}
        </section>

        <button className="primary" onClick={run} disabled={busy || !points.length || !depot}>
          {busy ? "Optimizing…" : `Optimize ${points.length} stops`}
        </button>

        {best && naive && (
          <section>
            <h2>Plan</h2>
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
                          {ri + 1}
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
            <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
              <span className="small">Solved in {fmt.int(result!.ms)} ms in your browser.</span>
              <button className="secondary" onClick={exportCsv}>Export CSV</button>
            </div>
            <p className="small" style={{ marginTop: 8 }}>
              Lines are straight segments between stops; distances use straight-line km × detour factor. Baseline = nearest-neighbor dispatch (always drive to the closest stop that still fits).
            </p>
          </section>
        )}
      </aside>
      <div className="map">
        <MapView dark={dark} onReady={setMap} />
      </div>
    </div>
  );
}

function savings(before: number, after: number, unit: "km" | "R$"): string {
  const saved = before - after;
  if (before <= 0 || saved <= 0) return "same as nearest-neighbor";
  const amount = unit === "km" ? `${fmt.int(saved)} km` : fmt.brl(saved);
  return `${amount} (${fmt.pct(saved / before)}) saved vs nearest-neighbor`;
}
