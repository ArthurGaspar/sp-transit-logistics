/**
 * Capacitated vehicle routing with a shift-length limit, solved in the browser.
 *
 * 1. Clarke-Wright savings builds an initial set of routes.
 * 2. Local search improves it until no move helps: 2-opt inside each route,
 *    then relocating or swapping stops between routes.
 *
 * Index 0 of the matrices is the depot; stop i of the input is index i + 1.
 * The objective is total driving minutes, so a speed field that varies by area
 * changes the plan, not just its reported duration.
 */

export interface VrpProblem {
  /** Driving minutes between every pair of locations, depot first. */
  minutes: number[][];
  /** Road kilometers between every pair of locations, depot first. */
  km: number[][];
  /** Demand of each stop (length n, without the depot). */
  demand: number[];
  capacity: number;
  /** Maximum minutes per route including service time; Infinity for none. */
  maxRouteMinutes: number;
  serviceMinutes: number;
}

export interface VrpRoute {
  /** Stop indices into the input (0-based, depot excluded). */
  stops: number[];
  km: number;
  minutes: number;
  load: number;
}

export interface VrpSolution {
  routes: VrpRoute[];
  km: number;
  minutes: number;
  /** Stops that cannot be served at all (over capacity or too far for one shift). */
  unassigned: number[];
}

type Seq = number[]; // matrix indices (1..n), depot implicit at both ends

function driveMinutes(p: VrpProblem, seq: Seq): number {
  let t = 0;
  let prev = 0;
  for (const s of seq) {
    t += p.minutes[prev][s];
    prev = s;
  }
  return t + p.minutes[prev][0];
}

function routeKm(p: VrpProblem, seq: Seq): number {
  let d = 0;
  let prev = 0;
  for (const s of seq) {
    d += p.km[prev][s];
    prev = s;
  }
  return d + p.km[prev][0];
}

const load = (p: VrpProblem, seq: Seq) => seq.reduce((sum, s) => sum + p.demand[s - 1], 0);
const shift = (p: VrpProblem, seq: Seq) => driveMinutes(p, seq) + seq.length * p.serviceMinutes;
const feasible = (p: VrpProblem, seq: Seq) =>
  load(p, seq) <= p.capacity && shift(p, seq) <= p.maxRouteMinutes + 1e-9;

function toSolution(p: VrpProblem, routes: Seq[], unassigned: number[]): VrpSolution {
  const out = routes
    .filter((r) => r.length > 0)
    .map((seq) => ({
      stops: seq.map((s) => s - 1),
      km: routeKm(p, seq),
      minutes: shift(p, seq),
      load: load(p, seq),
    }));
  return {
    routes: out,
    km: out.reduce((s, r) => s + r.km, 0),
    minutes: out.reduce((s, r) => s + r.minutes, 0),
    unassigned,
  };
}

function servable(p: VrpProblem): { ok: number[]; unassigned: number[] } {
  const ok: number[] = [];
  const unassigned: number[] = [];
  for (let i = 1; i <= p.demand.length; i++) {
    (feasible(p, [i]) ? ok : unassigned).push(i);
  }
  return { ok, unassigned: unassigned.map((i) => i - 1) };
}

/**
 * Baseline for comparison, close to what a dispatcher would do by hand: from the
 * current position, always drive to the nearest unvisited stop that still fits
 * in the van and the shift; when none fits, return to the depot and start a new van.
 */
export function nearestNeighborPlan(p: VrpProblem): VrpSolution {
  const { ok, unassigned } = servable(p);
  const left = new Set(ok);
  const routes: Seq[] = [];
  while (left.size) {
    const route: Seq = [];
    let at = 0;
    for (;;) {
      let next = -1;
      for (const s of left) {
        if ((next < 0 || p.minutes[at][s] < p.minutes[at][next]) && feasible(p, [...route, s])) next = s;
      }
      if (next < 0) break;
      route.push(next);
      left.delete(next);
      at = next;
    }
    routes.push(route);
  }
  return toSolution(p, routes, unassigned);
}

/** Savings s_ij = t_i0 + t_0j - lambda * t_ij; lambda shapes routes from radial (low) to circumferential (high). */
function clarkeWright(p: VrpProblem, stops: number[], lambda: number): Seq[] {
  const routeOf = new Map<number, Seq>();
  for (const s of stops) routeOf.set(s, [s]);

  const savings: [number, number, number][] = [];
  for (let a = 0; a < stops.length; a++) {
    for (let b = a + 1; b < stops.length; b++) {
      const i = stops[a];
      const j = stops[b];
      savings.push([p.minutes[i][0] + p.minutes[0][j] - lambda * p.minutes[i][j], i, j]);
    }
  }
  savings.sort((x, y) => y[0] - x[0]);

  for (const [saving, i, j] of savings) {
    if (saving <= 0) break;
    const ri = routeOf.get(i)!;
    const rj = routeOf.get(j)!;
    if (ri === rj) continue;
    // Only route ends can be joined; orient both so i is a tail and j is a head.
    let left: Seq | null = null;
    let right: Seq | null = null;
    if (ri[ri.length - 1] === i && rj[0] === j) [left, right] = [ri, rj];
    else if (rj[rj.length - 1] === j && ri[0] === i) [left, right] = [rj, ri];
    else if (ri[0] === i && rj[0] === j) [left, right] = [[...ri].reverse(), rj];
    else if (ri[ri.length - 1] === i && rj[rj.length - 1] === j) [left, right] = [ri, [...rj].reverse()];
    if (!left || !right) continue;
    const merged = [...left, ...right];
    if (!feasible(p, merged)) continue;
    for (const s of merged) routeOf.set(s, merged);
  }
  return [...new Set(routeOf.values())];
}

