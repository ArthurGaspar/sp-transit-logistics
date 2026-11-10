# Delivery solver benchmark

Run from `web/` after `python pipeline/build.py`:

```sh
npm run benchmark
```

The command loads the same TypeScript solver and travel model used by the worker. It checks that every stop is accounted for exactly once, every demo stop is served, each route respects capacity and shift length, and total driving time is no worse than the nearest-neighbor baseline. It fails if a check fails.

## Recorded run

Recorded using the local dataset built on **10 November 2026 at 20:55:20 UTC**. New feed builds may change the scenarios and results; the command prints the dataset timestamp.

Assumptions: capacity **30 boxes**, shift **8 hours**, service **5 minutes per stop**, speed **20 km/h**, detour factor **1.3**. The delivery locations are sampled from public geography; their demand is synthetic.

| Scenario | Stops | Vans: baseline → solver | Baseline km | Solver km | Distance reduction |
|---|---:|---:|---:|---:|---:|
| ABCD: four-city delivery loop | 32 | 3 → 3 | 80.2 | 77.8 | 3.0% |
| São Paulo ↔ ABCD | 32 | 4 → 4 | 182.7 | 132.0 | 27.7% |
| Centro expandido | 40 | 5 → 5 | 135.8 | 102.7 | 24.4% |
| Zona Leste: large fleet | 70 | 7 → 7 | 226.1 | 164.2 | 27.4% |

The baseline always visits the nearest unvisited stop that fits the current van and shift, returning to the depot when no further stop fits. The solver minimizes driving minutes. At constant speed, reducing driving minutes also reduces estimated distance. With spatially varying speed, that equivalence does not hold.

Local solve times were 10–40 ms for this run, excluding data loading, worker startup, and rendering. These timings depend on hardware and search budget; they are not a performance guarantee.

These four cases are a small demo benchmark, not an independent generalization study or evidence of client savings. Neither plan uses real road distances. Fleet sizes happen to match here; fleet minimization is not the objective.
