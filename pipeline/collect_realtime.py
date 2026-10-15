"""Samples live bus speeds from the SPTrans Olho Vivo API and appends hourly aggregates.

Takes two snapshots of every bus position SNAPSHOT_GAP_S apart, derives each
vehicle's speed from the displacement, and aggregates speeds per H3 cell. Only
aggregates are stored (a few KB per run), never raw positions, so the data can
live in a git branch. Designed to run from a GitHub Actions cron job; needs a
free token from https://www.sptrans.com.br/desenvolvedores in OLHOVIVO_TOKEN.
"""

import os
import sys
import time
from datetime import datetime, timedelta, timezone

import h3
import numpy as np
import pandas as pd
import requests

from config import H3_RES, MAX_SPEED_KMH, REALTIME_DIR
from gtfs import haversine_km

API = "https://api.olhovivo.sptrans.com.br/v2.1"
SNAPSHOT_GAP_S = 75
MIN_DT_S, MAX_DT_S = 30, 300
SAO_PAULO_TZ = timezone(timedelta(hours=-3))  # Brazil has had no DST since 2019
COLUMNS = ["date", "weekday", "hour", "cell", "n", "sum_kmh", "sum_kmh_sq"]


def login(token: str) -> requests.Session:
    s = requests.Session()
    resp = s.post(f"{API}/Login/Autenticar", params={"token": token}, timeout=30)
    resp.raise_for_status()
    if resp.text.strip().lower() != "true":
        raise RuntimeError("Olho Vivo rejected the token")
    return s


def snapshot(s: requests.Session) -> pd.DataFrame:
    resp = s.get(f"{API}/Posicao", timeout=60)
    resp.raise_for_status()
    rows = [
        (v["p"], v["py"], v["px"], v["ta"])
        for line in resp.json().get("l", [])
        for v in line.get("vs", [])
    ]
    df = pd.DataFrame(rows, columns=["vehicle", "lat", "lon", "ts"])
    df["ts"] = pd.to_datetime(df["ts"], utc=True, errors="coerce")
    return df.dropna().drop_duplicates("vehicle", keep="last")


def speeds(first: pd.DataFrame, second: pd.DataFrame) -> pd.DataFrame:
    """Per-vehicle speed between two snapshots, located at the movement midpoint."""
    m = first.merge(second, on="vehicle", suffixes=("0", "1"))
    m["dt"] = (m["ts1"] - m["ts0"]).dt.total_seconds()
    m = m[m["dt"].between(MIN_DT_S, MAX_DT_S)]
    m["kmh"] = haversine_km(m["lat0"], m["lon0"], m["lat1"], m["lon1"]) / (m["dt"] / 3600)
    m = m[m["kmh"] <= MAX_SPEED_KMH]
    m["lat"] = (m["lat0"] + m["lat1"]) / 2
    m["lon"] = (m["lon0"] + m["lon1"]) / 2
    m["local"] = m["ts1"].dt.tz_convert(SAO_PAULO_TZ)
    return m[["lat", "lon", "kmh", "local"]]


def aggregate(sp: pd.DataFrame) -> pd.DataFrame:
    sp = sp.assign(
        cell=[h3.latlng_to_cell(a, b, H3_RES) for a, b in zip(sp["lat"], sp["lon"])],
        date=sp["local"].dt.strftime("%Y-%m-%d"),
        weekday=sp["local"].dt.weekday,
        hour=sp["local"].dt.hour,
        kmh_sq=sp["kmh"] ** 2,
    )
    agg = sp.groupby(["date", "weekday", "hour", "cell"]).agg(
        n=("kmh", "size"), sum_kmh=("kmh", "sum"), sum_kmh_sq=("kmh_sq", "sum")
    )
    return agg.round(2).reset_index()[COLUMNS]


def append(agg: pd.DataFrame) -> None:
    REALTIME_DIR.mkdir(parents=True, exist_ok=True)
    month = datetime.now(SAO_PAULO_TZ).strftime("%Y-%m")
    path = REALTIME_DIR / f"speeds-{month}.csv"
    new = not path.exists()
    agg.to_csv(path, mode="a", header=new, index=False)


def main() -> int:
    token = os.environ.get("OLHOVIVO_TOKEN", "").strip()
    if not token:
        print("OLHOVIVO_TOKEN is not set; skipping collection.")
        return 0
    s = login(token)
    first = snapshot(s)
    time.sleep(SNAPSHOT_GAP_S)
    second = snapshot(s)
    sp = speeds(first, second)
    agg = aggregate(sp)
    append(agg)
    print(f"{len(first)} buses seen, {len(sp)} speed samples, {len(agg)} cell rows; median {np.median(sp['kmh']):.1f} km/h")
    return 0


if __name__ == "__main__":
    sys.exit(main())
