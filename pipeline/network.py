"""Per-hexagon transit access metrics for São Paulo and the Grande ABC."""

import h3
import numpy as np
import pandas as pd
from shapely import transform
from shapely.geometry import Point, shape
from shapely.ops import unary_union
from sklearn.neighbors import BallTree

import gtfs
from config import ABC_BORDER_KM, ABC_MUNICIPALITIES, CITY_CENTER, H3_RES, SAO_PAULO

RAIL_ROUTE_TYPES = (1, 2)
# Access levels, by scheduled bus passes per hour within ~1 km (cell + first ring).
# Thresholds sit near the 20th percentile and the median of urban São Paulo hexagons.
LOW_BUSES_PER_HOUR = 60
GOOD_BUSES_PER_HOUR = 240
MAX_WALK_TO_STOP_M = 500
# Without population data, cells this far from any stop are assumed to be largely
# uninhabited (reservoirs, Atlantic forest, parks) and are kept out of gap rankings.
REMOTE_STOP_M = 1500
# Degree-to-km factors around latitude -23.6, for local planar distances.
KM_PER_DEG_LAT = 110.6
KM_PER_DEG_LON = 101.9


def study_cells(boundaries: dict) -> pd.DataFrame:
    """All H3 cells whose center falls inside São Paulo or an ABC municipality."""
    rows = []
    for code, b in boundaries.items():
        for cell in h3.geo_to_cells(b["geometry"], H3_RES):
            rows.append((cell, code))
    cells = pd.DataFrame(rows, columns=["cell", "muni"]).drop_duplicates("cell")
    latlng = np.array([h3.cell_to_latlng(c) for c in cells["cell"]])
    cells["lat"], cells["lon"] = latlng[:, 0], latlng[:, 1]
    return cells.reset_index(drop=True)


def _planar(geom):
    """Projects lon/lat to a local km plane (good to <1% across the study area)."""
    return transform(geom, lambda xy: xy * np.array([KM_PER_DEG_LON, KM_PER_DEG_LAT]))


def distance_to_abc_km(cells: pd.DataFrame, boundaries: dict) -> np.ndarray:
    abc = _planar(unary_union([shape(boundaries[m["code"]]["geometry"]) for m in ABC_MUNICIPALITIES]))
    return np.array([abc.distance(_planar(Point(lon, lat))) for lat, lon in zip(cells["lat"], cells["lon"])])


def _trips_by_cell(g, trip_ids: pd.Index, stop_cell: pd.Series) -> pd.DataFrame:
    st = g["stop_times"][g["stop_times"]["trip_id"].isin(trip_ids)][["trip_id", "stop_id"]]
    st = st.assign(cell=st["stop_id"].map(stop_cell)).dropna(subset=["cell"])
    return st[["cell", "trip_id"]].drop_duplicates()


def _ring_unique(cell_trips: pd.DataFrame, cells: pd.Series) -> pd.DataFrame:
    """Expands (cell, trip) pairs to every cell within one ring, deduplicated."""
    ring = pd.DataFrame(
        [(c, n) for c in cells for n in h3.grid_disk(c, 1)], columns=["cell", "source"]
    )
    return ring.merge(cell_trips.rename(columns={"cell": "source"}), on="source")[["cell", "trip_id"]].drop_duplicates()


def access_metrics(g: dict, cells: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """Returns the cells with access columns added, plus the bus routes serving each cell."""
    stops = g["stops"]
    stop_cell = gtfs.stop_cells(stops, H3_RES)
    routes = g["routes"].set_index("route_id")
    trips = g["trips"].set_index("trip_id")
    trip_type = trips["route_id"].map(routes["route_type"])
    peak = gtfs.peak_buses_per_hour(g["frequencies"])

    bus_trips = trip_type.index[trip_type == gtfs.BUS_ROUTE_TYPE]
    rail_trips = trip_type.index[trip_type.isin(RAIL_ROUTE_TYPES)]

    out = cells.copy()
    out["stops"] = out["cell"].map(stop_cell.value_counts()).fillna(0).astype(int)

    bus_ring = _ring_unique(_trips_by_cell(g, bus_trips, stop_cell), out["cell"])
    bus_ring["buses"] = bus_ring["trip_id"].map(peak).fillna(0)
    bus_ring["route_id"] = bus_ring["trip_id"].map(trips["route_id"])
    out["buses_peak"] = out["cell"].map(bus_ring.groupby("cell")["buses"].sum()).fillna(0).round(1)
    out["routes"] = out["cell"].map(bus_ring.groupby("cell")["route_id"].nunique()).fillna(0).astype(int)

    rail_stop_cells = set(_trips_by_cell(g, rail_trips, stop_cell)["cell"])
    out["rail"] = [any(n in rail_stop_cells for n in h3.grid_disk(c, 1)) for c in out["cell"]]

    tree = BallTree(np.radians(stops[["stop_lat", "stop_lon"]].to_numpy()), metric="haversine")
    dist, idx = tree.query(np.radians(out[["lat", "lon"]].to_numpy()), k=1)
    out["nearest_stop_m"] = (dist[:, 0] * gtfs.EARTH_RADIUS_KM * 1000).round().astype(int)
    out["nearest_stop"] = stops["stop_name"].to_numpy()[idx[:, 0]]

    out["dist_center_km"] = gtfs.haversine_km(out["lat"], out["lon"], *CITY_CENTER).round(2)
    out["access"] = classify_access(out["buses_peak"], out["nearest_stop_m"], out["rail"])
    out.loc[out["muni"] != SAO_PAULO["code"], "access"] = "no_data"

    cell_routes = bus_ring.groupby("cell")["route_id"].agg(lambda r: sorted(set(r)))
    return out, cell_routes


def classify_access(buses_peak: pd.Series, nearest_stop_m: pd.Series, rail: pd.Series) -> np.ndarray:
    good = (buses_peak >= GOOD_BUSES_PER_HOUR) | rail
    low = (buses_peak < LOW_BUSES_PER_HOUR) | (nearest_stop_m > MAX_WALK_TO_STOP_M)
    level = np.where(good & ~low, "good", np.where(low & ~rail, "low", "fair"))
    return np.where((nearest_stop_m > REMOTE_STOP_M) & ~rail, "remote", level)


def abc_border(cells: pd.DataFrame) -> pd.Series:
    return (cells["muni"] == SAO_PAULO["code"]) & (cells["abc_km"] <= ABC_BORDER_KM)
