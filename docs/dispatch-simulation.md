# Dispatch under changing conditions

Open **Dispatch simulation** in the app, or run `npm run benchmark:simulation` from `web/`. The built-in experiment has no dataset-download dependency. **Restore proof scenario** restores all inputs, and **Export experiment JSON** saves the workload, settings, sensitivity samples and complete event traces.

## The experiment

This is a deliberately small synthetic counterexample, not a measured operational improvement. Nine delivery orders use specified coordinates around a São Paulo depot. Eight are available at minute 0; the ninth arrives at the depot at minute 40. Each order is three boxes. Two vans carry at most 16 boxes each, with a 240-minute shift, five-minute service time, 24 km/h average speed and a 1.3 distance multiplier.

Delivery 4 has a deadline at minute 56. All other deadlines are minute 240. Under calm conditions, the driving-time optimized plan serves Delivery 4 at minute 50.29, meeting its deadline. These deadlines were chosen to create a transparent, reproducible example of an initially sufficient plan becoming inadequate after disruption.

The changed environment has the same orders, deadlines and fleet, plus:

- Minute 12: future legs whose midpoint lies east of the depot take 2.5 times their original travel time.
- Minute 12: Delivery 1 needs 25 additional service minutes. A completed delivery would be unaffected; ongoing service would be extended once.
- Minute 25: Van 1 becomes unavailable for 45 minutes. Its current action pauses, retains its remaining work, and resumes at minute 70.

Both environments include the new order released at minute 40. Each policy receives the same event schedule; it cannot inspect events before they occur.

## Policies and objective

**Keep optimized plan** uses the existing savings/local-search solver to minimize initial driving time, then keeps the loaded stop order. New orders are loaded by release order at the next depot visit.

**Nearest-neighbor dispatch** uses the existing nearest-neighbor baseline and keeps that loaded stop order. New depot orders are loaded nearest-first.

**Partial reoptimization** starts with exactly the same routes as the optimized fixed plan. After an observed disruption, affected vans may reorder their unvisited suffix at the next completed delivery. Deadline and distance candidates plus up to eight relocate passes are evaluated against projected cost. A changed suffix must forecast an improvement after its two-minute coordination overhead. Later depot loading uses deadline order. This heuristic is not a global optimum and can make decisions that later disruptions make unfavorable.

Every policy uses the same score, in estimated R$:

```
2 × kilometers
+ 30 × paid van hours
+ 2 × summed delivery lateness in minutes
+ 250 × unserved orders
```

Paid duty runs from a van's first departure to its final depot return, including service, outages, coordination and waiting between tours. It excludes unused vans and time after their final return. Late deliveries have a soft penalty; they are not silently rejected. An order that cannot fit capacity or the remaining shift is explicitly unserved and incurs the separate failure penalty. Costs and penalties are editable in the interface; changing them can change the winner.

## Recorded result

| Environment | Policy | Delivered | Late minutes | km | Replans | Score (R$) |
|---|---|---:|---:|---:|---:|---:|
| Calm | Keep optimized plan | 9/9 | 0.0 | 53.6 | 0 | 196.62 |
| Calm | Nearest-neighbor dispatch | 9/9 | 0.0 | 57.9 | 0 | 210.62 |
| Calm | Partial reoptimization | 9/9 | 0.0 | 53.6 | 0 | 196.62 |
| Changed | Keep optimized plan | 9/9 | 93.0 | 53.6 | 0 | 470.19 |
| Changed | Nearest-neighbor dispatch | 9/9 | 55.3 | 57.9 | 0 | 400.16 |
| Changed | Partial reoptimization | 9/9 | 57.2 | 57.4 | 1 | 402.10 |

The shorter initial plan wins or ties in the calm environment. After disruption, its distance is still shortest, but its Delivery 4 completion moves to minute 148.99. The nearest-neighbor policy completes that order at minute 111.27 and has the lowest changed-environment score. Partial reoptimization completes it at minute 113.23 and also improves on the fixed plan, without winning this particular comparison.

At minute 21.16, the adaptive policy preserves the completed Delivery 3 and changes only Van 1's remaining order:

```
Before: Delivery 1 → Delivery 4 → Delivery 8 → Delivery 5
After:  Delivery 4 → Delivery 1 → Delivery 5 → Delivery 8
```

The event log and replay expose this change. The other van's loaded route is preserved. No completed delivery is undone; no in-flight destination changes; no parcels move between vans.

The sensitivity chart samples intensities 0, 0.25, 0.5, 0.75, 1, 1.5 and 2. Intensity scales added travel slowdown, extra service and outage duration together, keeping event start times, orders and cost weights fixed. The first sampled reversal occurs at 0.25. This is a sampled threshold, not an exact breakpoint. At 1.5 the fixed strategy becomes best again as shift failures and their penalties change the tradeoff. Increasing disruption does not imply that a single alternative stays best.

## Model boundaries and verification

- Coordinates, delivery demand, deadlines and events are synthetic. Other sample workloads use up to their first 24 stops with explicitly synthetic release times and deadlines. There is no traffic feed or calibration against delivery operations.
- Travel is straight-line distance times a detour factor. Traffic is a persistent zone multiplier applied on departure. A committed leg retains its departure estimate; a vehicle outage can pause it. No street graph, traffic rerouting or hard appointment windows are modeled.
- Parcels remain on their loaded van. New orders wait at the depot; loading at the depot is instantaneous. There is no cross-vehicle rescue or transfer. The available fleet is fixed.
- Policies cannot start a delivery unless its known travel, service and direct depot return fit the shift. An in-flight disruption can still create overtime. Remaining unservable orders are reported explicitly.
- The initial solver runs to convergence for this bounded experiment rather than using a machine-speed-dependent time budget. Event ordering is deterministic: completions, then external events at that timestamp, then new decisions. Simultaneous vans are dispatched by vehicle number.
- The browser computes runs in a separate worker. Changing controls clears stale results; the page never claims a ranking reversal unless it is present in the current results.

`web/src/lib/simulation.test.ts` checks reproducibility, the ranking reversal, order accounting, van capacity, parcel ownership, suffix preservation, event causality, in-flight pauses, traffic commitment, service delays, depot-only loading, shift failures, oversized orders and zero-time events. `npm run benchmark:simulation` asserts the success criterion and prints the result table. The deployment checks run both tests and this benchmark.
