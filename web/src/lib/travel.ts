import { latLngToCell, gridDisk } from "h3-js";
import { haversineKm, midpoint, type LatLon } from "./geo";

/** Returns a driving speed in km/h at a location. */
export type SpeedAt = (p: LatLon) => number;

export interface TravelModel {
  /** Road distance / straight-line distance. Dense grids like São Paulo sit around 1.3. */
  circuity: number;
  speedAt: SpeedAt;
}

export function constantSpeed(kmh: number): SpeedAt {
  return () => kmh;
}

/**
 * Speed field backed by per-cell bus speeds. Bus GPS speed includes stops at
 * bus stops, so it is scaled by `vehicleFactor` to approximate a delivery van.
 * Points outside the grid search up to `maxRing` rings, then use `fallbackKmh`.
 */
export function cellSpeed(
  speeds: Map<string, number>,
  res: number,
  vehicleFactor: number,
  fallbackKmh: number,
  maxRing = 3,
): SpeedAt {
  return (p) => {
    const cell = latLngToCell(p.lat, p.lon, res);
    const direct = speeds.get(cell);
    if (direct !== undefined) return direct * vehicleFactor;
    for (let k = 1; k <= maxRing; k++) {
      const near = gridDisk(cell, k).map((c) => speeds.get(c)).filter((v): v is number => v !== undefined);
      if (near.length) return (near.reduce((a, b) => a + b, 0) / near.length) * vehicleFactor;
    }
    return fallbackKmh;
  };
}

/** Distance and time matrices; minutes use the harmonic mean speed at both ends and the midpoint. */
export function buildMatrices(points: LatLon[], model: TravelModel): { km: number[][]; minutes: number[][] } {
  const n = points.length;
  const km = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const minutes = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const pace = points.map((p) => 1 / model.speedAt(p));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversineKm(points[i], points[j]) * model.circuity;
      const midPace = 1 / model.speedAt(midpoint(points[i], points[j]));
      const t = (d * 60 * (pace[i] + midPace + pace[j])) / 3;
      km[i][j] = km[j][i] = d;
      minutes[i][j] = minutes[j][i] = t;
    }
  }
  return { km, minutes };
}
