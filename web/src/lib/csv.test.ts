import { describe, expect, it } from "vitest";
import { parseDeliveryCsv } from "./csv";

describe("parseDeliveryCsv", () => {
  it("reads a header in any column order", () => {
    const { points, errors } = parseDeliveryCsv("name,longitude,latitude,demand\nLoja A,-46.6,-23.5,3\n");
    expect(errors).toEqual([]);
    expect(points).toEqual([{ name: "Loja A", lon: -46.6, lat: -23.5, demand: 3 }]);
  });

  it("reads semicolons with decimal commas and no header", () => {
    const { points } = parseDeliveryCsv("-23,55;-46,63;2\n-23,56;-46,64");
    expect(points.map((p) => [p.lat, p.lon, p.demand])).toEqual([
      [-23.55, -46.63, 2],
      [-23.56, -46.64, 1],
    ]);
  });

  it("reports bad rows and keeps the good ones", () => {
    const { points, errors } = parseDeliveryCsv("lat,lon\n-23.5,-46.6\nabc,1\n-23.6,-46.7");
    expect(points).toHaveLength(2);
    expect(errors).toEqual(["Line 3: invalid coordinates."]);
  });

  it("rejects a header without coordinates", () => {
    expect(parseDeliveryCsv("name,demand\nA,1").errors).toHaveLength(1);
  });
});
