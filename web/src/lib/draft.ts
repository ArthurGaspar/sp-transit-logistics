import type { ScenarioPoint } from "../data";

export interface PlanParams {
  capacity: number;
  shiftHours: number;
  serviceMinutes: number;
  circuity: number;
  constantKmh: number;
  speedMode: "constant" | "model";
  hour: number;
  vehicleFactor: number;
  costPerKm: number;
  costPerHour: number;
}

export const DEFAULT_PARAMS: PlanParams = {
  capacity: 30, shiftHours: 8, serviceMinutes: 5, circuity: 1.3,
  constantKmh: 20, speedMode: "constant", hour: 10, vehicleFactor: 1.3,
  costPerKm: 1.2, costPerHour: 35,
};

export interface Draft {
  version: 1;
  savedAt: string;
  scenarioId: string;
  depot: { lat: number; lon: number };
  points: ScenarioPoint[];
  params: PlanParams;
}

const KEY = "sptl-draft";

export function readDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? "null") as Draft | null;
    const coordinate = (p: { lat: number; lon: number }) => p && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180;
    if (!d || d.version !== 1 || !Number.isFinite(Date.parse(d.savedAt)) || typeof d.scenarioId !== "string" || !coordinate(d.depot)) return null;
    if (!Array.isArray(d.points) || d.points.length > 250 || !d.points.every((p) => coordinate(p) && Number.isFinite(p.demand) && p.demand > 0 && typeof p.name === "string")) return null;
    const p = d.params;
    if (!p || !Object.keys(DEFAULT_PARAMS).every((k) => k === "speedMode" || Number.isFinite(p[k as keyof PlanParams]))) return null;
    if (!["constant", "model"].includes(p.speedMode) || p.capacity < 1 || p.shiftHours < 1 || p.serviceMinutes < 0 || p.circuity < 1 || p.constantKmh < 8 || p.constantKmh > 45 || !Number.isInteger(p.hour) || p.hour < 0 || p.hour > 23 || p.vehicleFactor < 1 || p.vehicleFactor > 2 || p.costPerKm < 0 || p.costPerHour < 0) return null;
    return d;
  } catch { return null; }
}

export function saveDraft(draft: Draft): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(draft)); return true; }
  catch { return false; }
}

export function deleteDraft(): boolean {
  try { localStorage.removeItem(KEY); return true; }
  catch { return false; }
}

export function workspaceQuery() {
  return new URLSearchParams(window.location.hash.split("?")[1] ?? "");
}
