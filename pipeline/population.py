"""Municipal Censo 2022 counts; deliberately not allocated to H3 cells."""

import json
from pathlib import Path

from config import ABC_MUNICIPALITIES, SAO_PAULO

SNAPSHOT = Path(__file__).resolve().parent / "data" / "population-2022.json"
YEAR = "2022"
SOURCE_URL = (
    "https://servicodados.ibge.gov.br/api/v3/agregados/4714/periodos/2022/variaveis/93"
    "?localidades=N6[" + ",".join(m["code"] for m in [SAO_PAULO, *ABC_MUNICIPALITIES]) + "]"
)


def load_population(path: Path = SNAPSHOT) -> dict:
    """Validate the vendored IBGE response and return a provenance-bearing summary.

    Missing/suppressed counts must fail the build rather than turn into zero residents.
    Municipal totals cannot support population-weighted transit access percentages.
    """
    variables = json.loads(path.read_text(encoding="utf-8"))
    if len(variables) != 1 or variables[0]["id"] != "93" or variables[0]["unidade"] != "Pessoas":
        raise ValueError("Expected IBGE resident population variable 93, in people")
    counts = {}
    for result in variables[0]["resultados"]:
        if result["classificacoes"]:
            raise ValueError("Expected unclassified municipal population totals")
        for row in result["series"]:
            locality = row["localidade"]
            value = row["serie"].get(YEAR, "")
            if locality["nivel"]["id"] != "N6" or not value.isascii() or not value.isdigit():
                raise ValueError("Expected a non-negative municipal count for Censo 2022")
            code = locality["id"]
            if code in counts:
                raise ValueError(f"Duplicate population count for {code}")
            counts[code] = int(value)
    municipalities = [SAO_PAULO, *ABC_MUNICIPALITIES]
    if set(counts) != {m["code"] for m in municipalities}:
        raise ValueError("Population snapshot must contain São Paulo and all seven ABC municipalities")
    return {
        "year": int(YEAR),
        "source": "IBGE Censo Demográfico 2022 · SIDRA table 4714, variable 93",
        "sourceUrl": SOURCE_URL,
        "retrievedAt": "2026-11-10",
        "geography": "municipality",
        "municipalities": [{**m, "residents": counts[m["code"]]} for m in municipalities],
        "totalResidents": sum(counts.values()),
        "abcResidents": sum(counts[m["code"]] for m in ABC_MUNICIPALITIES),
    }
