import type { Scenario } from "../data";
import type { LatLon } from "./geo";
import { buildMatrices, constantSpeed } from "./travel";
import { nearestNeighborPlan, solve } from "./vrp";

export const POLICIES = ["fixed", "nearest", "adaptive"] as const;
export type Policy = typeof POLICIES[number];
export const POLICY_LABELS: Record<Policy, string> = {
  fixed: "Keep optimized plan", nearest: "Nearest-neighbor dispatch", adaptive: "Partial reoptimization",
};
export interface DeliveryJob extends LatLon {
  id: string; name: string; demand: number; releaseAt: number; dueAt: number;
  municipality?: string;
}
export interface SimulationWorkload { name: string; depot: LatLon; jobs: DeliveryJob[] }
export interface SimulationSettings {
  vehicles: number; capacity: number; shiftMinutes: number; serviceMinutes: number;
  speedKmh: number; circuity: number; costPerKm: number; costPerHour: number;
  lateCostPerMinute: number; unservedCost: number; replanMinutes: number;
  eventAt: number; trafficFactor: number; delayMinutes: number;
  outageAt: number; outageMinutes: number; outageVehicle: number; delayJob: string;
}
export const DEFAULT_SIMULATION: SimulationSettings = {
  vehicles: 2, capacity: 16, shiftMinutes: 240, serviceMinutes: 5,
  speedKmh: 24, circuity: 1.3, costPerKm: 2, costPerHour: 30,
  lateCostPerMinute: 2, unservedCost: 250, replanMinutes: 2,
  eventAt: 12, trafficFactor: 2.5, delayMinutes: 25,
  outageAt: 25, outageMinutes: 45, outageVehicle: 0, delayJob: "job-0",
};
export interface SimulationEntry {
  at: number; type: "depart" | "deliver" | "return" | "release" | "traffic" | "delay" | "outage" | "recovery" | "replan" | "unserved";
  detail: string; vehicle?: number; job?: string; cargo?: number; before?: string[]; after?: string[];
}
export interface Activity {
  from: number; to: number; vehicle: number; kind: "travel" | "service" | "pause" | "coordination";
}
export interface SimulationResult {
  policy: Policy; delivered: number; onTime: number; late: number; unserved: number;
  latenessMinutes: number; km: number; dutyMinutes: number; overtimeMinutes: number;
  operatingCost: number; penaltyCost: number; score: number; replans: number;
  deliveries: { job: string; vehicle: number; at: number; dueAt: number }[];
  initialRoutes: string[][]; entries: SimulationEntry[]; activity: Activity[];
}
type Action = { kind: "travel" | "service" | "coordination"; remaining: number; target?: number };
type Van = {
  id: number; at: number; queue: number[]; cargo: number; action?: Action;
  unavailableUntil: number; dirty: boolean; started?: number; returned?: number;
};
type Event = { at: number; type: "release" | "traffic" | "delay" | "outage" | "recovery"; job?: number };
const EPS = 1e-7;

/** Public locations and synthetic deadlines; no observed operational outcomes. */
export function simulationWorkload(scenario: Scenario): SimulationWorkload {
  return {
    name: scenario.name, depot: scenario.depot,
    jobs: scenario.points.slice(0, 24).map((p, i) => ({
      ...p, id: `job-${i}`, releaseAt: i >= 20 ? 40 : 0, dueAt: 75 + (i % 4) * 25,
    })),
  };
}

/** Small, fully specified synthetic experiment around São Paulo. */
export const DEMO_WORKLOAD: SimulationWorkload = {
  name: "Disruption experiment · São Paulo",
  depot: { lat: -23.55, lon: -46.63 },
  jobs: [
    [-0.012, 0.028, 240], [0.028, 0.013, 240], [0.012, 0.047, 240],
    [-0.032, 0.041, 56], [-0.021, -0.038, 240], [0.031, -0.026, 240],
    [0.046, -0.007, 240], [-0.04, -0.014, 240], [0.004, 0.018, 240],
  ].map(([lat, lon, dueAt], i) => ({
    lat: -23.55 + lat, lon: -46.63 + lon, dueAt, id: `job-${i}`,
    name: i === 8 ? "New order" : `Delivery ${i + 1}`, demand: 3, releaseAt: i === 8 ? 40 : 0,
  })),
};

