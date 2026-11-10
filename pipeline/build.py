"""Builds every static JSON file the web app reads.

    python pipeline/build.py            # uses cached downloads when present
    python pipeline/build.py --refresh  # re-downloads the GTFS feed
"""

import argparse
import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from shapely import contains_xy
from shapely.geometry import LineString, Point, mapping, shape

import fetch
import gtfs
import network
import population
import schedule_signal
import speed_model
from workloads import abcd_points, interleave
from config import ABC_BORDER_KM, ABC_MUNICIPALITIES, ABCD_MUNICIPALITIES, H3_RES, OUT_DIR, RANDOM_SEED, ROOT, SAO_PAULO

ACCESS_CODES = ["no_data", "remote", "low", "fair", "good"]
ROUTE_SIMPLIFY_DEG = 0.0003  # ~30 m
BOUNDARY_SIMPLIFY_DEG = 0.0005
ABC_GAPS_LISTED = 15


def _write(name: str, data) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1024:.0f} KB)")


def _boundaries_geojson(boundaries: dict) -> dict:
    features = []
    for code, b in boundaries.items():
        geom = shape(b["geometry"]).simplify(BOUNDARY_SIMPLIFY_DEG)
        features.append({
            "type": "Feature",
            "properties": {"code": code, "name": b["name"], "abc": code != SAO_PAULO["code"]},
            "geometry": mapping(geom),
        })
    return {"type": "FeatureCollection", "features": features}


def _route_shapes(g, cell_routes: pd.Series) -> tuple[dict, list[str]]:
    """One simplified shape per bus route (its longest trip pattern), flattened as [lon, lat, ...]."""
    served = sorted({r for rs in cell_routes for r in rs})
    trips = g["trips"][g["trips"]["route_id"].isin(served)]
    pts = g["shapes"][g["shapes"]["shape_id"].isin(trips["shape_id"])].sort_values(["shape_id", "shape_pt_sequence"])
    lengths = pts.groupby("shape_id").size()
    trips = trips.assign(n=trips["shape_id"].map(lengths)).sort_values("n", ascending=False)
    best = trips.drop_duplicates("route_id").set_index("route_id")["shape_id"]
    coords = {sid: grp[["shape_pt_lon", "shape_pt_lat"]].to_numpy() for sid, grp in pts.groupby("shape_id")}
    routes = g["routes"].set_index("route_id")

    out = {"id": [], "name": [], "line": []}
    for rid in served:
        line = LineString(coords[best[rid]]).simplify(ROUTE_SIMPLIFY_DEG)
        out["id"].append(rid)
        out["name"].append(str(routes.at[rid, "route_long_name"]))
        out["line"].append(np.round(np.asarray(line.coords), 5).ravel().tolist())
    return out, served


def _demo_scenarios(g, cells: pd.DataFrame, boundaries: dict) -> list[dict]:
    """Delivery scenarios sampled from public locations (SPTrans stops and IBGE boundaries)."""
    rng = np.random.default_rng(RANDOM_SEED)
    stops = g["stops"].copy()
    stop_cell = gtfs.stop_cells(stops, H3_RES)
    stops["cell"] = stop_cell.to_numpy()
    sp_cells = cells[cells["muni"] == SAO_PAULO["code"]]
    stops = stops[stops["cell"].isin(sp_cells["cell"])]
    sp_polygon = shape(boundaries[SAO_PAULO["code"]]["geometry"])
    stops = stops[contains_xy(sp_polygon, stops.stop_lon.round(5), stops.stop_lat.round(5))]

    def spread(cands: pd.DataFrame, n: int, min_km: float = 0.35) -> list[tuple[float, float]]:
        chosen = []
        for _, s in cands.sample(frac=1, random_state=int(rng.integers(1 << 30))).iterrows():
            if all(gtfs.haversine_km(s.stop_lat, s.stop_lon, a, b) >= min_km for a, b in chosen):
                chosen.append((round(s.stop_lat, 5), round(s.stop_lon, 5)))
            if len(chosen) == n:
                break
        return chosen

    def near(lat, lon, km):
        return stops[gtfs.haversine_km(stops["stop_lat"], stops["stop_lon"], lat, lon) <= km]

    abcd_distance = network.distance_to_abc_km(sp_cells, boundaries, ABCD_MUNICIPALITIES)
    border_stops = stops[stops["cell"].isin(sp_cells.loc[abcd_distance <= ABC_BORDER_KM, "cell"])]
    sp_drops = [(lat, lon, SAO_PAULO["name"]) for lat, lon in spread(border_stops, 8)]
    if len(sp_drops) != 8:
        raise ValueError("Expected eight São Paulo stops for the cross-border sample")

    def capital(points):
        return [(lat, lon, SAO_PAULO["name"]) for lat, lon in points]

    scenarios = [
        {
            "id": "abcd",
            "name": "ABCD: four-city delivery loop",
            "description": "Eight stops each in Santo André, São Bernardo do Campo, São Caetano do Sul and Diadema.",
            "depot": (-23.65538, -46.57101),
            "depotMunicipality": "São Bernardo do Campo",
            "points": interleave(abcd_points(boundaries, rng, 8)),
        },
        {
            "id": "abcd-sp",
            "name": "São Paulo ↔ ABCD",
            "description": "Six stops in each ABCD municipality plus eight in São Paulo near the ABCD border.",
            "depot": (-23.685, -46.622),
            "depotMunicipality": "Diadema",
            "points": interleave([*abcd_points(boundaries, rng, 6), sp_drops]),
        },
        {
            "id": "centro",
            "name": "Centro expandido",
            "description": "Barra Funda depot, 40 drops within 5 km of Praça da Sé.",
            "depot": (-23.5254, -46.6670),
            "depotMunicipality": SAO_PAULO["name"],
            "points": capital(spread(near(-23.5503, -46.6339, 5), 40)),
        },
        {
            "id": "zona-leste",
            "name": "Zona Leste: large fleet",
            "description": "Itaquera depot, 70 drops spread across the East Zone.",
            "depot": (-23.5427, -46.4710),
            "depotMunicipality": SAO_PAULO["name"],
            "points": capital(spread(near(-23.5450, -46.4900, 7), 70, min_km=0.5)),
        },
    ]
    for s in scenarios:
        lat, lon = s["depot"]
        city = next(city for city in [SAO_PAULO, *ABC_MUNICIPALITIES] if city["name"] == s["depotMunicipality"])
        if not shape(boundaries[city["code"]]["geometry"]).contains(Point(lon, lat)):
            raise ValueError(f"Depot outside {city['name']} in {s['id']}")
        s["points"] = [
            {"lat": lat, "lon": lon, "demand": int(rng.integers(1, 6)), "name": f"Drop {i + 1}", "municipality": city}
            for i, (lat, lon, city) in enumerate(s["points"])
        ]
        s["depot"] = {"lat": s["depot"][0], "lon": s["depot"][1]}
    return scenarios


