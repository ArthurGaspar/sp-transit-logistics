# Development

## Requirements

- Python 3.11 or newer (CI uses 3.12).
- Node 22 or newer.
- Network access for the first data build, which downloads the GTFS feed. Later builds use the cache.

## Setup

```sh
python -m venv pipeline/.venv
pipeline/.venv/Scripts/Activate.ps1      # Windows PowerShell
# source pipeline/.venv/bin/activate     # macOS / Linux
pip install -r pipeline/requirements.txt
python pipeline/build.py

cd web
npm ci
npm run dev
```

Run `build.py` from the repository root. Python puts the script's own directory on `sys.path`, which is why the flat imports between pipeline modules work. The app expects `web/public/data/` to exist. Without it, views show the data-load error state with a retry button.

## Tests

| Command | Where | Covers |
|---|---|---|
| `python -m pytest pipeline/tests -q` | root | GTFS time parsing, haversine, peak frequency overlap, access classification, shape-to-cell lengths, census validation, realtime speed derivation and aggregation, speed-model thresholds and accuracy against the hourly baseline, ABCD workload coverage. |
| `npm test` | `web/` | Solver feasibility and non-regression (including a non-metric travel-time case), the travel matrices and speed lookup, CSV parsing, draft validation, simulation policies and determinism. |
| `npm run build` | `web/` | `tsc --noEmit` type check, then the Vite production build. |

Tests sit beside the code: `web/src/lib/<module>.test.ts` and `pipeline/tests/test_<area>.py`. Pipeline tests build small synthetic frames and don't download anything.

## Benchmarks

Both scripts start a Vite server in middleware mode and import the real TypeScript modules with `ssrLoadModule`. They use `node:assert` and exit non-zero on failure. CI runs both.

- `npm run benchmark` reads the built `scenarios.json` and `meta.json`, then solves each sample workload. It checks that every stop is accounted for exactly once, that capacity and shift limits hold, and that the result isn't worse than nearest-neighbor. Results change with each feed build. Record notable runs in [benchmark.md](benchmark.md), with the dataset timestamp.
- `npm run benchmark:simulation` needs no data build. It runs the built-in proof scenario and checks that every order is accounted for and none is delivered before its release time. It also asserts the ranking reversal: the fixed optimized plan is best in calm conditions and loses once the disruptions hit, and the adaptive policy replans at least once. It prints a results table. After any behavior change, copy that table into [dispatch-simulation.md](dispatch-simulation.md) and update the README figures to match.

## Refreshing inputs

| Input | How |
|---|---|
| GTFS feed | `python pipeline/build.py --refresh`. CI always refreshes. |
| Municipal boundaries | Download each mesh from `config.IBGE_MESH_URL` into `pipeline/data/boundaries/<code>.geojson`. |
| Census population | Download `population.SOURCE_URL` into `pipeline/data/population-2022.json`, update `retrievedAt` in `population.py`, then run the pipeline tests and a data build. |
| Realtime speeds | Collected automatically, as described below. To train locally, copy CSVs from the `realtime-data` branch into `pipeline/realtime/`. |

## CI and deployment

`.github/workflows/deploy.yml`:

1. Install the Python dependencies and run `pytest`.
2. If the `realtime-data` branch exists, extract its `realtime/` folder into `pipeline/`.
3. Run `python pipeline/build.py --refresh`.
4. In `web/`, run `npm ci`, `npm test`, both benchmarks, then `npm run build`.
5. Upload `web/dist` and deploy it to GitHub Pages. Pull requests stop before this step.

Triggers: a push to `master`, pull requests, a weekly cron (Monday 09:00 UTC, which is 06:00 in São Paulo), and manual dispatch. Pages must be set to **Source: GitHub Actions** in the repository settings.

## Optional GPS collection

1. Get an SPTrans developer token from <https://www.sptrans.com.br/desenvolvedores/>.
2. Add it as the repository Actions secret `OLHOVIVO_TOKEN`.
3. `.github/workflows/collect-realtime.yml` then runs every 30 minutes. It checks out (or creates) the orphan `realtime-data` branch as a worktree, runs `collect_realtime.py` with `REALTIME_DIR` pointing into it, and commits only when the aggregates have changed.
4. The speed model trains during the next deploy build, once the thresholds in `speed_model.py` are met (`MIN_DAYS`, `MIN_ROWS`, `MIN_SAMPLES_PER_ROW`). Until then, the UI keeps the model speed option disabled and shows what is still missing.

To try the collector locally, set `OLHOVIVO_TOKEN` and run `python pipeline/collect_realtime.py`. It appends to `pipeline/realtime/`, which is git-ignored.

## Common tasks

- **Add a sample workload:** extend `_demo_scenarios` in `build.py` with a stable `id` and a depot inside its municipality, which the build checks. Rebuild, run the benchmark, and update the README scenario description.
- **Change an access threshold:** edit the constant in `network.py`. It flows into `meta.thresholds` automatically. Update `test_classify_access_levels`, and re-check any README wording that quotes the threshold.
- **Add a planner parameter:** add it to `PlanParams` and `DEFAULT_PARAMS` in `lib/draft.ts`, and add range validation in `readDraft()`. Thread it through `SolveRequest` if the worker needs it.
- **Add a view:** add a `lazy()` import and a `TABS` entry in `App.tsx`. Keep heavy dependencies such as MapLibre and workers inside the lazy view.
- **Add a JSON output:** follow [data contracts](data-contracts.md#changing-a-contract).

## Repository hygiene

- Never commit `web/public/data/`, `pipeline/cache/`, `pipeline/realtime/`, `web/dist/` or `.env`.
- Commit messages: `type(scope): summary`, for example `feat(sim): add simulation worker`.
- After changing the UI, regenerate the README screenshots in `docs/*.png`.
