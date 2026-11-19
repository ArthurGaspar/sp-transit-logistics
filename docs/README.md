# Documentation

The repository [README](../README.md) describes what the app does, how to use each workspace, and what the measurements mean. These pages cover how the project is built and maintained.

## Reference

| Page | Read it when |
|---|---|
| [Architecture](architecture.md) | You need the module map, the data flow from GTFS to browser, or how the solver, the travel model and the workers fit together. |
| [Data contracts](data-contracts.md) | You change anything `pipeline/build.py` writes or `web/src/data.ts` reads. |
| [Development](development.md) | You set up a machine, run tests or benchmarks, refresh vendored data, or work on CI, deployment or GPS collection. |

## Experiments and recorded results

These pages record specific runs. Their numbers depend on the dataset build or the configured scenario, and change when those do.

| Page | Contents |
|---|---|
| [Routing benchmark](benchmark.md) | Static solver against the nearest-neighbor baseline on the sample workloads. |
| [Dispatch simulation](dispatch-simulation.md) | Synthetic disruption experiment comparing three dispatch policies. |
| [UFABC three-city route](ufabc-abc-route.md) | Historical screenshot example with its exact inputs ([workload JSON](ufabc-abc-workload.json)). |

## Keeping these docs current

- If a change alters a JSON field, a command, a CI step or an invariant, update the matching page in the same commit.
- Keep volatile figures, such as stop counts, scores and timings, out of the reference pages. Put them in the recorded-results pages with the dataset timestamp or configuration that produced them.