def main(refresh: bool) -> None:
    print("1/5 fetching inputs")
    g = gtfs.load(fetch.fetch_gtfs(force=refresh))
    boundaries = fetch.fetch_boundaries()
    population_summary = population.load_population()

    print("2/5 access metrics per hexagon")
    cells = network.study_cells(boundaries)
    cells, cell_routes = network.access_metrics(g, cells)
    cells["abc_km"] = network.distance_to_abc_km(cells, boundaries).round(2)
    border = network.abc_border(cells)

    print("3/5 schedule signal analysis")
    trips = gtfs.bus_trips(g)
    cell_km = gtfs.shape_cell_lengths(g["shapes"][g["shapes"]["shape_id"].isin(trips["shape_id"])], H3_RES)
    durations = gtfs.trip_durations(g, trips, cell_km.groupby("shape_id")["km"].sum())
    signal = schedule_signal.analyze(g, durations, cell_km)

    print("4/5 speed model")
    card, speed_grid = speed_model.train(cells, speed_model.load_observations())
    print(f"  {card['status']}" + (f" ({card['have']})" if "have" in card else ""))

    print("5/5 writing outputs")
    routes, route_ids = _route_shapes(g, cell_routes)
    route_index = {r: i for i, r in enumerate(route_ids)}
    munis = [SAO_PAULO, *ABC_MUNICIPALITIES]
    muni_index = {m["code"]: i for i, m in enumerate(munis)}
    sp = cells["muni"] == SAO_PAULO["code"]

    _write("cells.json", {
        "res": H3_RES,
        "cell": cells["cell"].tolist(),
        "muni": cells["muni"].map(muni_index).tolist(),
        "busesPeak": cells["buses_peak"].tolist(),
        "routes": cells["routes"].tolist(),
        "nearestStopM": cells["nearest_stop_m"].tolist(),
        "nearestStop": cells["nearest_stop"].tolist(),
        "access": cells["access"].map(ACCESS_CODES.index).tolist(),
        "abcKm": cells["abc_km"].tolist(),
        "speedWeekday": None if speed_grid is None else speed_grid.tolist(),
    })
    study = set(cells["cell"])
    _write("cell-routes.json", {c: [route_index[r] for r in rs] for c, rs in cell_routes.items() if c in study})
    _write("routes.json", routes)
    _write("boundaries.json", _boundaries_geojson(boundaries))
    _write("scenarios.json", _demo_scenarios(g, cells, boundaries))

    gaps = cells[border & (cells["access"] == "low")].sort_values(["buses_peak", "nearest_stop_m"], ascending=[True, False])
    route_types = g["routes"]["route_type"]
    _write("meta.json", {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "feed": {"source": "SPTrans GTFS via Mobility Database (mdb-8)"},
        "municipalities": munis,
        "abcdMunicipalityCodes": [m["code"] for m in ABCD_MUNICIPALITIES],
        "population": population_summary,
        "accessCodes": ACCESS_CODES,
        "thresholds": {
            "lowBusesPerHour": network.LOW_BUSES_PER_HOUR,
            "goodBusesPerHour": network.GOOD_BUSES_PER_HOUR,
            "maxWalkToStopM": network.MAX_WALK_TO_STOP_M,
            "remoteStopM": network.REMOTE_STOP_M,
            "abcBorderKm": ABC_BORDER_KM,
        },
        "kpis": {
            "stops": int(len(g["stops"])),
            "busRoutes": int((route_types == gtfs.BUS_ROUTE_TYPE).sum()),
            "railRoutes": int(route_types.isin(network.RAIL_ROUTE_TYPES).sum()),
            "spLowShare": round(float((cells.loc[sp, "access"] == "low").mean()), 3),
            "spRemoteShare": round(float((cells.loc[sp, "access"] == "remote").mean()), 3),
            "borderCells": int(border.sum()),
            "borderLowShare": round(float((cells.loc[border, "access"] == "low").mean()), 3),
        },
        "abcBorderGaps": [
            {"cell": r.cell, "nearestStop": r.nearest_stop, "nearestStopM": int(r.nearest_stop_m),
             "busesPeak": float(r.buses_peak), "routes": int(r.routes), "abcKm": float(r.abc_km)}
            for r in gaps.head(ABC_GAPS_LISTED).itertuples()
        ],
        "scheduleSignal": signal,
        "speedModel": card,
    })


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--refresh", action="store_true", help="re-download the GTFS feed")
    main(parser.parse_args().refresh)
