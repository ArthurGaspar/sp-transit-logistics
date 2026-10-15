import { useEffect, useState } from "react";
import { HBarChart, HourlyLine } from "../components/charts";
import { Tile, fmt } from "../components/ui";
import { load, type Meta } from "../data";

const FEATURE_SET_LABELS: Record<string, string> = {
  location: "Location only",
  route_design: "Route design only",
  both: "Location + design",
};

const FEATURE_LABELS: Record<string, string> = {
  lat: "Latitude",
  lon: "Longitude",
  dist_center_km: "Distance to center",
  buses_peak: "Buses / hour nearby",
  stops: "Stops in hexagon",
  routes: "Routes nearby",
  hour_sin: "Hour (sin)",
  hour_cos: "Hour (cos)",
  weekend: "Weekend",
};

export function Model() {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    load<Meta>("meta.json").then(setMeta);
  }, []);
  if (!meta) return <div className="loading">Loading…</div>;

  const s = meta.scheduleSignal;
  const m = meta.speedModel;

  return (
    <div className="page">
      <div className="page-inner">
        <section>
          <h2>Model & data</h2>
          <h3 style={{ fontSize: 22, letterSpacing: "-0.02em" }}>Why the speed model learns from live GPS, not the timetable</h3>
          <p>
            The SPTrans GTFS timetable does not say where or when buses run slowly. The pipeline checks this on every build:
          </p>
        </section>

        <div className="tiles" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <Tile value={fmt.dec(s.within_trip_time_vs_distance_r, 2)} label="Correlation of stop-to-stop time with distance" delta="Median per trip. Stop times are synthetic." />
          <Tile value={fmt.dec(s.speed_vs_center_distance_r, 3)} label="Correlation of trip speed with distance to center" delta={`${fmt.int(s.trips)} bus trip patterns`} />
          <Tile value={`${fmt.dec(s.mean_speed_kmh)} km/h`} label="Mean scheduled bus speed" delta={`median ${fmt.dec(s.median_speed_kmh)} km/h`} />
        </div>

        <section className="card">
          <h3>How well trip speed can be predicted from the schedule (cross-validated R²)</h3>
          <p className="small">Random forest, 5-fold CV with route variants grouped together. 0 = no better than predicting the average.</p>
          <HBarChart
            ariaLabel="Cross-validated R squared of trip-speed models by feature set"
            data={Object.entries(s.cv_r2).map(([k, v]) => ({ label: FEATURE_SET_LABELS[k] ?? k, value: v.r2, note: v.features.join(", ") }))}
            format={(v) => v.toFixed(2)}
            domain={[-0.2, 0.3]}
          />
          <p style={{ marginTop: 10 }}>
            Location features score below zero, and all four together reach {fmt.dec(s.cv_r2.both?.r2 ?? 0, 2)}, mostly from stop
            spacing and route length. The speed model therefore trains on vehicle positions from the SPTrans <b>Olho Vivo</b> API,
            collected by a scheduled GitHub Action.
          </p>
        </section>

        <section className="card">
          <h3>Live speed model</h3>
          {m.status === "trained" && m.cv ? (
            <>
              <p>
                Trained on {fmt.int(m.samples ?? 0)} GPS speed samples over {m.days} days. Scores come from spatial GroupKFold over
                ~36 km² blocks, so each block is predicted by a model that never saw it.
              </p>
              <div className="tiles" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
                <Tile value={`${fmt.dec(m.cv.mae_kmh)} km/h`} label="Mean absolute error" delta={`baseline ${fmt.dec(m.cv.baseline_mae_kmh)} km/h`} />
                <Tile value={fmt.dec(m.cv.r2, 2)} label="R²" delta={`baseline ${fmt.dec(m.cv.baseline_r2, 2)} (city-wide mean for that hour)`} />
              </div>
              {m.hourly_weekday_kmh && (
                <div style={{ marginTop: 16 }}>
                  <h3>Observed weekday bus speed by hour</h3>
                  <HourlyLine values={m.hourly_weekday_kmh} unit="km/h" ariaLabel="Observed weekday mean bus speed by hour" />
                </div>
              )}
              {m.importances && (
                <div style={{ marginTop: 16 }}>
                  <h3>Feature importance</h3>
                  <HBarChart
                    ariaLabel="Random forest feature importances"
                    data={Object.entries(m.importances).map(([k, v]) => ({ label: FEATURE_LABELS[k] ?? k, value: v }))}
                    format={(v) => v.toFixed(2)}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="callout warn">
              <p>
                <b>Waiting for live data.</b> The model trains automatically once it has {m.need}. Current: {m.have}.
              </p>
              <p className="small" style={{ marginBottom: 0 }}>
                How it works: every 30 minutes a GitHub Action takes two snapshots of every bus position 75 s apart, turns
                displacements into speeds, and commits only per-hexagon hourly aggregates to the <code>realtime-data</code> branch.
                The weekly site build retrains on everything collected so far. Until then, the optimizer uses a single average speed.
              </p>
            </div>
          )}
        </section>

        <section className="card">
          <h3>Method & assumptions</h3>
          <ul style={{ paddingLeft: 18, margin: 0, color: "var(--text-secondary)" }}>
            <li><b>Grid:</b> Uber H3 resolution 8 hexagons (~0.74 km², ~460 m edge) over São Paulo and the seven Grande ABC municipalities.</li>
            <li>
              <b>Access:</b> scheduled bus passes per hour within the hexagon and its six neighbors (~1 km) during the 7-8 am weekday peak,
              from <code>frequencies.txt</code>; walk = straight line from the hexagon center to the nearest stop. Low: under{" "}
              {meta.thresholds.lowBusesPerHour} buses/h or over {meta.thresholds.maxWalkToStopM} m. Good: {meta.thresholds.goodBusesPerHour}+ buses/h
              or a metro/train station nearby.
            </li>
            <li>
              <b>Remote:</b> no population data is used yet, so hexagons over {fmt.int(meta.thresholds.remoteStopM)} m from any stop are assumed to be
              mostly uninhabited (reservoirs, Atlantic forest) and kept out of gap rankings. Adding IBGE census population is the next improvement.
            </li>
            <li><b>ABC:</b> the ABC cities and EMTU publish no open GTFS, so the analysis covers the São Paulo side of the border.</li>
            <li>
              <b>Routing:</b> capacitated VRP with a shift limit, solved in a Web Worker with Clarke-Wright savings, then 2-opt, relocate and swap
              local search. Distance = straight line × detour factor (default 1.3). Costs per km and per hour are editable assumptions, not quotes.
            </li>
            <li><b>Hosting:</b> everything is precomputed into static JSON by a Python pipeline and served from GitHub Pages. No backend, no API keys in the browser.</li>
          </ul>
        </section>

        <section className="card">
          <h3>Data sources</h3>
          <ul style={{ paddingLeft: 18, margin: 0, color: "var(--text-secondary)" }}>
            <li>
              SPTrans GTFS, mirrored by <a href="https://mobilitydatabase.org">Mobility Database</a> ({meta.feed.source}).
            </li>
            <li>Municipal boundaries: IBGE malhas territoriais API.</li>
            <li>Live positions: SPTrans Olho Vivo API (free developer token).</li>
            <li>Basemap: © OpenStreetMap contributors, tiles by OpenFreeMap.</li>
          </ul>
          <p className="small" style={{ marginTop: 10 }}>Data built {new Date(meta.generatedAt).toLocaleString("en-GB")}.</p>
        </section>
      </div>
    </div>
  );
}
