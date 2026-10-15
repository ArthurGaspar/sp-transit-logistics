"""Downloads the GTFS feed into a local cache and loads the vendored IBGE boundaries."""

import json
import zipfile
from pathlib import Path

import requests

from config import ABC_MUNICIPALITIES, BOUNDARIES_DIR, CACHE_DIR, GTFS_URL, IBGE_MESH_URL, SAO_PAULO

TIMEOUT_S = 120


def _download(url: str, dest: Path, force: bool) -> Path:
    if dest.exists() and not force:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}")
    with requests.get(url, timeout=TIMEOUT_S, stream=True) as resp:
        resp.raise_for_status()
        tmp = dest.with_suffix(dest.suffix + ".part")
        with open(tmp, "wb") as fh:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                fh.write(chunk)
        tmp.replace(dest)
    return dest


def fetch_gtfs(force: bool = False) -> Path:
    """Returns the directory holding the extracted GTFS text files."""
    zip_path = _download(GTFS_URL, CACHE_DIR / "sptrans-gtfs.zip", force)
    out = CACHE_DIR / "gtfs"
    if force or not (out / "trips.txt").exists():
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(out)
    return out


def fetch_boundaries() -> dict:
    """Returns {ibge_code: {"name": str, "geometry": GeoJSON geometry}}.

    Boundaries are vendored in pipeline/data/boundaries because the IBGE server
    omits its intermediate TLS certificate, which breaks Python and most Linux
    clients. To refresh them, delete the files and download IBGE_MESH_URL for
    each code with a client that completes the chain itself (e.g. Windows curl).
    """
    result = {}
    for muni in [SAO_PAULO, *ABC_MUNICIPALITIES]:
        path = BOUNDARIES_DIR / f"{muni['code']}.geojson"
        if not path.exists():
            _download(IBGE_MESH_URL.format(code=muni["code"]), path, force=True)
        geojson = json.loads(path.read_text(encoding="utf-8"))
        result[muni["code"]] = {"name": muni["name"], "geometry": geojson["features"][0]["geometry"]}
    return result
