import { useEffect, useState } from "react";
import { HBarChart, HourlyLine } from "../components/charts";
import { DataState, Tile, fmt } from "../components/ui";
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
  const [error, setError] = useState(false);
  useEffect(() => {
    load<Meta>("meta.json").then(setMeta).catch(() => setError(true));
  }, []);
  if (error || !meta) return <DataState error={error} />;

  const s = meta.scheduleSignal;
  const m = meta.speedModel;
  const abcdResidents = meta.population?.municipalities.filter((city) => meta.abcdMunicipalityCodes?.includes(city.code)).reduce((sum, city) => sum + city.residents, 0);

  return (
    <div className="page">
      <div className="page-inner">
        <section>
          <p className="eyebrow">03 / Data quality</p>
          <h1 className="method-title">Data & model diagnostics</h1>
          <p>
            Dataset built {new Date(meta.generatedAt).toLocaleString("en-GB")}. Scheduled service and observed GPS speeds are evaluated separately.
          </p>
        </section>

        <div className="tiles" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <Tile value={fmt.dec(s.within_trip_time_vs_distance_r, 2)} label="Correlation of stop-to-stop time with distance" delta="Median per trip; this does not establish how stop times were produced." />
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
            Location features score {fmt.dec(s.cv_r2.location?.r2 ?? 0, 2)}; all four features together score {fmt.dec(s.cv_r2.both?.r2 ?? 0, 2)}.
            These are predictions of scheduled trip speed, not observed road speed. The separate speed model uses vehicle positions from the SPTrans <b>Olho Vivo</b> API.
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
              <p className="small" style={{ marginBottom: 0 }}>Average-speed planning remains available. GPS observations are aggregated by area and hour; the model is updated when a new dataset is built.</p>
            </div>
          )}
          <p className="small" style={{ marginTop: 12 }}>Bus speed is an experimental proxy for van travel. These scores do not validate delivery arrival times.</p>
        </section>

        <section className="card">
          <h3>Resident population{meta.population ? ` · Censo ${meta.population.year}` : ""}</h3>
          {meta.population ? <>
            <div className="tiles" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <Tile value={fmt.int(meta.population.totalResidents)} label="São Paulo + Grande ABC residents" delta={`Census reference year: ${meta.population.year}`} />
              <Tile value={fmt.int(meta.population.abcResidents)} label="Grande ABC residents" delta="Seven municipalities" />
              {abcdResidents ? <Tile value={fmt.int(abcdResidents)} label="ABCD residents" delta="Santo André, São Bernardo, São Caetano and Diadema" /> : null}
            </div>
            <table>
              <thead><tr><th scope="col">Municipality</th><th scope="col" className="num">Residents</th></tr></thead>
              <tbody>{meta.population.municipalities.map((municipality) => <tr key={municipality.code}>
                <th scope="row">{municipality.name}</th><td className="num">{fmt.int(municipality.residents)}</td>
              </tr>)}</tbody>
            </table>
            <p className="small">Source: <a href={meta.population.sourceUrl}>{meta.population.source}</a>. Snapshot retrieved {meta.population.retrievedAt}.</p>
            <p className="small">These are municipal census totals, not current estimates or counts by hexagon. Access percentages remain area-based. Census-sector counts and boundaries are needed to estimate residents with low transit access; municipal totals are not spread uniformly across cells.</p>
          </> : <p>Population data is unavailable in this dataset snapshot.</p>}
        </section>

        <section className="card">
          <h3>Method & assumptions</h3>
          <ul style={{ paddingLeft: 18, margin: 0, color: "var(--text-secondary)" }}>
            <li><b>Grid:</b> Uber H3 resolution 8 hexagons (~0.74 km², ~460 m edge) over São Paulo and the seven Grande ABC municipalities.</li>
            <li>
              <b>Access:</b> scheduled bus passes per hour within the hexagon and its six neighbors (~1 km) during the 7-8 am weekday peak,
              from <code>frequencies.txt</code>; distance is a straight line from the hexagon center to the nearest stop. Without nearby rail, low means under{" "}
              {meta.thresholds.lowBusesPerHour} buses/h or over {meta.thresholds.maxWalkToStopM} m. Good requires a stop within {meta.thresholds.maxWalkToStopM} m and either {meta.thresholds.goodBusesPerHour}+ buses/h or nearby rail. Other non-remote cells are fair.
            </li>
            <li>
              <b>Remote:</b> cells over {fmt.int(meta.thresholds.remoteStopM)} m from any stop, without nearby rail, are kept out of the gap ranking. Their population is unknown: remoteness does not establish that nobody lives there. Headline shares use all São Paulo cells as the denominator, including remote cells.
            </li>
            <li><b>Regional scope:</b> the delivery samples focus on Santo André, São Bernardo do Campo, São Caetano do Sul and Diadema (ABCD). The atlas and census totals also include Mauá, Ribeirão Pires and Rio Grande da Serra. SPTrans access is scored on the São Paulo side only.</li>
            <li>
              <b>Routing:</b> capacitated VRP with a shift limit, solved in a Web Worker with Clarke-Wright savings, then 2-opt, relocate and swap
              local search. Distance = straight line × detour factor (default 1.3). Costs per km and per hour are editable assumptions, not quotes.
            </li>
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
