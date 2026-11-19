# Data contracts

`pipeline/build.py` writes six JSON files to `web/public/data/`. `web/src/data.ts` declares their TypeScript types and loads them with `load<T>(name)`, which fetches `${BASE_URL}data/<name>`, caches the promise, and evicts the cache entry on failure so the user can retry.

These files are generated and git-ignored. CI rebuilds them on every deploy.

## Changing a contract

1. Change the writer in `build.py`.
2. Update the matching type in `data.ts` in the same commit.
3. If a deployed snapshot could be missing the field, make it optional in TypeScript and handle its absence in the UI. `abcdMunicipalityCodes` and `population` are existing examples.
4. Rebuild the data, then run `npm test`, `npm run benchmark` and `npm run build`. The benchmark reads `scenarios.json` and `meta.json` directly.

JSON is written compactly (`separators=(",", ":")`) with `ensure_ascii=False`, so place names keep their accents.

## Files

| File | TS type | Loaded by | Purpose |
|---|---|---|---|
| `cells.json` | `Cells` | Insights, Optimizer | Per-cell access metrics and the optional speed grid. |
| `cell-routes.json` | `Record<string, number[]>` | Insights (on selection) | Bus routes serving each cell. |
| `routes.json` | `Routes` | Insights (on selection) | Simplified route geometries. |
| `boundaries.json` | GeoJSON `FeatureCollection` | Insights | Simplified municipal boundaries. |
| `scenarios.json` | `Scenario[]` | Overview, Optimizer, Simulation, benchmark | Sample delivery workloads. |
| `meta.json` | `Meta` | Insights, Model, Optimizer, benchmark | Dataset metadata, thresholds, KPIs and model cards. |

### `cells.json`

Column-oriented: every array has one entry per H3 cell, in the same order.

| Field | Type | Meaning |
|---|---|---|
| `res` | number | H3 resolution, currently 8. |
| `cell` | string[] | H3 cell index. |
| `muni` | number[] | Index into `meta.municipalities`. 0 is São Paulo. |
| `busesPeak` | number[] | Distinct scheduled trips per hour, 07:00–08:00 weekday, across the cell and its ring-1 neighbors. |
| `routes` | number[] | Count of distinct routes in that ring. |
| `nearestStopM` | number[] | Straight-line metres to the nearest stop. |
| `nearestStop` | string[] | Name of that stop. |
| `access` | number[] | Index into `meta.accessCodes` (`no_data`, `remote`, `low`, `fair`, `good`). |
| `abcKm` | number[] | Distance to the Grande ABC boundary, in km. |
| `speedWeekday` | number[][] \| null | `[cell][hour]` predicted weekday bus speed in km/h. `null` until the speed model has trained. |

### `cell-routes.json`

An object keyed by H3 cell. Each value is a list of indices into the `routes.json` arrays. Only cells in the study area are included.

### `routes.json`

Parallel arrays with one entry per bus route that serves at least one cell:

- `id`: the GTFS `route_id`.
- `name`: the `route_long_name`.
- `line`: a flattened `[lon, lat, lon, lat, ...]` array from the route's longest shape, simplified to about 30 m and rounded to 5 decimals.

### `boundaries.json`

A GeoJSON `FeatureCollection` with one feature per municipality. Its properties are `code` (the IBGE code), `name`, and `abc` (true for every Grande ABC city).

### `scenarios.json`

```ts
interface Scenario {
  id: string;                    // "abcd", "abcd-sp", "centro", "zona-leste"
  name: string;
  description: string;
  depot: { lat: number; lon: number };
  depotMunicipality?: string;
  points: { lat: number; lon: number; demand: number; name: string; municipality?: string }[];
}
```

Scenario IDs appear in deep links (`#optimizer?scenario=<id>`) and in saved drafts (`scenarioId`; `"custom"` means user-built). Don't rename an ID without accepting that old links and drafts will no longer match it.

### `meta.json`

| Field | Meaning |
|---|---|
| `generatedAt` | ISO UTC timestamp of the build. The UI and the benchmark print it. |
| `feed.source` | Human-readable feed attribution. |
| `municipalities` | `{code, name}[]`, with São Paulo first and then the seven Grande ABC cities. `cells.muni` indexes into this list. |
| `abcdMunicipalityCodes` | IBGE codes of the four ABCD cities. Optional. |
| `population` | Censo 2022 municipal counts with source, URL, retrieval date and totals. Optional. `geography` is always `"municipality"`. |
| `accessCodes` | The ordered access labels that `cells.access` indexes. |
| `thresholds` | `lowBusesPerHour`, `goodBusesPerHour`, `maxWalkToStopM`, `remoteStopM`, `abcBorderKm`. Copied from `network.py` and `config.py`. |
| `kpis` | Stop and route counts, the São Paulo low/remote cell shares, and border cell counts and shares. |
| `abcBorderGaps` | Up to 15 low-access São Paulo cells within `abcBorderKm` of the ABC, sorted by fewest buses and then farthest stop. |
| `scheduleSignal` | Trip count, mean and median scheduled speed, two correlations, and `cv_r2`: named feature sets with their cross-validated R². |
| `speedModel` | Either `{status: "waiting_for_data", have, need}`, or `{status: "trained", days, samples, cv, importances, hourly_weekday_kmh}`. |

## Inputs the pipeline reads

| Path | Committed | Notes |
|---|---|---|
| `pipeline/cache/gtfs/` | no | Download of `config.GTFS_URL`. Refreshed with `--refresh`. |
| `pipeline/data/boundaries/<ibge-code>.geojson` | yes | IBGE municipal meshes, one per study municipality. |
| `pipeline/data/population-2022.json` | yes | Raw SIDRA table 4714 response. `population.py` validates codes, year, variable and counts. |
| `pipeline/realtime/speeds-YYYY-MM.csv` | no | Columns `date,weekday,hour,cell,n,sum_kmh,sum_kmh_sq`. CI extracts them from the `realtime-data` branch. |
