"""Measures how much location-dependent speed information the GTFS schedule carries.

Short answer: almost none. This analysis is published in the app's model card
to explain why the speed model is trained on Olho Vivo GPS data instead.
"""

import h3
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import GroupKFold, cross_val_predict

import gtfs
from config import CITY_CENTER, RANDOM_SEED

CENTER_RADIUS_KM = 6


def _within_trip_correlation(g) -> float:
    """Median correlation between stop-to-stop distance and scheduled stop-to-stop time."""
    st = g["stop_times"].merge(g["stops"][["stop_id", "stop_lat", "stop_lon"]], on="stop_id")
    st = st.sort_values(["trip_id", "stop_sequence"])
    by_trip = st.groupby("trip_id")
    st["dt"] = gtfs.to_seconds(st["arrival_time"]).groupby(st["trip_id"]).diff()
    st["dk"] = gtfs.haversine_km(
        by_trip["stop_lat"].shift(), by_trip["stop_lon"].shift(), st["stop_lat"], st["stop_lon"]
    )
    st = st.dropna(subset=["dt", "dk"])
    corr = st.groupby("trip_id")[["dt", "dk"]].corr().xs("dt", level=1)["dk"]
    return float(corr.median())


def _r2(y, p) -> float:
    return float(1 - ((p - y) ** 2).sum() / ((y - y.mean()) ** 2).sum())


def analyze(g, trips: pd.DataFrame, cell_km: pd.DataFrame) -> dict:
    """trips: output of gtfs.trip_durations; cell_km: output of gtfs.shape_cell_lengths."""
    center_dist = {c: gtfs.haversine_km(*h3.cell_to_latlng(c), *CITY_CENTER) for c in cell_km["cell"].unique()}
    m = cell_km.assign(d=cell_km["cell"].map(center_dist))
    km = m.groupby("shape_id")["km"].sum()
    t = trips.copy()
    t["mean_dist_center_km"] = t["shape_id"].map((m["km"] * m["d"]).groupby(m["shape_id"]).sum() / km)
    t["center_share"] = t["shape_id"].map(m[m["d"] < CENTER_RADIUS_KM].groupby("shape_id")["km"].sum() / km).fillna(0)
    t["stops_per_km"] = t["trip_id"].map(g["stop_times"].groupby("trip_id").size()) / t["length_km"]

    feature_sets = {
        "location": ["mean_dist_center_km", "center_share"],
        "route_design": ["stops_per_km", "length_km"],
        "both": ["mean_dist_center_km", "center_share", "stops_per_km", "length_km"],
    }
    y = t["speed_kmh"].to_numpy()
    # Lines sharing a 4-digit prefix are variants of the same service; keep them in one fold.
    groups = t["route_id"].str[:4]
    scores = {}
    for name, cols in feature_sets.items():
        model = RandomForestRegressor(n_estimators=200, min_samples_leaf=5, random_state=RANDOM_SEED, n_jobs=-1)
        pred = cross_val_predict(model, t[cols], y, groups=groups, cv=GroupKFold(5))
        scores[name] = {"features": cols, "r2": round(_r2(y, pred), 3)}

    return {
        "trips": len(t),
        "mean_speed_kmh": round(float(y.mean()), 2),
        "median_speed_kmh": round(float(np.median(y)), 2),
        "within_trip_time_vs_distance_r": round(_within_trip_correlation(g), 3),
        "speed_vs_center_distance_r": round(float(np.corrcoef(y, t["mean_dist_center_km"])[0, 1]), 3),
        "cv_r2": scores,
    }
