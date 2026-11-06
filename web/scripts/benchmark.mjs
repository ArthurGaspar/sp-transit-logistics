import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createServer } from "vite";

// Use Vite's TS loader so this exercises the same solver as the app.
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { solve, nearestNeighborPlan } = await server.ssrLoadModule("/src/lib/vrp.ts");
  const { buildMatrices, constantSpeed } = await server.ssrLoadModule("/src/lib/travel.ts");
  const scenarios = JSON.parse(await readFile(new URL("../public/data/scenarios.json", import.meta.url), "utf8"));
  const meta = JSON.parse(await readFile(new URL("../public/data/meta.json", import.meta.url), "utf8"));
  console.log(`Dataset built: ${meta.generatedAt}`);
  console.log("Capacity 30 boxes · shift 8h · service 5min/stop · speed 20km/h · detour 1.3");
  console.log("Synthetic delivery demand sampled from public locations; estimates, not operational savings.\n");
  console.log("| Scenario | Stops | Vans (baseline → solver) | Baseline km | Solver km | Distance reduction | Solve ms |");
  console.log("|---|---:|---:|---:|---:|---:|---:|");
  for (const scenario of scenarios) {
    const matrices = buildMatrices([scenario.depot, ...scenario.points], { circuity: 1.3, speedAt: constantSpeed(20) });
    const problem = { ...matrices, demand: scenario.points.map((p) => p.demand), capacity: 30, maxRouteMinutes: 480, serviceMinutes: 5 };
    const baseline = nearestNeighborPlan(problem);
    const start = performance.now();
    const best = solve(problem);
    const elapsed = performance.now() - start;
    const seen = best.routes.flatMap((r) => r.stops).concat(best.unassigned).sort((a, b) => a - b);
    assert.deepEqual(seen, problem.demand.map((_, i) => i), "Every stop accounted for exactly once");
    assert.equal(best.unassigned.length, 0, "Every demo stop served");
    for (const route of best.routes) {
      assert.ok(route.load <= problem.capacity, "Capacity respected");
      assert.ok(route.minutes <= problem.maxRouteMinutes + 1e-6, "Shift respected");
    }
    assert.ok(best.minutes <= baseline.minutes + 1e-6, "Driving-time objective no worse than baseline");
    const saved = baseline.km ? (1 - best.km / baseline.km) * 100 : 0;
    console.log(`| ${scenario.name} | ${scenario.points.length} | ${baseline.routes.length} → ${best.routes.length} | ${baseline.km.toFixed(1)} | ${best.km.toFixed(1)} | ${saved.toFixed(1)}% | ${elapsed.toFixed(0)} |`);
  }
} finally {
  await server.close();
}
