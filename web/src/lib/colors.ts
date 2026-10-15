import type { AccessCode } from "../data";

/** Status palette: access levels are states, so they use reserved status colors plus a label. */
export const ACCESS_COLORS: Record<AccessCode, string> = {
  good: "#0ca30c",
  fair: "#fab219",
  low: "#d03b3b",
  remote: "#9a9992",
  no_data: "rgba(0,0,0,0)",
};

export const ACCESS_LABELS: Record<AccessCode, string> = {
  good: "Good",
  fair: "Fair",
  low: "Low",
  remote: "Remote (likely uninhabited)",
  no_data: "No open GTFS (ABC)",
};

/** Single-hue sequential ramp (blue), light to dark. */
export const SEQUENTIAL = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];

/**
 * Categorical slots for routes, in fixed order. Routes 9-16 reuse the slots with
 * a dashed line (composite encoding) instead of generating new hues.
 */
export const CATEGORICAL = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

export function routeStyle(index: number, dark: boolean): { color: string; dashed: boolean } {
  const slots = dark ? CATEGORICAL.dark : CATEGORICAL.light;
  return { color: slots[index % slots.length], dashed: Math.floor(index / slots.length) % 2 === 1 };
}

/** Quantile bin edges so each color step covers a similar number of cells. */
export function quantileEdges(values: number[], steps: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const edges: number[] = [];
  for (let i = 1; i < steps; i++) edges.push(sorted[Math.floor((i / steps) * (sorted.length - 1))]);
  return [...new Set(edges)];
}

export function binIndex(value: number, edges: number[]): number {
  let i = 0;
  while (i < edges.length && value >= edges[i]) i++;
  return i;
}
