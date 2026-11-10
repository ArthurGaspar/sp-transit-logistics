import { compareStrategies, type SimulationSettings, type SimulationWorkload } from "./simulation";

export interface SimulationRequest { requestId: number; workload: SimulationWorkload; settings: SimulationSettings }
self.onmessage = (e: MessageEvent<SimulationRequest>) => {
  const { requestId, workload, settings } = e.data;
  try { self.postMessage({ requestId, comparison: compareStrategies(workload, settings) }); }
  catch (error) { self.postMessage({ requestId, error: error instanceof Error ? error.message : "Simulation failed" }); }
};
