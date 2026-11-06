import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PARAMS, readDraft } from "./draft";

const valid = {
  version: 1, savedAt: "2026-11-06T12:00:00Z", scenarioId: "custom",
  depot: { lat: -23.62, lon: -46.55 },
  points: [{ lat: -23.6, lon: -46.5, demand: 4, name: "Delivery A" }],
  params: DEFAULT_PARAMS,
};

afterEach(() => vi.unstubAllGlobals());

describe("draft recovery", () => {
  it("restores a valid draft without discarding delivery demand", () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(valid) });
    expect(readDraft()?.points[0].demand).toBe(4);
  });

  it("rejects corrupted or incompatible drafts before they reach the solver", () => {
    for (const draft of ["invalid json", { ...valid, version: 2 }, { ...valid, points: [{ ...valid.points[0], lat: 120 }] }, { ...valid, params: { ...DEFAULT_PARAMS, constantKmh: 0 } }, { ...valid, params: { ...DEFAULT_PARAMS, hour: 3.5 } }]) {
      vi.stubGlobal("localStorage", { getItem: () => typeof draft === "string" ? draft : JSON.stringify(draft) });
      expect(readDraft()).toBeNull();
    }
  });

  it("keeps the workspace usable when browser storage is blocked", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("Storage blocked"); } });
    expect(readDraft()).toBeNull();
  });
});
