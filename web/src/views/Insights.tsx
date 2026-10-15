import * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import { cellToLatLng } from "h3-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapView, setGeoJson } from "../components/MapView";
import { Segmented, Slider, Tile, fmt } from "../components/ui";
import { load, type AccessCode, type Cells, type Meta, type Routes } from "../data";
import { ACCESS_COLORS, ACCESS_LABELS, SEQUENTIAL, binIndex, quantileEdges } from "../lib/colors";
import { cellFeatures } from "../lib/hex";

type Metric = "access" | "busesPeak" | "nearestStopM" | "speed";

const METRIC_INFO: Record<Metric, { label: string; unit: string; legend: string }> = {
  access: { label: "Access level", unit: "", legend: "Transit access" },
  busesPeak: { label: "Buses / hour", unit: "buses/h", legend: "Scheduled bus passes per hour within ~1 km, 7-8 am weekday" },
  nearestStopM: { label: "Walk to stop", unit: "m", legend: "Straight-line distance from hexagon center to the nearest stop" },
  speed: { label: "Bus speed", unit: "km/h", legend: "Predicted weekday bus speed (Olho Vivo GPS model)" },
};

const LEGEND_ORDER: AccessCode[] = ["good", "fair", "low", "remote", "no_data"];

export function Insights({ dark }: { dark: boolean }) {
  const [cells, setCells] = useState<Cells | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const [metric, setMetric] = useState<Metric>("access");
  const [hour, setHour] = useState(8);
  const [borderOnly, setBorderOnly] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [cellRoutes, setCellRoutes] = useState<Record<string, number[]> | null>(null);
  const [routes, setRoutes] = useState<Routes | null>(null);
  const [route, setRoute] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([load<Cells>("cells.json"), load<Meta>("meta.json")])
      .then(([c, m]) => {
        setCells(c);
        setMeta(m);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (selected === null || cellRoutes) return;
    Promise.all([load<Record<string, number[]>>("cell-routes.json"), load<Routes>("routes.json")]).then(([cr, r]) => {
      setCellRoutes(cr);
      setRoutes(r);
    });
  }, [selected, cellRoutes]);

  const index = useMemo(() => new Map(cells?.cell.map((c, i) => [c, i]) ?? []), [cells]);
  const values = useMemo(() => {
    if (!cells || metric === "access") return null;
    const spOnly = cells.muni.map((m) => m === 0);
    const v =
      metric === "speed"
        ? cells.speedWeekday?.map((row) => row[hour]) ?? []
        : (cells[metric] as number[]);
    const edges = quantileEdges(v.filter((_, i) => spOnly[i]), SEQUENTIAL.length);
    return { v, edges };
  }, [cells, metric, hour]);

  const isBorder = (i: number) => cells!.muni[i] === 0 && cells!.abcKm[i] <= meta!.thresholds.abcBorderKm;

  const color = (i: number): string => {
    if (!cells || !meta) return "transparent";
    if (metric === "access" || !values) return ACCESS_COLORS[meta.accessCodes[cells.access[i]]];
    if (metric !== "speed" && cells.muni[i] !== 0) return ACCESS_COLORS.no_data;
    return SEQUENTIAL[binIndex(values.v[i], values.edges)];
  };

  // Hexagons and municipal boundaries.
  useEffect(() => {
    if (!map || !cells || !meta) return;
    setGeoJson(map, "hex", cellFeatures(cells, (i) => ({ color: color(i), dim: borderOnly && !isBorder(i) })));
    if (!map.getLayer("hex")) {
      map.addLayer({
        id: "hex",
        type: "fill",
        source: "hex",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": ["case", ["get", "dim"], 0.08, 0.62],
          "fill-outline-color": "rgba(0,0,0,0)",
        },
      });
      map.addLayer({
        id: "hex-selected",
        type: "line",
        source: "hex",
        filter: ["==", ["get", "i"], -1],
        paint: { "line-color": dark ? "#ffffff" : "#0b0b0b", "line-width": 2.5 },
      });
      load<GeoJSON.FeatureCollection>("boundaries.json").then((b) => {
        setGeoJson(map, "muni", b);
        map.addLayer({
          id: "muni",
          type: "line",
          source: "muni",
          paint: {
            "line-color": dark ? "#c3c2b7" : "#52514e",
            "line-width": ["case", ["get", "abc"], 1, 1.6],
            "line-dasharray": ["case", ["get", "abc"], ["literal", [3, 2]], ["literal", [1, 0]]],
          },
        });
      });
      wireHover(map);
      map.on("click", "hex", (e) => {
        const i = e.features?.[0]?.properties?.i;
        if (typeof i === "number") {
          setSelected(i);
          setRoute(null);
        }
      });
    }
  }, [map, cells, meta, metric, hour, borderOnly]);

  useEffect(() => {
    if (map?.getLayer("hex-selected")) map.setFilter("hex-selected", ["==", ["get", "i"], selected ?? -1]);
  }, [map, selected]);

  // Selected route line.
  useEffect(() => {
    if (!map || !routes) return;
    const coords: [number, number][] = [];
    const line = route === null ? [] : routes.line[route];
    for (let k = 0; k < line.length; k += 2) coords.push([line[k], line[k + 1]]);
    setGeoJson(map, "route", {
      type: "FeatureCollection",
      features: coords.length ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] : [],
    });
    if (!map.getLayer("route")) {
      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": dark ? "#ffffff" : "#0b0b0b", "line-width": 3 },
      });
    }
  }, [map, routes, route]);

  // Hover tooltip, reading the latest state through a ref.
  const tipState = useRef({ cells, meta, metric, values });
  tipState.current = { cells, meta, metric, values };
  function wireHover(m: MlMap) {
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
    m.on("mousemove", "hex", (e) => {
      const { cells: c, meta: mt, metric: mtr, values: vals } = tipState.current;
      const i = e.features?.[0]?.properties?.i;
      if (!c || !mt || typeof i !== "number") return;
      m.getCanvas().style.cursor = "pointer";
      const muni = mt.municipalities[c.muni[i]].name;
      const val =
        mtr === "access"
          ? ACCESS_LABELS[mt.accessCodes[c.access[i]]]
          : vals && Number.isFinite(vals.v[i]) && (mtr === "speed" || c.muni[i] === 0)
            ? `${fmt.dec(vals.v[i])} ${METRIC_INFO[mtr].unit}`
            : "No data";
      popup.setLngLat(e.lngLat).setHTML(
        `<div class="tooltip-title">${escapeHtml(muni)}</div>${METRIC_INFO[mtr].label}: <b>${escapeHtml(val)}</b>`,
      ).addTo(m);
    });
    m.on("mouseleave", "hex", () => {
      m.getCanvas().style.cursor = "";
      popup.remove();
    });
  }

  const focusCell = (i: number) => {
    setSelected(i);
    setRoute(null);
    const [lat, lng] = cellToLatLng(cells!.cell[i]);
    map?.flyTo({ center: [lng, lat], zoom: 13 });
  };

  if (error) return <div className="loading error">{error}</div>;
  if (!cells || !meta) return <div className="loading">Loading network data…</div>;

  const k = meta.kpis;
  const hasSpeed = cells.speedWeekday !== null;
  const sel = selected;

  return (
    <div className="layout">
      <aside className="panel">
        <section>
          <h2>São Paulo bus network</h2>
          <div className="tiles">
            <Tile value={fmt.int(k.stops)} label="Stops" />
            <Tile value={fmt.int(k.busRoutes)} label="Bus routes" delta={`+ ${k.railRoutes} metro/rail lines`} />
            <Tile value={fmt.pct(k.spLowShare)} label="Hexagons with low access" delta={`${fmt.pct(k.spRemoteShare)} remote, excluded`} />
            <Tile value={fmt.pct(k.borderLowShare)} label="Low access on ABC border" delta={`${k.borderCells} hexagons within ${meta.thresholds.abcBorderKm} km`} />
          </div>
        </section>

        <section>
          <h2>Map layer</h2>
          <Segmented
            label="Map metric"
            value={metric}
            onChange={setMetric}
            options={(Object.keys(METRIC_INFO) as Metric[]).map((m) => ({
              value: m,
              label: METRIC_INFO[m].label,
              disabled: m === "speed" && !hasSpeed,
              hint: "Available once the live speed model is trained",
            }))}
          />
          {metric === "speed" && hasSpeed && (
            <div style={{ marginTop: 10 }}>
              <Slider label="Hour of day" value={hour} min={0} max={23} step={1} format={(h) => `${h}:00`} onChange={setHour} />
            </div>
          )}
          <label className="row small" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={borderOnly} onChange={(e) => setBorderOnly(e.target.checked)} />
            Focus on the São Paulo side of the ABC border
          </label>
        </section>

        <section className="legend" aria-label="Legend">
          <h2>{METRIC_INFO[metric].legend}</h2>
          {metric === "access" ? (
            LEGEND_ORDER.map((a) => (
              <div className="item" key={a}>
                <span
                  className="swatch"
                  style={{ background: ACCESS_COLORS[a], border: a === "no_data" ? "1px dashed var(--text-muted)" : undefined }}
                />
                {ACCESS_LABELS[a]}
              </div>
            ))
          ) : (
            values && (
              <>
                <div className="ramp">
                  {SEQUENTIAL.slice(0, values.edges.length + 1).map((c) => (
                    <div key={c} style={{ background: c }} />
                  ))}
                </div>
                <div className="ramp-labels">
                  <span>{"<"} {fmt.int(values.edges[0])}</span>
                  <span>{fmt.int(values.edges[values.edges.length - 1])}+ {METRIC_INFO[metric].unit}</span>
                </div>
              </>
            )
          )}
          {metric === "access" && (
            <p className="small" style={{ marginTop: 6 }}>
              Low: under {meta.thresholds.lowBusesPerHour} buses/h within ~1 km or over {meta.thresholds.maxWalkToStopM} m to a stop.
              Good: {meta.thresholds.goodBusesPerHour}+ buses/h or a metro/train station nearby. Remote: over{" "}
              {fmt.int(meta.thresholds.remoteStopM)} m from any stop.
            </p>
          )}
        </section>

        {sel !== null && (
          <section className="card" style={{ padding: 12 }}>
            <h3>{meta.municipalities[cells.muni[sel]].name}</h3>
            {cells.muni[sel] === 0 ? (
              <>
                <p className="small">Nearest stop: {cells.nearestStop[sel]} ({fmt.int(cells.nearestStopM[sel])} m)</p>
                <div className="tiles">
                  <Tile value={fmt.int(cells.busesPeak[sel])} label="Buses / hour (peak)" />
                  <Tile value={cells.routes[sel]} label="Bus routes nearby" />
                </div>
                {cellRoutes && routes && (cellRoutes[cells.cell[sel]]?.length ?? 0) > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <p className="small">Routes serving this area: click one to draw it.</p>
                    <div className="seg">
                      {cellRoutes[cells.cell[sel]].slice(0, 40).map((r) => (
                        <button key={r} aria-pressed={route === r} title={routes.name[r]} onClick={() => setRoute(route === r ? null : r)}>
                          {routes.id[r]}
                        </button>
                      ))}
                    </div>
                    {route !== null && <p className="small" style={{ marginTop: 6 }}>{routes.name[route]}</p>}
                  </div>
                )}
              </>
            ) : (
              <p className="small">
                SPTrans data covers São Paulo city only, and the ABC municipalities publish no open GTFS feed, so access isn't scored here.
              </p>
            )}
          </section>
        )}

        <section>
          <h2>Worst-served hexagons on the ABC border</h2>
          <p className="small">Low-access São Paulo hexagons within {meta.thresholds.abcBorderKm} km of the ABC, fewest buses first.</p>
          <table>
            <thead>
              <tr>
                <th>Near stop</th>
                <th className="num">Buses/h</th>
                <th className="num">Walk</th>
              </tr>
            </thead>
            <tbody>
              {meta.abcBorderGaps.map((g) => (
                <tr key={g.cell} className="clickable" onClick={() => index.has(g.cell) && focusCell(index.get(g.cell)!)}>
                  <td>{g.nearestStop}</td>
                  <td className="num">{fmt.int(g.busesPeak)}</td>
                  <td className="num">{fmt.int(g.nearestStopM)} m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <p className="small">
          Data: {meta.feed.source}, municipal boundaries © IBGE. Built {new Date(meta.generatedAt).toLocaleDateString("en-GB")}.
        </p>
      </aside>
      <div className="map">
        <MapView dark={dark} onReady={setMap} />
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
