"""The realtime path only meets real data once an Olho Vivo token is configured,
so it is exercised here end to end with synthetic snapshots and observations."""

import h3
import numpy as np
import pandas as pd

import collect_realtime
import speed_model
from config import CITY_CENTER, SAO_PAULO


def _snap(rows):
    df = pd.DataFrame(rows, columns=["vehicle", "lat", "lon", "ts"])
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return df


def test_speeds_from_two_snapshots():
    first = _snap([
        (1, -23.5500, -46.6300, "2026-10-14T11:00:00Z"),
        (2, -23.5600, -46.6400, "2026-10-14T11:00:00Z"),
        (3, -23.5700, -46.6500, "2026-10-14T11:00:00Z"),
    ])
    second = _snap([
        (1, -23.5545, -46.6300, "2026-10-14T11:01:00Z"),  # ~0.5 km in 60 s = ~30 km/h
        (2, -23.5600, -46.6400, "2026-10-14T11:00:10Z"),  # 10 s apart: too short, dropped
        (3, -23.6700, -46.6500, "2026-10-14T11:01:00Z"),  # 11 km in a minute: GPS jump, dropped
    ])
    sp = collect_realtime.speeds(first, second)
    assert len(sp) == 1
    assert 28 < sp["kmh"].iloc[0] < 32
    assert sp["local"].iloc[0].hour == 8  # 11:00 UTC is 08:00 in São Paulo


def test_aggregate_groups_by_cell_and_local_hour():
    local = pd.Timestamp("2026-10-14T08:15:00", tz=collect_realtime.SAO_PAULO_TZ)
    sp = pd.DataFrame({"lat": [-23.55, -23.55], "lon": [-46.63, -46.63], "kmh": [10.0, 20.0], "local": [local, local]})
    agg = collect_realtime.aggregate(sp)
    assert agg.to_dict("records") == [{
        "date": "2026-10-14", "weekday": 2, "hour": 8, "cell": h3.latlng_to_cell(-23.55, -46.63, 8),
        "n": 2, "sum_kmh": 30.0, "sum_kmh_sq": 500.0,
    }]


def _synthetic_world(tmp_path):
    center = h3.latlng_to_cell(*CITY_CENTER, 8)
    cells = pd.DataFrame({"cell": sorted(h3.grid_disk(center, 14))})
    ll = np.array([h3.cell_to_latlng(c) for c in cells["cell"]])
    cells["lat"], cells["lon"] = ll[:, 0], ll[:, 1]
    cells["dist_center_km"] = np.hypot((cells["lat"] - CITY_CENTER[0]) * 110.6, (cells["lon"] - CITY_CENTER[1]) * 101.9)
    rng = np.random.default_rng(0)
    cells["buses_peak"] = rng.uniform(0, 500, len(cells))
    cells["stops"] = rng.integers(0, 10, len(cells))
    cells["routes"] = rng.integers(0, 40, len(cells))
    # The eastern edge plays the ABC, where there is no SPTrans GPS.
    cells["muni"] = np.where(cells["lon"] > CITY_CENTER[1] + 0.05, "3548807", SAO_PAULO["code"])

    # Speed drops at rush hours and near busy, central hexagons.
    rows = []
    sp_cells = cells[cells["muni"] == SAO_PAULO["code"]]
    for day, weekday in [("2026-10-12", 0), ("2026-10-13", 1), ("2026-10-14", 2)]:
        for hour in range(24):
            rush = 1.0 if hour in (7, 8, 17, 18) else 0.0
            kmh = 28 - 8 * rush - sp_cells["buses_peak"].to_numpy() / 50 + sp_cells["dist_center_km"].to_numpy() * 0.8
            kmh = np.clip(kmh + rng.normal(0, 1, len(sp_cells)), 3, 60)
            n = 6
            for c, v in zip(sp_cells["cell"], kmh):
                rows.append((day, weekday, hour, c, n, v * n, v * v * n))
    pd.DataFrame(rows, columns=collect_realtime.COLUMNS).to_csv(tmp_path / "speeds-2026-10.csv", index=False)
    return cells


def test_train_waits_for_enough_data(tmp_path):
    card, grid = speed_model.train(pd.DataFrame(), speed_model.load_observations(tmp_path))
    assert card["status"] == "waiting_for_data" and grid is None


def test_train_beats_hourly_baseline_and_fills_abc(tmp_path):
    cells = _synthetic_world(tmp_path)
    card, grid = speed_model.train(cells, speed_model.load_observations(tmp_path))
    assert card["status"] == "trained"
    assert card["days"] == 3
    assert card["cv"]["mae_kmh"] < card["cv"]["baseline_mae_kmh"]
    assert grid.shape == (len(cells), 24)
    assert np.isfinite(grid).all()
    rush = grid[:, 8].mean()
    night = grid[:, 3].mean()
    assert rush < night - 4
