import numpy as np
import pandas as pd

import gtfs
import network


def test_to_seconds_handles_times_past_midnight():
    assert gtfs.to_seconds(pd.Series(["00:00:01", "25:30:00"])).tolist() == [1, 91800]


def test_haversine_one_degree_latitude():
    assert abs(gtfs.haversine_km(-23.0, -46.0, -24.0, -46.0) - 111.19) < 0.05


def test_peak_buses_per_hour_uses_overlap_with_peak_window():
    freq = pd.DataFrame({
        "trip_id": ["a", "a", "b"],
        "start_time": ["06:00:00", "07:30:00", "09:00:00"],
        "end_time": ["07:29:59", "08:59:59", "09:59:59"],
        "headway_secs": [600, 300, 60],
    })
    peak = gtfs.peak_buses_per_hour(freq)
    # Half the peak hour at 6 buses/h and half at 12 buses/h; trip b runs outside the peak.
    assert abs(peak["a"] - 9) < 0.05
    assert peak["b"] == 0


def test_classify_access_levels():
    buses = pd.Series([300, 100, 10, 300, 0, 0])
    walk = pd.Series([100, 100, 100, 800, 2000, 2000])
    rail = pd.Series([False, False, False, False, False, True])
    assert network.classify_access(buses, walk, rail).tolist() == ["good", "fair", "low", "low", "remote", "fair"]


def test_shape_cell_lengths_sums_to_shape_length():
    lat = np.linspace(-23.55, -23.50, 50)
    shapes = pd.DataFrame({
        "shape_id": "s1",
        "shape_pt_lat": lat,
        "shape_pt_lon": -46.63,
        "shape_pt_sequence": np.arange(50),
    })
    cells = gtfs.shape_cell_lengths(shapes, 8)
    assert len(cells) > 1
    assert abs(cells["km"].sum() - gtfs.haversine_km(-23.55, -46.63, -23.50, -46.63)) < 1e-6