function validate(w: SimulationWorkload, s: SimulationSettings, severity: number) {
  if (!w.jobs.length || w.jobs.length > 24 || new Set(w.jobs.map((j) => j.id)).size !== w.jobs.length)
    throw new Error("Use 1–24 jobs with unique identifiers.");
  if (![w.depot, ...w.jobs].every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180))
    throw new Error("Delivery coordinates are invalid.");
  if (Object.values(s).some((v) => typeof v === "number" && !Number.isFinite(v)) || !Number.isFinite(severity) || severity < 0)
    throw new Error("Simulation settings must be finite.");
  if (!Number.isInteger(s.vehicles) || s.vehicles < 1 || s.vehicles > 8 || s.capacity <= 0 || s.shiftMinutes <= 0 || s.speedKmh <= 0 || s.circuity < 1 || s.trafficFactor < 1)
    throw new Error("Check fleet, capacity, shift and travel settings.");
  if ([s.serviceMinutes, s.costPerKm, s.costPerHour, s.lateCostPerMinute, s.unservedCost, s.replanMinutes, s.eventAt, s.delayMinutes, s.outageAt, s.outageMinutes].some((v) => v < 0) || !Number.isInteger(s.outageVehicle) || s.outageVehicle < 0 || s.outageVehicle >= s.vehicles)
    throw new Error("Event times, costs and durations must be non-negative; choose an existing vehicle.");
  if (!w.jobs.some((j) => j.id === s.delayJob) || w.jobs.some((j) => !Number.isFinite(j.demand) || j.demand <= 0 || !Number.isFinite(j.releaseAt) || j.releaseAt < 0 || !Number.isFinite(j.dueAt) || j.dueAt < j.releaseAt))
    throw new Error("Check order demand, release times, deadlines and the delayed delivery.");
}

/** Deterministic discrete-event model. No policy can see future disruptions.
 * A leg already departed is committed. Outages pause it, then resume it.
 * Parcels stay on their van; only unvisited stops on that van can be reordered.
 * New orders remain at the depot until an available van returns to reload.
 */
