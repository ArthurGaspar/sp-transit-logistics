import { cellToBoundary } from "h3-js";
import type { Cells } from "../data";

/** One polygon feature per cell; `i` indexes back into the columnar Cells arrays. */
export function cellFeatures(cells: Cells, props: (i: number) => Record<string, unknown>): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cells.cell.map((c, i) => ({
      type: "Feature",
      id: i,
      properties: { i, ...props(i) },
      geometry: { type: "Polygon", coordinates: [cellToBoundary(c, true)] },
    })),
  };
}
