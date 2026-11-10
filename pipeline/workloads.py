"""Balanced synthetic delivery stops inside the IBGE municipal boundaries."""

from itertools import zip_longest

from shapely.geometry import Point, shape

from config import ABCD_MUNICIPALITIES

# Sampling anchors are approximate neighborhood locations, not delivery addresses.
ANCHORS = {
    "3547809": [(-23.656, -46.529), (-23.672, -46.512)],  # Santo André
    "3548708": [(-23.657, -46.571), (-23.705, -46.551)],  # Rudge Ramos and central São Bernardo
    "3548807": [(-23.614, -46.570), (-23.633, -46.563)],  # São Caetano
    "3513801": [(-23.685, -46.622), (-23.710, -46.610)],  # Diadema
}


def interleave(groups):
    """Keep geographic coverage in the first 24 stops used by the simulator."""
    return [point for row in zip_longest(*groups) for point in row if point is not None]


def abcd_points(boundaries, rng, per_city):
    groups = []
    for city in ABCD_MUNICIPALITIES:
        polygon = shape(boundaries[city["code"]]["geometry"])
        anchors = ANCHORS[city["code"]]
        points = []
        for i in range(per_city):
            lat, lon = anchors[i % len(anchors)]
            for _ in range(250):
                y = round(lat + rng.uniform(-0.012, 0.012), 5)
                x = round(lon + rng.uniform(-0.012, 0.012), 5)
                if polygon.contains(Point(x, y)) and (y, x, city["name"]) not in points:
                    points.append((y, x, city["name"]))
                    break
            else:
                raise ValueError(f"Could not sample stops inside {city['name']}")
        groups.append(points)
    return groups
