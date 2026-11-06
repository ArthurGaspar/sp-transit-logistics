import { useId } from "react";
import type { Scenario } from "../data";

export function WorkloadPlot({ scenario }: { scenario: Scenario }) {
  const id = useId().replace(/:/g, "");
  const locations = [scenario.depot, ...scenario.points];
  const minLon = Math.min(...locations.map((p) => p.lon));
  const minLat = Math.min(...locations.map((p) => p.lat));
  const width = Math.max(...locations.map((p) => p.lon)) - minLon || .01;
  const height = Math.max(...locations.map((p) => p.lat)) - minLat || .01;
  const scale = Math.min(390 / (width * .917), 220 / height);
  const project = (p: { lon: number; lat: number }) => [240 + (p.lon - minLon - width / 2) * .917 * scale, 145 - (p.lat - minLat - height / 2) * scale];
  const points = scenario.points.map(project);
  const depot = project(scenario.depot);
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (items: number[][]) => {
    const hull: number[][] = [];
    for (const p of items) { while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop(); hull.push(p); }
    return hull.slice(0, -1);
  };
  const hull = [...half(sorted), ...half([...sorted].reverse())];
  return <div className="route-print" role="img" aria-label={`${scenario.name}: ${scenario.points.length} delivery locations and depot. Polygon outlines the locations; it is not a route.`}>
    <div className="print-heading"><span>SP / ABC</span><span>WORKLOAD FOOTPRINT</span></div>
    <svg viewBox="0 0 480 290" aria-hidden="true">
      <defs><pattern id={id} width="40" height="46" patternUnits="userSpaceOnUse"><path d="M20 0 40 11.5V34.5L20 46 0 34.5V11.5Z" fill="none" stroke="currentColor" strokeWidth=".6" /></pattern></defs>
      <rect width="480" height="290" fill={`url(#${id})`} opacity=".2" />
      <polygon points={hull.map((p) => p.join(",")).join(" ")} className="footprint-fill" />
      {points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3.5" className="print-stop" />)}
      <rect x={depot[0] - 6} y={depot[1] - 6} width="12" height="12" className="print-hub" />
      <text x={depot[0] + 10} y={depot[1] - 10}>DEPOT</text>
    </svg>
    <div className="print-caption"><span><i /> Stop footprint</span><span>■ Depot · ● Stops · N ↑</span></div>
  </div>;
}
