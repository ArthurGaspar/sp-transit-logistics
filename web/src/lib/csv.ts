import type { ScenarioPoint } from "../data";

export interface ParseResult {
  points: ScenarioPoint[];
  errors: string[];
}

const LAT = ["lat", "latitude"];
const LON = ["lon", "lng", "long", "longitude"];
const DEMAND = ["demand", "demanda", "qty", "quantidade", "volumes"];
const NAME = ["name", "nome", "id", "cliente"];

/**
 * Parses delivery points from CSV text. Accepts comma or semicolon separators,
 * Brazilian decimal commas when the separator is a semicolon, and an optional
 * header row; without a header the column order is lat, lon, demand, name.
 */
export function parseDeliveryCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { points: [], errors: ["The file is empty."] };

  const sep = lines[0].includes(";") ? ";" : ",";
  const num = (s: string | undefined) => (s === undefined ? NaN : Number(sep === ";" ? s.replace(",", ".") : s));
  const cells = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));

  const header = cells[0].map((h) => h.toLowerCase());
  const hasHeader = !Number.isFinite(num(cells[0][0])) || !Number.isFinite(num(cells[0][1]));
  const col = (names: string[], fallback: number) => {
    const i = header.findIndex((h) => names.includes(h));
    return hasHeader ? i : fallback;
  };
  const [iLat, iLon, iDemand, iName] = [col(LAT, 0), col(LON, 1), col(DEMAND, 2), col(NAME, 3)];
  if (hasHeader && (iLat < 0 || iLon < 0)) {
    return { points: [], errors: ["The header needs both a latitude and a longitude column."] };
  }

  const points: ScenarioPoint[] = [];
  const errors: string[] = [];
  cells.slice(hasHeader ? 1 : 0).forEach((row, k) => {
    const line = k + (hasHeader ? 2 : 1);
    const lat = num(row[iLat]);
    const lon = num(row[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      errors.push(`Line ${line}: invalid coordinates.`);
      return;
    }
    const demand = iDemand >= 0 ? num(row[iDemand]) : NaN;
    points.push({
      lat,
      lon,
      demand: Number.isFinite(demand) && demand > 0 ? demand : 1,
      name: (iName >= 0 && row[iName]) || `Drop ${points.length + 1}`,
    });
  });
  return { points, errors };
}
