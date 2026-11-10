from collections import Counter

from shapely.geometry import Point, shape

import fetch
import network
from build import _demo_scenarios
from config import ABCD_MUNICIPALITIES, SAO_PAULO


def test_regional_workloads_cover_all_four_cities_with_and_without_the_capital():
    boundaries = fetch.fetch_boundaries()
    cells = network.study_cells(boundaries)
    # Substitute H3 centers for GTFS stops, so this check needs no feed download.
    stops = cells.rename(columns={"lat": "stop_lat", "lon": "stop_lon", "cell": "stop_id"})
    scenarios = {s["id"]: s for s in _demo_scenarios({"stops": stops}, cells, boundaries)}
    cities = {m["name"] for m in ABCD_MUNICIPALITIES}
    polygons = {b["name"]: shape(b["geometry"]) for b in boundaries.values()}

    for scenario_id, per_city, depot_city in [("abcd", 8, "São Bernardo do Campo"), ("abcd-sp", 6, "Diadema")]:
        scenario = scenarios[scenario_id]
        points = scenario["points"]
        expected = {city: per_city for city in cities}
        if scenario_id == "abcd-sp":
            expected[SAO_PAULO["name"]] = 8
        assert Counter(p["municipality"] for p in points) == expected
        assert {p["municipality"] for p in points[:24]} == set(expected)
        for p in points:
            assert polygons[p["municipality"]].contains(Point(p["lon"], p["lat"]))
        assert scenario["depotMunicipality"] == depot_city
        assert polygons[depot_city].contains(Point(scenario["depot"]["lon"], scenario["depot"]["lat"]))
