import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { DEMO_WORKLOAD, DEFAULT_SIMULATION, compareStrategies, POLICY_LABELS } = await server.ssrLoadModule("/src/lib/simulation.ts");
  const result = compareStrategies(DEMO_WORKLOAD, DEFAULT_SIMULATION);
  console.log("Synthetic experiment · identical jobs, fleet and event schedule for every strategy");
  console.log("Cost = km × R$2 + duty hours × R$30 + late minutes × R$2 + unserved orders × R$250\n");
  console.log("| Environment | Strategy | Delivered | Late min | Unserved | km | Replans | Score (R$) |");
  console.log("|---|---|---:|---:|---:|---:|---:|---:|");
  for (const [environment, runs] of [["Calm", result.calm], ["Disrupted", result.changed]]) {
    for (const run of runs) {
      assert.equal(run.delivered + run.unserved, DEMO_WORKLOAD.jobs.length);
      assert.equal(new Set(run.deliveries.map((d) => d.job)).size, run.delivered);
      assert.ok(run.deliveries.every((d) => d.at >= DEMO_WORKLOAD.jobs.find((j) => j.id === d.job).releaseAt));
      assert.ok(Number.isFinite(run.score));
      console.log(`| ${environment} | ${POLICY_LABELS[run.policy]} | ${run.delivered} | ${run.latenessMinutes.toFixed(1)} | ${run.unserved} | ${run.km.toFixed(1)} | ${run.replans} | ${run.score.toFixed(2)} |`);
    }
  }
  const fixedCalm = result.calm.find((r) => r.policy === "fixed");
  const fixedChanged = result.changed.find((r) => r.policy === "fixed");
  assert.ok(fixedCalm.score <= Math.min(...result.calm.map((r) => r.score)) + 1e-6, "Optimized fixed plan is initially a best strategy");
  assert.ok(Math.min(...result.changed.map((r) => r.score)) < fixedChanged.score - 1, "Initial winner loses after environment changes");
  assert.ok(result.changed.find((r) => r.policy === "adaptive").replans > 0, "Disrupted suffix is actually reoptimized");
  console.log("\nSuccess: initially efficient dispatch ceases to minimize the stated cost after disruptions.");
} finally { await server.close(); }
