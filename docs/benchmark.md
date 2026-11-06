# Delivery solver benchmark

Run from `web/` after `python pipeline/build.py`:

```sh
npm run benchmark
```

The command loads the same TypeScript solver and travel model used by the worker. It checks that every stop is accounted for exactly once, every demo stop is served, each route respects capacity and shift length, and total driving time is no worse than the nearest-neighbor baseline. It fails if a check fails.

## Recorded run

Recorded on 6 November 2026 using the local dataset built on **15 October 2026 at 17:01:08 UTC**. New feed builds may change the scenarios and results; the command prints the dataset timestamp.

Assumptions: capacity **30 boxes**, shift **8 hours**, service **5 minutes per stop**, speed **20 km/h**, detour factor **1.3**. The delivery locations are sampled from public geography; their demand is synthetic.

| Scenario | Stops | Vans: baseline → solver | Baseline km | Solver km | Distance reduction |
|---|---:|---:|---:|---:|---:|
| ABC border: São Caetano hub | 34 | 4 → 4 | 215.4 | 152.0 | 29.4% |
| Centro expandido | 40 | 4 → 4 | 113.7 | 101.4 | 10.8% |
| Zona Leste: large fleet | 70 | 8 → 8 | 210.9 | 171.1 | 18.9% |

The baseline always visits the nearest unvisited stop that fits the current van and shift, returning to the depot when no further stop fits. The solver minimizes driving minutes. At constant speed, reducing driving minutes also reduces estimated distance. With spatially varying speed, that equivalence does not hold.

Local solve times were 10–46 ms for this run, excluding data loading, worker startup, and rendering. These timings depend on hardware and search budget; they are not a performance guarantee.

These three cases are a small demo benchmark, not an independent generalization study or evidence of client savings. Neither plan uses real road distances. Fleet sizes happen to match here; fleet minimization is not the objective.