function twoOpt(p: VrpProblem, seq: Seq): boolean {
  let improved = false;
  let again = true;
  while (again) {
    again = false;
    const full = [0, ...seq, 0];
    for (let a = 0; a < full.length - 3; a++) {
      for (let b = a + 2; b < full.length - 1; b++) {
        const delta =
          p.minutes[full[a]][full[b]] + p.minutes[full[a + 1]][full[b + 1]] -
          p.minutes[full[a]][full[a + 1]] - p.minutes[full[b]][full[b + 1]];
        if (delta < -1e-9) {
          const reversed = full.slice(a + 1, b + 1).reverse();
          full.splice(a + 1, reversed.length, ...reversed);
          seq.splice(0, seq.length, ...full.slice(1, -1));
          again = improved = true;
        }
      }
    }
  }
  return improved;
}

/** Best feasible insertion of stop s into route r; returns [position, added minutes]. */
function bestInsertion(p: VrpProblem, r: Seq, s: number): [number, number] | null {
  let best: [number, number] | null = null;
  const base = driveMinutes(p, r);
  for (let pos = 0; pos <= r.length; pos++) {
    const cand = [...r.slice(0, pos), s, ...r.slice(pos)];
    if (!feasible(p, cand)) continue;
    const added = driveMinutes(p, cand) - base;
    if (!best || added < best[1]) best = [pos, added];
  }
  return best;
}

function relocate(p: VrpProblem, routes: Seq[]): boolean {
  for (let a = 0; a < routes.length; a++) {
    for (let k = 0; k < routes[a].length; k++) {
      const s = routes[a][k];
      const without = [...routes[a].slice(0, k), ...routes[a].slice(k + 1)];
      const removed = driveMinutes(p, routes[a]) - driveMinutes(p, without);
      for (let b = 0; b < routes.length; b++) {
        if (b === a) continue;
        const ins = bestInsertion(p, routes[b], s);
        if (ins && ins[1] < removed - 1e-9) {
          routes[b].splice(ins[0], 0, s);
          routes[a] = without;
          return true;
        }
      }
    }
  }
  return false;
}

function swap(p: VrpProblem, routes: Seq[]): boolean {
  for (let a = 0; a < routes.length; a++) {
    for (let b = a + 1; b < routes.length; b++) {
      const before = driveMinutes(p, routes[a]) + driveMinutes(p, routes[b]);
      for (let i = 0; i < routes[a].length; i++) {
        for (let j = 0; j < routes[b].length; j++) {
          const ra = [...routes[a]];
          const rb = [...routes[b]];
          [ra[i], rb[j]] = [rb[j], ra[i]];
          if (!feasible(p, ra) || !feasible(p, rb)) continue;
          if (driveMinutes(p, ra) + driveMinutes(p, rb) < before - 1e-9) {
            routes[a] = ra;
            routes[b] = rb;
            return true;
          }
        }
      }
    }
  }
  return false;
}

function localSearch(p: VrpProblem, routes: Seq[], deadline: number): Seq[] {
  while (performance.now() < deadline) {
    let changed = false;
    for (const r of routes) changed = twoOpt(p, r) || changed;
    if (relocate(p, routes) || swap(p, routes)) changed = true;
    for (let i = routes.length - 1; i >= 0; i--) if (routes[i].length === 0) routes.splice(i, 1);
    if (!changed) break;
  }
  return routes;
}

const SAVINGS_LAMBDAS = [1, 0.7, 1.3, 1.6];

/**
 * Multi-start: local search from Clarke-Wright with several lambdas and from the
 * nearest-neighbor plan, keeping the plan with the fewest driving minutes.
 * Starting from nearest-neighbor guarantees the result is never worse than it.
 * Each start gets an equal share of `budgetMs`.
 */
export function solve(p: VrpProblem, budgetMs = 2000): VrpSolution {
  const { ok, unassigned } = servable(p);
  const nn = nearestNeighborPlan(p).routes.map((r) => r.stops.map((s) => s + 1));
  const starts: (() => Seq[])[] = [...SAVINGS_LAMBDAS.map((l) => () => clarkeWright(p, ok, l)), () => nn];
  const share = budgetMs / starts.length;
  let best: Seq[] = [];
  let bestMinutes = Infinity;
  for (const start of starts) {
    const routes = localSearch(p, start(), performance.now() + share);
    const total = routes.reduce((t, r) => t + driveMinutes(p, r), 0);
    if (total < bestMinutes - 1e-9) [best, bestMinutes] = [routes, total];
  }
  return toSolution(p, best, unassigned);
}
