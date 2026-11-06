import { describe, expect, it } from "vitest";
import { buildMatrices, constantSpeed } from "./travel";
import { nearestNeighborPlan, solve, type VrpProblem, type VrpSolution } from "./vrp";
import type { LatLon } from "./geo";

const depot: LatLon = { lat: -23.55, lon: -46.63 };

function problem(stops: LatLon[], opts: Partial<VrpProblem> & { demand?: number[] } = {}): VrpProblem {
  const { km, minutes } = buildMatrices([depot, ...stops], { circuity: 1.3, speedAt: constantSpeed(20) });
  return {
    km,
    minutes,
    demand: opts.demand ?? stops.map(() => 1),
    capacity: opts.capacity ?? 1000,
    maxRouteMinutes: opts.maxRouteMinutes ?? Infinity,
    serviceMinutes: opts.serviceMinutes ?? 0,
  };
}

function randomStops(n: number, seed: number): LatLon[] {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  return Array.from({ length: n }, () => ({ lat: depot.lat + (rand() - 0.5) * 0.15, lon: depot.lon + (rand() - 0.5) * 0.15 }));
}

function expectValid(p: VrpProblem, sol: VrpSolution) {
  const seen = sol.routes.flatMap((r) => r.stops).concat(sol.unassigned).sort((a, b) => a - b);
  expect(seen).toEqual(p.demand.map((_, i) => i));
  for (const r of sol.routes) {
    expect(r.load).toBeLessThanOrEqual(p.capacity);
    expect(r.minutes).toBeLessThanOrEqual(p.maxRouteMinutes + 1e-6);
  }
}

describe("solve", () => {
  it("visits every stop exactly once in a single uncapacitated route", () => {
    const p = problem(randomStops(12, 1));
    const sol = solve(p);
    expectValid(p, sol);
    expect(sol.routes).toHaveLength(1);
  });

  it("respects vehicle capacity", () => {
    const stops = randomStops(30, 2);
    const p = problem(stops, { demand: stops.map((_, i) => 1 + (i % 4)), capacity: 15 });
    const sol = solve(p);
    expectValid(p, sol);
    expect(sol.routes.length).toBeGreaterThanOrEqual(Math.ceil(p.demand.reduce((a, b) => a + b) / 15));
  });

  it("respects the shift limit including service time", () => {
    const p = problem(randomStops(25, 3), { maxRouteMinutes: 120, serviceMinutes: 5 });
    const sol = solve(p);
    expectValid(p, sol);
    expect(sol.routes.length).toBeGreaterThan(1);
  });

  it("reports stops that cannot fit in any route", () => {
    const p = problem([{ lat: -23.56, lon: -46.64 }, { lat: -23.57, lon: -46.62 }], { demand: [5, 50], capacity: 10 });
    const sol = solve(p);
    expect(sol.unassigned).toEqual([1]);
    expectValid(p, sol);
  });

  it("is never worse than nearest-neighbor dispatch", () => {
    for (const seed of [4, 5, 6, 7]) {
      const stops = randomStops(40, seed);
      const p = problem(stops, { demand: stops.map(() => 2), capacity: 20, serviceMinutes: 3, maxRouteMinutes: 240 });
      const naive = nearestNeighborPlan(p);
      const best = solve(p);
      expectValid(p, naive);
      expectValid(p, best);
      expect(best.minutes).toBeLessThanOrEqual(naive.minutes + 1e-6);
    }
  });

  it("handles an empty stop list", () => {
    const sol = solve(problem([]));
    expect(sol.routes).toEqual([]);
    expect(sol.km).toBe(0);
  });

  it("keeps the source route within its shift when a relocation removes a fast intermediate stop", () => {
    // Symmetric travel times can be non-metric when speeds vary by location.
    const minutes = [
      [0,32,7,36,55,47,24,4,74],
      [32,0,2,5,73,33,72,51,20],
      [7,2,0,29,24,24,3,34,9],
      [36,5,29,0,1,29,23,10,71],
      [55,73,24,1,0,21,18,60,54],
      [47,33,24,29,21,0,18,41,35],
      [24,72,3,23,18,18,0,70,14],
      [4,51,34,10,60,41,70,0,1],
      [74,20,9,71,54,35,14,1,0],
    ];
    const p: VrpProblem = { minutes, km: minutes, demand: Array(8).fill(1), capacity: 4, maxRouteMinutes: 120, serviceMinutes: 5 };
    const best = solve(p);
    expectValid(p, best);
    expect(best.unassigned).toEqual([7]);
    expect(best.minutes).toBeLessThanOrEqual(nearestNeighborPlan(p).minutes);
  });
});
