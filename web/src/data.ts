/** Types and loaders for the static JSON produced by pipeline/build.py. */

export type AccessCode = "no_data" | "remote" | "low" | "fair" | "good";

export interface Cells {
  res: number;
  cell: string[];
  muni: number[];
  busesPeak: number[];
  routes: number[];
  nearestStopM: number[];
  nearestStop: string[];
  access: number[];
  abcKm: number[];
  /** [cell][hour] weekday bus speed in km/h, once the realtime model is trained. */
  speedWeekday: number[][] | null;
}

export interface Routes {
  id: string[];
  name: string[];
  /** Flattened [lon, lat, lon, lat, ...] */
  line: number[][];
}

export interface BorderGap {
  cell: string;
  nearestStop: string;
  nearestStopM: number;
  busesPeak: number;
  routes: number;
  abcKm: number;
}

export interface SpeedModelCard {
  status: "trained" | "waiting_for_data";
  have?: string;
  need?: string;
  days?: number;
  samples?: number;
  cv?: { mae_kmh: number; r2: number; baseline_mae_kmh: number; baseline_r2: number };
  importances?: Record<string, number>;
  hourly_weekday_kmh?: number[];
}

export interface Meta {
  generatedAt: string;
  feed: { source: string };
  municipalities: { code: string; name: string }[];
  accessCodes: AccessCode[];
  thresholds: {
    lowBusesPerHour: number;
    goodBusesPerHour: number;
    maxWalkToStopM: number;
    remoteStopM: number;
    abcBorderKm: number;
  };
  kpis: {
    stops: number;
    busRoutes: number;
    railRoutes: number;
    spLowShare: number;
    spRemoteShare: number;
    borderCells: number;
    borderLowShare: number;
  };
  abcBorderGaps: BorderGap[];
  scheduleSignal: {
    trips: number;
    mean_speed_kmh: number;
    median_speed_kmh: number;
    within_trip_time_vs_distance_r: number;
    speed_vs_center_distance_r: number;
    cv_r2: Record<string, { features: string[]; r2: number }>;
  };
  speedModel: SpeedModelCard;
}

export interface ScenarioPoint {
  lat: number;
  lon: number;
  demand: number;
  name: string;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  depot: { lat: number; lon: number };
  points: ScenarioPoint[];
}

const cache = new Map<string, Promise<unknown>>();

export function load<T>(name: string): Promise<T> {
  if (!cache.has(name)) {
    const url = `${import.meta.env.BASE_URL}data/${name}`;
    cache.set(
      name,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`Could not load ${url} (${r.status}). Run the pipeline first.`);
        return r.json();
      }),
    );
  }
  return cache.get(name) as Promise<T>;
}
