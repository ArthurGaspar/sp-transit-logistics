"""Trains the hour-of-day speed model from collected Olho Vivo aggregates.

Target: mean observed bus speed per (cell, hour, weekday/weekend).
Validation: spatial GroupKFold over H3 resolution-6 parents (~36 km²), so the
model is always scored on neighborhoods it never saw. It is compared with the
strongest cheap baseline: the network-wide mean speed for that hour.
"""

import h3
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import GroupKFold
from sklearn.neighbors import BallTree

from config import RANDOM_SEED, REALTIME_DIR, SAO_PAULO

MIN_SAMPLES_PER_ROW = 5
MIN_DAYS = 3
MIN_ROWS = 2000
CELL_FEATURES = ["lat", "lon", "dist_center_km", "buses_peak", "stops", "routes"]
FEATURES = [*CELL_FEATURES, "hour_sin", "hour_cos", "weekend"]
NEIGHBORS_FOR_FILL = 6


def load_observations(realtime_dir=REALTIME_DIR) -> pd.DataFrame | None:
    files = sorted(realtime_dir.glob("speeds-*.csv"))
    if not files:
        return None
    raw = pd.concat([pd.read_csv(f, dtype={"cell": str}) for f in files], ignore_index=True)
    raw["weekend"] = (raw["weekday"] >= 5).astype(int)
    agg = raw.groupby(["cell", "hour", "weekend"]).agg(
        n=("n", "sum"), sum_kmh=("sum_kmh", "sum"), days=("date", "nunique")
    ).reset_index()
    agg["kmh"] = agg["sum_kmh"] / agg["n"]
    agg.attrs["days"] = int(raw["date"].nunique())
    agg.attrs["samples"] = int(raw["n"].sum())
    return agg[agg["n"] >= MIN_SAMPLES_PER_ROW]


def _with_features(rows: pd.DataFrame, cells: pd.DataFrame) -> pd.DataFrame:
    df = rows.merge(cells[["cell", *CELL_FEATURES]], on="cell")
    df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
    df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)
    return df


def _model() -> RandomForestRegressor:
    return RandomForestRegressor(
        n_estimators=150, min_samples_leaf=5, max_features=0.6, random_state=RANDOM_SEED, n_jobs=-1
    )


def _hourly_mean(df: pd.DataFrame) -> pd.Series:
    """Sample-weighted mean speed per (hour, weekend): the baseline the model must beat."""
    return df.groupby(["hour", "weekend"]).apply(lambda d: np.average(d["kmh"], weights=d["n"]), include_groups=False)


def train(cells: pd.DataFrame, obs: pd.DataFrame | None) -> tuple[dict, np.ndarray | None]:
    """Returns (model card, weekday speed matrix [cells x 24] or None)."""
    if obs is None or obs.attrs.get("days", 0) < MIN_DAYS or len(obs) < MIN_ROWS:
        have = "no data" if obs is None else f"{obs.attrs.get('days', 0)} days, {len(obs)} rows"
        return {"status": "waiting_for_data", "have": have, "need": f">= {MIN_DAYS} days, >= {MIN_ROWS} rows"}, None

    df = _with_features(obs, cells)
    X, y, w = df[FEATURES], df["kmh"].to_numpy(), df["n"].to_numpy()
    groups = df["cell"].map(lambda c: h3.cell_to_parent(c, 6))

    pred, base = np.empty(len(df)), np.empty(len(df))
    for tr, te in GroupKFold(5).split(X, y, groups):
        pred[te] = _model().fit(X.iloc[tr], y[tr], sample_weight=w[tr]).predict(X.iloc[te])
        keys = pd.MultiIndex.from_frame(df.iloc[te][["hour", "weekend"]])
        base[te] = _hourly_mean(df.iloc[tr]).reindex(keys).to_numpy()

    def mae(p):
        return float(np.average(np.abs(p - y), weights=w))

    def r2(p):
        return float(1 - np.average((p - y) ** 2, weights=w) / np.average((y - np.average(y, weights=w)) ** 2, weights=w))

    final = _model().fit(X, y, sample_weight=w)
    hourly = _hourly_mean(df)
    card = {
        "status": "trained",
        "days": obs.attrs["days"],
        "samples": obs.attrs["samples"],
        "cv": {"mae_kmh": round(mae(pred), 2), "r2": round(r2(pred), 3),
               "baseline_mae_kmh": round(mae(base), 2), "baseline_r2": round(r2(base), 3)},
        "importances": dict(sorted(zip(FEATURES, final.feature_importances_.round(3).tolist()), key=lambda kv: -kv[1])),
        "hourly_weekday_kmh": [round(float(hourly.get((h, 0), np.nan)), 2) for h in range(24)],
    }
    return card, _predict_grid(final, cells)


def _predict_grid(model, cells: pd.DataFrame) -> np.ndarray:
    """Weekday speed for every cell and hour. Cells outside São Paulo (no SPTrans
    GPS) take the mean of their nearest São Paulo cells."""
    grid = np.empty((len(cells), 24))
    for h in range(24):
        frame = cells[CELL_FEATURES].assign(
            hour_sin=np.sin(2 * np.pi * h / 24), hour_cos=np.cos(2 * np.pi * h / 24), weekend=0
        )
        grid[:, h] = model.predict(frame[FEATURES])
    inside = (cells["muni"] == SAO_PAULO["code"]).to_numpy()
    tree = BallTree(np.radians(cells.loc[inside, ["lat", "lon"]].to_numpy()), metric="haversine")
    _, idx = tree.query(np.radians(cells.loc[~inside, ["lat", "lon"]].to_numpy()), k=NEIGHBORS_FOR_FILL)
    grid[~inside] = grid[inside][idx].mean(axis=1)
    return grid.round(1)
