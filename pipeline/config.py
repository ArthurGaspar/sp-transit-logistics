"""Shared constants for the offline data pipeline."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "pipeline" / "cache"
OUT_DIR = ROOT / "web" / "public" / "data"
# Overridable so the collector can write straight into a checkout of the realtime-data branch.
REALTIME_DIR = Path(os.environ.get("REALTIME_DIR", ROOT / "pipeline" / "realtime"))
BOUNDARIES_DIR = ROOT / "pipeline" / "data" / "boundaries"

# Mirror of the official SPTrans GTFS kept by MobilityData (no login required).
GTFS_URL = "https://files.mobilitydatabase.org/mdb-8/latest.zip"

IBGE_MESH_URL = (
    "https://servicodados.ibge.gov.br/api/v3/malhas/municipios/{code}"
    "?formato=application/vnd.geo%2Bjson&qualidade=maxima"
)

SAO_PAULO = {"code": "3550308", "name": "São Paulo"}
# Grande ABC: the seven municipalities of the Consórcio Intermunicipal do Grande ABC.
ABC_MUNICIPALITIES = [
    {"code": "3547809", "name": "Santo André"},
    {"code": "3548708", "name": "São Bernardo do Campo"},
    {"code": "3548807", "name": "São Caetano do Sul"},
    {"code": "3513801", "name": "Diadema"},
    {"code": "3529401", "name": "Mauá"},
    {"code": "3543303", "name": "Ribeirão Pires"},
    {"code": "3544103", "name": "Rio Grande da Serra"},
]

# H3 resolution 8: hexagons of ~0.74 km², edge ~460 m (about a 5-minute walk across).
H3_RES = 8

# Praça da Sé, the city's kilometer zero.
CITY_CENTER = (-23.5503, -46.6339)

# Weekday morning peak used for service-level metrics.
PEAK_START, PEAK_END = "07:00:00", "07:59:59"

# SP city cells whose center is within this distance of the ABC border form the "ABC border" zone.
ABC_BORDER_KM = 3.0

# Speeds outside this band are treated as data errors.
MIN_SPEED_KMH, MAX_SPEED_KMH = 4.0, 60.0

RANDOM_SEED = 42
