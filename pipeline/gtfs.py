"""GTFS loading and per-trip / per-stop service metrics."""

from pathlib import Path

import h3
import numpy as np
import pandas as pd

from config import MAX_SPEED_KMH, MIN_SPEED_KMH, PEAK_END, PEAK_START

BUS_ROUTE_TYPE = 3
EARTH_RADIUS_KM = 6371.0088


def load(gtfs_dir: Path) -> dict[str, pd.DataFrame]:
    ids = {c: str for c in ("route_id", "trip_id", "stop_id", "shape_id", "service_id")}
    names = ["routes", "trips", "stops", "stop_times", "frequencies", "shapes"]
    return {n: pd.read_csv(gtfs_dir / f"{n}.txt", dtype=ids, skipinitialspace=True) for n in names}


def to_seconds(hhmmss: pd.Series) -> pd.Series:
    """GTFS times can exceed 24:00:00, so they are parsed manually."""
    parts = hhmmss.str.split(":", expand=True).astype(int)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(a))


def bus_trips(g: dict[str, pd.DataFrame]) -> pd.DataFrame:
    bus_routes = g["routes"].loc[g["routes"]["route_type"] == BUS_ROUTE_TYPE, "route_id"]
    return g["trips"][g["trips"]["route_id"].isin(bus_routes)]


def shape_cell_lengths(shapes: pd.DataFrame, res: int) -> pd.DataFrame:
    """Splits every shape into segments and sums segment length per H3 cell.

    Each segment is attributed to the cell containing its midpoint, which at
    resolution 8 (~460 m edges) and GTFS point spacing (~20-50 m) is exact
    enough. Returns columns shape_id, cell, km.
    """
    s = shapes.sort_values(["shape_id", "shape_pt_sequence"])
    same = s["shape_id"].to_numpy()[1:] == s["shape_id"].to_numpy()[:-1]
    lat, lon = s["shape_pt_lat"].to_numpy(), s["shape_pt_lon"].to_numpy()
    km = haversine_km(lat[:-1], lon[:-1], lat[1:], lon[1:])[same]
    mid_lat = ((lat[:-1] + lat[1:]) / 2)[same]
    mid_lon = ((lon[:-1] + lon[1:]) / 2)[same]
    cells = [h3.latlng_to_cell(a, b, res) for a, b in zip(mid_lat, mid_lon)]
    seg = pd.DataFrame({"shape_id": s["shape_id"].to_numpy()[:-1][same], "cell": cells, "km": km})
    return seg.groupby(["shape_id", "cell"], as_index=False)["km"].sum()


def trip_durations(g: dict[str, pd.DataFrame], trips: pd.DataFrame, shape_km: pd.Series) -> pd.DataFrame:
    """Scheduled end-to-end duration, length and average speed of each trip pattern."""
    st = g["stop_times"][g["stop_times"]["trip_id"].isin(trips["trip_id"])]
    secs = to_seconds(st["arrival_time"])
    span = secs.groupby(st["trip_id"]).agg(["min", "max"])
    out = trips[["trip_id", "route_id", "shape_id"]].set_index("trip_id")
    out["duration_min"] = (span["max"] - span["min"]) / 60
    out["length_km"] = out["shape_id"].map(shape_km)
    out["speed_kmh"] = out["length_km"] / (out["duration_min"] / 60)
    ok = out["speed_kmh"].between(MIN_SPEED_KMH, MAX_SPEED_KMH) & (out["duration_min"] > 5)
    return out[ok].reset_index()


def peak_buses_per_hour(frequencies: pd.DataFrame) -> pd.Series:
    """Departures per hour of each trip pattern during the weekday morning peak."""
    f = frequencies.copy()
    start, end = to_seconds(f["start_time"]), to_seconds(f["end_time"])
    p0, p1 = to_seconds(pd.Series([PEAK_START, PEAK_END]))
    overlap = (np.minimum(end, p1) - np.maximum(start, p0)).clip(lower=0)
    f["departures"] = overlap / f["headway_secs"]
    return f.groupby("trip_id")["departures"].sum() * 3600 / (p1 - p0)


def stop_cells(stops: pd.DataFrame, res: int) -> pd.Series:
    return pd.Series(
        [h3.latlng_to_cell(a, b, res) for a, b in zip(stops["stop_lat"], stops["stop_lon"])],
        index=stops["stop_id"],
    )
