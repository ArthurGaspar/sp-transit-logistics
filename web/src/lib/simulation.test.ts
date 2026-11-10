import { describe, expect, it } from "vitest";
import { buildMatrices, constantSpeed } from "./travel";
import { DEFAULT_SIMULATION, DEMO_WORKLOAD, POLICIES, compareStrategies, simulate,
  type SimulationSettings, type SimulationWorkload } from "./simulation";

const simple: SimulationWorkload = {
  name: "One delivery", depot: { lat: -23.55, lon: -46.63 },
  jobs: [{ id: "one", name: "One", lat: -23.55, lon: -46.59, demand: 2, releaseAt: 0, dueAt: 100 }],
};
const settings: SimulationSettings = {
  ...DEFAULT_SIMULATION, vehicles: 1, delayJob: "one", trafficFactor: 1,
  delayMinutes: 0, outageMinutes: 0, eventAt: 1, outageAt: 1,
};

describe("delivery event simulation", () => {
  it("demonstrates a ranking reversal without claiming adaptive is always the winner", () => {
    const result = compareStrategies(DEMO_WORKLOAD, DEFAULT_SIMULATION);
    expect(result.calm[0].score).toBeCloseTo(196.616, 2);
    expect(result.calm[0].score).toBeLessThan(result.calm[1].score);
    expect(result.calm[2].score).toBeCloseTo(result.calm[0].score, 8);
    expect(result.changed[1].score).toBeLessThan(result.changed[0].score);
    expect(result.changed[2].score).toBeLessThan(result.changed[0].score);
    expect(result.changed[1].score).toBeLessThan(result.changed[2].score);
    expect(result.changed[2].replans).toBeGreaterThan(0);
    expect(result.sweep.some((r) => r.scores.fixed > r.scores.nearest)).toBe(true);
  });

  it("reproduces identical event traces and scores", () => {
    expect(simulate(DEMO_WORKLOAD, DEFAULT_SIMULATION, "adaptive")).toEqual(simulate(DEMO_WORKLOAD, DEFAULT_SIMULATION, "adaptive"));
  });

  it("accounts for every order and capacity across all policies and intensities", () => {
    for (const policy of POLICIES) for (const severity of [0, 0.5, 1, 2]) {
      const run = simulate(DEMO_WORKLOAD, DEFAULT_SIMULATION, policy, severity);
      expect(run.delivered + run.unserved).toBe(DEMO_WORKLOAD.jobs.length);
      expect(new Set(run.deliveries.map((d) => d.job)).size).toBe(run.delivered);
      const unserved = run.entries.filter((e) => e.type === "unserved").map((e) => e.job);
      expect(new Set([...run.deliveries.map((d) => d.job), ...unserved]).size).toBe(DEMO_WORKLOAD.jobs.length);
      for (const entry of run.entries.filter((e) => e.type === "depart")) {
        expect(entry.cargo).toBeGreaterThanOrEqual(0);
        expect(entry.cargo).toBeLessThanOrEqual(DEFAULT_SIMULATION.capacity);
      }
    }
  });

  it("keeps finished deliveries, current work and parcel ownership when repairing a suffix", () => {
    const run = simulate(DEMO_WORKLOAD, DEFAULT_SIMULATION, "adaptive");
    for (const repair of run.entries.filter((e) => e.type === "replan")) {
      expect([...repair.before!].sort()).toEqual([...repair.after!].sort());
      expect(repair.after).not.toEqual(repair.before);
      const completed = run.deliveries.filter((d) => d.at <= repair.at).map((d) => d.job);
      expect(repair.after!.some((id) => completed.includes(id))).toBe(false);
      expect(run.activity.some((a) => a.kind === "coordination" && a.vehicle === repair.vehicle && a.from === repair.at)).toBe(true);
    }
    for (const [vehicle, route] of run.initialRoutes.entries()) {
      for (const job of route) expect(run.deliveries.find((d) => d.job === job)?.vehicle).toBe(vehicle);
    }
  });

  it("does not anticipate future disruptions", () => {
    const calm = simulate(DEMO_WORKLOAD, DEFAULT_SIMULATION, "adaptive", 0);
    const changed = simulate(DEMO_WORKLOAD, DEFAULT_SIMULATION, "adaptive");
    expect(calm.initialRoutes).toEqual(changed.initialRoutes);
    expect(changed.entries.filter((e) => e.at < DEFAULT_SIMULATION.eventAt)).toEqual(calm.entries.filter((e) => e.at < DEFAULT_SIMULATION.eventAt));
  });

  it("matches hand-calculated travel, service and cost for one delivery", () => {
    const matrices = buildMatrices([simple.depot, simple.jobs[0]], { circuity: settings.circuity, speedAt: constantSpeed(settings.speedKmh) });
    const run = simulate(simple, settings, "fixed");
    expect(run.km).toBeCloseTo(matrices.km[0][1] * 2, 8);
    expect(run.dutyMinutes).toBeCloseTo(matrices.minutes[0][1] * 2 + settings.serviceMinutes, 8);
    expect(run.score).toBeCloseTo(run.km * settings.costPerKm + run.dutyMinutes / 60 * settings.costPerHour, 8);
  });

  it("pauses an in-flight leg without teleporting, adding distance or double-counting work", () => {
    const base = simulate(simple, settings, "fixed");
    const run = simulate(simple, { ...settings, outageAt: 1, outageMinutes: 20 }, "fixed");
    expect(run.deliveries[0].at - base.deliveries[0].at).toBeCloseTo(20, 8);
    expect(run.dutyMinutes - base.dutyMinutes).toBeCloseTo(20, 8);
    expect(run.km).toBeCloseTo(base.km, 8);
    expect(run.activity.filter((a) => a.kind === "pause").reduce((sum, a) => sum + a.to - a.from, 0)).toBeCloseTo(20, 8);
  });

  it("applies changed traffic only to legs departed after the event", () => {
    const base = simulate(simple, settings, "fixed");
    const run = simulate(simple, { ...settings, trafficFactor: 3 }, "fixed");
    expect(run.deliveries[0].at).toBeCloseTo(base.deliveries[0].at, 8);
    expect(run.dutyMinutes).toBeGreaterThan(base.dutyMinutes);
    expect(run.km).toBe(base.km);
  });

  it("extends service already in progress once, and ignores a delay after delivery", () => {
    const base = simulate(simple, settings, "fixed");
    const during = base.deliveries[0].at - settings.serviceMinutes / 2;
    const delayed = simulate(simple, { ...settings, eventAt: during, delayMinutes: 10 }, "fixed");
    expect(delayed.deliveries[0].at).toBeCloseTo(base.deliveries[0].at + 10, 8);
    const after = simulate(simple, { ...settings, eventAt: base.deliveries[0].at + 1, delayMinutes: 10 }, "fixed");
    expect(after.deliveries).toEqual(base.deliveries);
    expect(after.score).toBeCloseTo(base.score, 8);
  });

  it("loads new orders only at the depot after release", () => {
    const workload = structuredClone(simple);
    workload.jobs.push({ ...simple.jobs[0], id: "new", name: "New", releaseAt: 10 });
    for (const policy of POLICIES) {
      const run = simulate(workload, settings, policy);
      expect(run.initialRoutes.flat()).not.toContain("new");
      const departed = run.entries.find((e) => e.type === "depart" && e.job === "new")!;
      const returned = run.entries.find((e) => e.type === "return")!;
      expect(departed.at).toBeGreaterThanOrEqual(returned.at);
      expect(departed.at).toBeGreaterThanOrEqual(10);
      expect(run.deliveries.find((d) => d.job === "new")!.at).toBeGreaterThan(departed.at);
    }
  });

  it("reports shift failures and overtime after an outage instead of inventing vehicles", () => {
    const workload = structuredClone(simple);
    workload.jobs.push({ ...simple.jobs[0], id: "two", name: "Two", lon: -46.58 });
    const run = simulate(workload, { ...settings, shiftMinutes: 60, outageAt: 1, outageMinutes: 120 }, "adaptive");
    expect(run.delivered).toBe(1);
    expect(run.unserved).toBe(1);
    expect(run.overtimeMinutes).toBeGreaterThan(0);
    expect(run.deliveries.every((d) => d.vehicle === 0)).toBe(true);
  });

  it("reports over-capacity orders and late-released orders as unserved", () => {
    const workload = structuredClone(simple);
    workload.jobs[0].demand = settings.capacity + 1;
    workload.jobs.push({ ...simple.jobs[0], id: "after-shift", releaseAt: 300, dueAt: 400 });
    const run = simulate(workload, settings, "adaptive");
    expect(run.delivered).toBe(0);
    expect(run.unserved).toBe(2);
    expect(run.km).toBe(0);
    expect(run.score).toBe(2 * settings.unservedCost);
  });

  it("uses a van still at the depot when an event invalidates its original loaded order", () => {
    const workload = structuredClone(simple);
    workload.jobs[0].demand = 4;
    workload.jobs.push({ ...simple.jobs[0], id: "two", name: "Two", demand: 2 });
    const run = simulate(workload, { ...settings, capacity: 4, shiftMinutes: 60, eventAt: 0, delayMinutes: 100 }, "fixed");
    expect(run.initialRoutes[0]).toEqual(["one"]);
    expect(run.deliveries.map((d) => d.job)).toEqual(["two"]);
    expect(run.unserved).toBe(1);
  });

  it("handles simultaneous completions, zero service and co-located stops", () => {
    const workload = structuredClone(simple);
    workload.jobs = [0, 1, 2].map((i) => ({ ...simple.jobs[0], ...simple.depot, id: `${i}` }));
    const run = simulate(workload, { ...settings, delayJob: "0", serviceMinutes: 0, capacity: 4 }, "adaptive");
    expect(run.delivered).toBe(3);
    expect(run.score).toBe(0);
    expect(run.deliveries.every((d) => d.at === 0)).toBe(true);
  });

  it("turns all disruption controls off without changing the workload", () => {
    const s = { ...DEFAULT_SIMULATION, trafficFactor: 1, delayMinutes: 0, outageMinutes: 0 };
    expect(simulate(DEMO_WORKLOAD, s, "adaptive", 1)).toEqual(simulate(DEMO_WORKLOAD, s, "adaptive", 0));
  });

  it("rejects invalid settings and ambiguous job identifiers", () => {
    expect(() => simulate(simple, { ...settings, vehicles: 1.5 }, "fixed")).toThrow();
    expect(() => simulate(simple, { ...settings, outageVehicle: 2 }, "fixed")).toThrow();
    expect(() => simulate(simple, { ...settings, serviceMinutes: NaN }, "fixed")).toThrow();
    expect(() => simulate({ ...simple, jobs: [simple.jobs[0], simple.jobs[0]] }, settings, "fixed")).toThrow();
  });
});
