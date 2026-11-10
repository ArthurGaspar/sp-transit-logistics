import copy
import json

import pytest

import population


def test_vendored_population_covers_study_area_and_totals():
    summary = population.load_population()
    counts = {m["code"]: m["residents"] for m in summary["municipalities"]}
    assert len(counts) == 8
    assert counts["3550308"] == 11451999
    assert summary["totalResidents"] == sum(counts.values())
    assert summary["abcResidents"] == sum(v for k, v in counts.items() if k != "3550308")
    assert summary["year"] == 2022
    assert summary["geography"] == "municipality"


@pytest.mark.parametrize("change", ["missing", "duplicate", "suppressed", "negative", "wrong_year", "wrong_level", "wrong_variable", "classified"])
def test_invalid_population_is_rejected(tmp_path, change):
    payload = copy.deepcopy(json.loads(population.SNAPSHOT.read_text(encoding="utf-8")))
    result = payload[0]["resultados"][0]
    rows = result["series"]
    if change == "missing":
        rows.pop()
    elif change == "duplicate":
        rows.append(copy.deepcopy(rows[0]))
    elif change == "suppressed":
        rows[0]["serie"]["2022"] = "..."
    elif change == "negative":
        rows[0]["serie"]["2022"] = "-1"
    elif change == "wrong_year":
        rows[0]["serie"] = {"2023": "100"}
    elif change == "wrong_level":
        rows[0]["localidade"]["nivel"]["id"] = "N3"
    elif change == "wrong_variable":
        payload[0]["id"] = "6318"
    elif change == "classified":
        result["classificacoes"] = [{"id": "test"}]
    path = tmp_path / "population.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError):
        population.load_population(path)
