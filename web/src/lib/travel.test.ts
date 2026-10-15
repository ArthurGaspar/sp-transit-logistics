import { latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import { haversineKm } from "./geo";
import { buildMatrices, cellSpeed, constantSpeed } from "./travel";

describe("haversineKm", () => {
  it("measures one degree of latitude as ~111.2 km", () => {
    expect(haversineKm({ lat: -23, lon: -46 }, { lat: -24, lon: -46 })).toBeCloseTo(111.19, 1);
  });
});

describe("buildMatrices", () => {
  it("applies circuity and constant speed", () => {
    const a = { lat: -23.55, lon: -46.63 };
    const b = { lat: -23.56, lon: -46.63 };
    const { km, minutes } = buildMatrices([a, b], { circuity: 1.5, speedAt: constantSpeed(30) });
    const straight = haversineKm(a, b);
    expect(km[0][1]).toBeCloseTo(straight * 1.5);
    expect(minutes[1][0]).toBeCloseTo((straight * 1.5 * 60) / 30);
    expect(minutes[0][0]).toBe(0);
  });
});

describe("cellSpeed", () => {
  const p = { lat: -23.55, lon: -46.63 };
  const cell = latLngToCell(p.lat, p.lon, 8);

  it("scales the cell's bus speed by the vehicle factor", () => {
    expect(cellSpeed(new Map([[cell, 12]]), 8, 1.5, 99)(p)).toBeCloseTo(18);
  });

  it("falls back when no nearby cell has data", () => {
    expect(cellSpeed(new Map(), 8, 1.5, 22)(p)).toBe(22);
  });
});