export function simulate(w: SimulationWorkload, s: SimulationSettings, policy: Policy, severity = 1): SimulationResult {
  validate(w, s, severity);
  const { km, minutes } = buildMatrices([w.depot, ...w.jobs], { circuity: s.circuity, speedAt: constantSpeed(s.speedKmh) });
  const jobs = w.jobs;
  const initial = jobs.map((_, i) => i).filter((i) => jobs[i].releaseAt === 0);
  const subset = [0, ...initial.map((i) => i + 1)];
  const problem = {
    km: subset.map((i) => subset.map((j) => km[i][j])),
    minutes: subset.map((i) => subset.map((j) => minutes[i][j])),
    demand: initial.map((i) => jobs[i].demand), capacity: s.capacity,
    maxRouteMinutes: s.shiftMinutes, serviceMinutes: s.serviceMinutes,
  };
  // At most 24 jobs. Infinity lets finite local search converge rather than
  // making the experiment depend on machine speed or a wall-clock timeout.
  const plan = policy === "nearest" ? nearestNeighborPlan(problem) : solve(problem, Infinity);
  const tours = plan.routes.map((r) => r.stops.map((i) => initial[i]));
  const vans: Van[] = Array.from({ length: s.vehicles }, (_, id) => ({
    id, at: 0, queue: tours[id] ?? [], cargo: 0, unavailableUntil: 0, dirty: false,
  }));
  const initialRoutes = vans.map((v) => v.queue.map((i) => jobs[i].id));
  const assigned = new Set(vans.flatMap((v) => v.queue));
  const backlog = new Set(initial.filter((i) => !assigned.has(i)));
  const completed = new Set<number>();
  const failed = new Set<number>();
  const extraService = new Map<number, number>();
  const entries: SimulationEntry[] = [];
  const activity: Activity[] = [];
  const deliveries: SimulationResult["deliveries"] = [];
  let now = 0, traffic = 1, distance = 0, replans = 0;
  const delayIndex = jobs.findIndex((j) => j.id === s.delayJob);
  const events: Event[] = jobs.map((j, i) => ({ at: j.releaseAt, type: "release", job: i }));
  if (severity > 0) {
    if (s.trafficFactor > 1) events.push({ at: s.eventAt, type: "traffic" });
    if (s.delayMinutes > 0) events.push({ at: s.eventAt, type: "delay", job: delayIndex });
    if (s.outageMinutes > 0) events.push({ at: s.outageAt, type: "outage" }, { at: s.outageAt + s.outageMinutes * severity, type: "recovery" });
  }
  events.sort((a, b) => a.at - b.at); // Stable: release, traffic, delay, outage, recovery.
  let eventIndex = 0;
  const travel = (a: number, b: number) => minutes[a][b] * ((a !== b && ((a ? jobs[a - 1].lon : w.depot.lon) + (b ? jobs[b - 1].lon : w.depot.lon)) / 2 >= w.depot.lon) ? traffic : 1);
  const service = (i: number) => s.serviceMinutes + (extraService.get(i) ?? 0);
  const log = (e: Omit<SimulationEntry, "at">) => entries.push({ at: now, ...e });
  const markDirty = (predicate: (v: Van) => boolean) => {
    if (policy === "adaptive") vans.filter(predicate).forEach((v) => { v.dirty = true; });
  };
  const routeScore = (v: Van, sequence: number[], start: number) => {
    let t = start, at = v.at, score = 0;
    for (const i of sequence) {
      t += travel(at, i + 1) + service(i);
      score += km[at][i + 1] * s.costPerKm + Math.max(0, t - jobs[i].dueAt) * s.lateCostPerMinute;
      if (t + travel(i + 1, 0) > s.shiftMinutes + EPS) score += s.unservedCost;
      at = i + 1;
    }
    t += travel(at, 0);
    return score + km[at][0] * s.costPerKm + (t - now) * s.costPerHour / 60;
  };
  function repair(v: Van) {
    v.dirty = false;
    if (v.queue.length < 2) return;
    const before = [...v.queue];
    let best = [...before], score = routeScore(v, before, now);
    const candidates = [
      [...before].sort((a, b) => jobs[a].dueAt - jobs[b].dueAt || a - b),
      [...before].sort((a, b) => travel(v.at, a + 1) - travel(v.at, b + 1) || a - b),
    ];
    for (const candidate of candidates) {
      const value = routeScore(v, candidate, now + s.replanMinutes);
      if (value < score - EPS) { best = candidate; score = value; }
    }
    // Bounded relocate search over the unvisited suffix only.
    for (let pass = 0; pass < 8; pass++) {
      let improved = false;
      for (let a = 0; a < best.length; a++) for (let b = 0; b < best.length; b++) {
        if (a === b) continue;
        const candidate = [...best];
        candidate.splice(b, 0, candidate.splice(a, 1)[0]);
        const value = routeScore(v, candidate, now + s.replanMinutes);
        if (value < score - EPS) { best = candidate; score = value; improved = true; }
      }
      if (!improved) break;
    }
    if (best.some((job, i) => job !== before[i])) {
      v.queue = best;
      replans++;
      log({ type: "replan", vehicle: v.id, detail: "Reordered unvisited deliveries; cargo stays on this van.", before: before.map((i) => jobs[i].id), after: best.map((i) => jobs[i].id) });
      v.action = { kind: "coordination", remaining: s.replanMinutes };
    }
  }
  function depart(v: Van, target: number) {
    if (v.started === undefined) v.started = now;
    distance += km[v.at][target];
    v.action = { kind: "travel", target, remaining: travel(v.at, target) };
    log({ type: "depart", vehicle: v.id, cargo: v.cargo, job: target ? jobs[target - 1].id : undefined, detail: target ? `To ${jobs[target - 1].name}` : "Return to depot" });
  }
  function load(v: Van) {
    const candidates = [...backlog].sort((a, b) => policy === "adaptive"
      ? jobs[a].dueAt - jobs[b].dueAt || a - b
      : policy === "nearest" ? travel(0, a + 1) - travel(0, b + 1) || a - b
        : jobs[a].releaseAt - jobs[b].releaseAt || a - b);
    let cargo = 0;
    for (const i of candidates) {
      if (cargo + jobs[i].demand > s.capacity || now + travel(0, i + 1) + service(i) + travel(i + 1, 0) > s.shiftMinutes + EPS) continue;
      v.queue.push(i); cargo += jobs[i].demand; backlog.delete(i);
    }
    v.cargo = cargo;
    if (policy === "adaptive" && v.queue.length > 1) v.dirty = true;
  }
  // Initial parcels are loaded once; later loading only occurs at the depot.
  for (const v of vans) v.cargo = v.queue.reduce((sum, i) => sum + jobs[i].demand, 0);
  for (let iteration = 0; iteration < 20000; iteration++) {
    // Completions at a timestamp precede exogenous events at that timestamp.
    for (const v of vans) if (v.action && v.action.remaining <= EPS) {
      const action = v.action;
      v.action = undefined;
      if (action.kind === "travel") {
        v.at = action.target!;
        if (v.at === 0) { v.returned = now; v.cargo = 0; log({ type: "return", vehicle: v.id, detail: "At depot" }); }
        else v.action = { kind: "service", remaining: service(v.at - 1), target: v.at };
      } else if (action.kind === "service") {
        const i = v.at - 1;
        completed.add(i); v.queue = v.queue.filter((j) => j !== i); v.cargo -= jobs[i].demand;
        deliveries.push({ job: jobs[i].id, vehicle: v.id, at: now, dueAt: jobs[i].dueAt });
        log({ type: "deliver", vehicle: v.id, job: jobs[i].id, detail: `${jobs[i].name} · ${now > jobs[i].dueAt + EPS ? "late" : "on time"}` });
      }
    }
    while (eventIndex < events.length && events[eventIndex].at <= now + EPS) {
      const event = events[eventIndex++];
      if (event.type === "release") {
        const i = event.job!;
        if (jobs[i].releaseAt > 0) backlog.add(i);
        log({ type: "release", job: jobs[i].id, detail: `${jobs[i].name} available at depot` });
      } else if (event.type === "traffic") {
        traffic = 1 + (s.trafficFactor - 1) * severity;
        markDirty((v) => v.queue.length > 0);
        log({ type: "traffic", detail: `East-side travel ×${traffic.toFixed(2)} on future departures` });
      } else if (event.type === "delay") {
        const i = event.job!;
        if (!completed.has(i)) {
          const delay = s.delayMinutes * severity;
          extraService.set(i, (extraService.get(i) ?? 0) + delay);
          for (const v of vans) if (v.action?.kind === "service" && v.at === i + 1) v.action.remaining += delay;
          markDirty((v) => v.queue.includes(i));
          log({ type: "delay", job: jobs[i].id, detail: `${jobs[i].name}: +${delay.toFixed(1)} service minutes` });
        } else log({ type: "delay", job: jobs[i].id, detail: `${jobs[i].name} already delivered; delay has no effect` });
      } else {
        const v = vans[s.outageVehicle];
        if (event.type === "outage") {
          v.unavailableUntil = now + s.outageMinutes * severity;
          markDirty((van) => van.id === v.id && van.queue.length > 0);
          log({ type: "outage", vehicle: v.id, detail: `Vehicle paused for ${(s.outageMinutes * severity).toFixed(1)} min; cargo and current leg retained` });
        } else log({ type: "recovery", vehicle: v.id, detail: "Vehicle available again" });
      }
    }
    for (const v of vans) {
      if (v.action || v.unavailableUntil > now + EPS) continue;
      if (!v.queue.length && v.at === 0 && now < s.shiftMinutes) load(v);
      if (v.dirty && v.queue.length) { repair(v); if (v.action) continue; }
      // Known shift infeasibility is explicit; disruption in flight may cause overtime.
      while (v.queue.length && now + travel(v.at, v.queue[0] + 1) + service(v.queue[0]) + travel(v.queue[0] + 1, 0) > s.shiftMinutes + EPS) {
        const i = v.queue.shift()!;
        failed.add(i); log({ type: "unserved", vehicle: v.id, job: jobs[i].id, detail: `${jobs[i].name}: cannot deliver and return within shift` });
      }
      // An event at the depot can invalidate the loaded tour. Release that
      // depot capacity immediately so another feasible order is not stranded.
      if (!v.queue.length && v.at === 0 && backlog.size && now < s.shiftMinutes) {
        load(v);
        if (v.dirty && v.queue.length) { repair(v); if (v.action) continue; }
      }
      if (v.queue.length) depart(v, v.queue[0] + 1);
      else if (v.at !== 0) depart(v, 0);
    }
    if (vans.some((v) => v.action && v.action.remaining <= EPS)) continue;
    const nextTimes = vans.flatMap((v) => v.action ? [v.unavailableUntil > now + EPS ? v.unavailableUntil : now + v.action.remaining] : v.unavailableUntil > now + EPS ? [v.unavailableUntil] : []);
    if (eventIndex < events.length) nextTimes.push(events[eventIndex].at);
    if (!nextTimes.length) break;
    const next = Math.min(...nextTimes);
    if (next <= now + EPS) throw new Error("Simulation clock did not advance");
    for (const v of vans) if (v.action) {
      const paused = v.unavailableUntil > now + EPS;
      activity.push({ from: now, to: next, vehicle: v.id, kind: paused ? "pause" : v.action.kind });
      if (!paused) v.action.remaining = Math.max(0, v.action.remaining - (next - now));
    }
    now = next;
    if (iteration === 19999) throw new Error("Simulation exceeded event limit");
  }
  for (let i = 0; i < jobs.length; i++) if (!completed.has(i) && !failed.has(i)) {
    log({ type: "unserved", job: jobs[i].id, detail: `${jobs[i].name}: no available capacity or shift time` });
  }
  const latenessMinutes = deliveries.reduce((sum, d) => sum + Math.max(0, d.at - d.dueAt), 0);
  const late = deliveries.filter((d) => d.at > d.dueAt + EPS).length;
  const dutyMinutes = vans.reduce((sum, v) => sum + (v.started === undefined ? 0 : (v.returned ?? now) - v.started), 0);
  const overtimeMinutes = vans.reduce((sum, v) => sum + (v.started === undefined ? 0 : Math.max(0, (v.returned ?? now) - s.shiftMinutes)), 0);
  const operatingCost = distance * s.costPerKm + dutyMinutes / 60 * s.costPerHour;
  const unserved = jobs.length - completed.size;
  const penaltyCost = latenessMinutes * s.lateCostPerMinute + unserved * s.unservedCost;
  return { policy, delivered: completed.size, onTime: completed.size - late, late, unserved, latenessMinutes,
    km: distance, dutyMinutes, overtimeMinutes, operatingCost, penaltyCost, score: operatingCost + penaltyCost,
    replans, deliveries, initialRoutes, entries, activity };
}

export interface SimulationComparison {
  calm: SimulationResult[]; changed: SimulationResult[];
  sweep: { severity: number; scores: Record<Policy, number> }[];
}
export function compareStrategies(w: SimulationWorkload, s: SimulationSettings): SimulationComparison {
  const calm = POLICIES.map((p) => simulate(w, s, p, 0));
  const changed = POLICIES.map((p) => simulate(w, s, p));
  return { calm, changed, sweep: [0, 0.25, 0.5, 0.75, 1, 1.5, 2].map((severity) => ({
    severity, scores: Object.fromEntries(POLICIES.map((p, i) => [p, severity === 0 ? calm[i].score : severity === 1 ? changed[i].score : simulate(w, s, p, severity).score])) as Record<Policy, number>,
  })) };
}
