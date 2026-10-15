import type { LatLon } from "./geo";
import { buildMatrices, cellSpeed, constantSpeed } from "./travel";
import { nearestNeighborPlan, solve, type VrpSolution } from "./vrp";

export interface SolveRequest {
  depot: LatLon;
  stops: (LatLon & { demand: number })[];
  capacity: number;
  maxRouteMinutes: number;
  serviceMinutes: number;
  circuity: number;
  constantKmh: number;
  /** Bus speeds for the chosen hour; when present they replace the constant speed. */
  cellSpeeds?: { res: number; cells: string[]; kmh: number[]; vehicleFactor: number };
}

export interface SolveResponse {
  best: VrpSolution;
  naive: VrpSolution;
  ms: number;
}

self.onmessage = (e: MessageEvent<SolveRequest>) => {
  const r = e.data;
  const t0 = performance.now();
  const speedAt = r.cellSpeeds
    ? cellSpeed(
        new Map(r.cellSpeeds.cells.map((c, i) => [c, r.cellSpeeds!.kmh[i]])),
        r.cellSpeeds.res,
        r.cellSpeeds.vehicleFactor,
        r.constantKmh,
      )
    : constantSpeed(r.constantKmh);
  const { km, minutes } = buildMatrices([r.depot, ...r.stops], { circuity: r.circuity, speedAt });
  const problem = {
    km,
    minutes,
    demand: r.stops.map((s) => s.demand),
    capacity: r.capacity,
    maxRouteMinutes: r.maxRouteMinutes,
    serviceMinutes: r.serviceMinutes,
  };
  const naive = nearestNeighborPlan(problem);
  const best = solve(problem);
  const response: SolveResponse = { best, naive, ms: performance.now() - t0 };
  self.postMessage(response);
};
