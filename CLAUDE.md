# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A static, browser-only delivery-planning workspace for São Paulo and the ABCD (Santo André, São Bernardo do Campo, São Caetano do Sul, Diadema). It has two halves:

- **`pipeline/`**: Python. It turns the SPTrans GTFS feed, the vendored IBGE boundaries and census data, and optional Olho Vivo GPS aggregates into static JSON in `web/public/data/`.
- **`web/`**: React 19 + TypeScript + Vite. It reads that JSON and runs all routing and simulation in the browser, in Web Workers. There is no application server.

GitHub Actions tests, rebuilds the data, and deploys to GitHub Pages. User-facing behavior and the measurement caveats are in `README.md`. Engineering reference is in `docs/` (start with `docs/README.md`).

## Commands

```sh
# Pipeline (Python 3.11+; CI uses 3.12). Run from the repository root.
python -m venv pipeline/.venv && pipeline/.venv/Scripts/Activate.ps1   # Windows
pip install -r pipeline/requirements.txt
python pipeline/build.py            # writes web/public/data/*.json (uses pipeline/cache/)
python pipeline/build.py --refresh  # re-download GTFS
python -m pytest pipeline/tests -q
python -m pytest pipeline/tests/test_population.py -q   # single file

# Web (Node 22+). Run from web/.
npm ci
npm run dev
npm test                         # vitest run
npx vitest run src/lib/vrp.test.ts   # single file
npm run build                    # tsc --noEmit && vite build
npm run benchmark                # needs web/public/data from the pipeline
npm run benchmark:simulation     # self-contained
```

CI (`.github/workflows/deploy.yml`) runs, in order: pytest, data build, `npm test`, both benchmarks, `npm run build`. Run the relevant subset before you call a change done.

## Architecture in one screen

- `pipeline/build.py` is the only entry point that writes outputs. It writes `cells.json`, `cell-routes.json`, `routes.json`, `boundaries.json`, `scenarios.json` and `meta.json`.
- Pipeline modules import each other flatly (`import gtfs`, `from config import ...`). That works because scripts run from `pipeline/`, and `pipeline/tests/conftest.py` adds that directory to `sys.path`. Don't convert these to package-relative imports.
- `web/src/data.ts` holds the TypeScript types for every JSON file, plus a cached `load<T>(name)`. **When you change what `build.py` writes, update `data.ts` in the same change.** See `docs/data-contracts.md`.
- `web/src/App.tsx` sets up hash routing (`#overview`, `#optimizer`, `#insights`, `#model`, `#simulation`). Every view except Overview is `lazy()`-loaded so the landing page doesn't pull in MapLibre or the workers. Views read query parameters after the hash with `workspaceQuery()` (`lib/draft.ts`).
- Pure logic lives in `web/src/lib/` and is unit-tested there: `vrp.ts` (CVRP solver), `travel.ts` (distance/time matrices), `simulation.ts` (event-driven dispatch simulation), `csv.ts`, `draft.ts`.
- `solver.worker.ts` and `simulation.worker.ts` are thin wrappers. Each request carries a `requestId`; the view drops any response whose ID isn't the latest. Keep that pattern for any new async work.
- The benchmark scripts load the real TS modules with Vite's `ssrLoadModule`, so they exercise the same code as the app.

## Invariants: don't break these

- **Solver objective is driving minutes.** Capacity and shift length (including service time) are hard constraints. Unservable stops go in `unassigned` and are never dropped silently. `solve()` includes the nearest-neighbor plan as a starting point, so it must never do worse than that baseline. Tests and `npm run benchmark` enforce this.
- **Travel matrices are symmetric.** Distance is haversine × circuity. Minutes use the harmonic mean of the speeds at both ends and at the midpoint. There's no road network, and the docs must not claim one.
- **Simulation is deterministic and doesn't look ahead.** `npm run benchmark:simulation` asserts the proof scenario's ranking reversal: the fixed optimized plan is best in calm conditions, loses after the disruptions, and the adaptive policy actually replans. If you change simulation behavior, re-run it and update the recorded scores in `docs/dispatch-simulation.md` and the README in the same change.
- **Draft recovery must validate.** `readDraft()` returns `null` for anything malformed, any version mismatch, or blocked storage. It never throws. If you add a `PlanParams` field, add its validation too, or bump `version`.
- **Pipeline sampling is seeded** (`RANDOM_SEED`). Scenario depots must fall inside their municipality, which `build.py` checks. ABCD scenarios are interleaved so every municipality appears in the first 24 stops, the simulator's cap.
- **Area, not population.** Access percentages are shares of H3 cells. Grande ABC cells are unscored because the SPTrans feed doesn't cover them. Keep that wording accurate in the UI and docs.
- **The realtime collector stores aggregates only**, never raw vehicle positions. It writes to the `realtime-data` branch.

## Conventions

- Commit messages are short and lowercase, as `type(scope): summary`. Types in use include `feat`, `fix`, `change`, `update`, `add` and `improve`. Scopes include `web`, `sim`, `docs`, `deploy` and `ui`.
- The default branch is `master`. A push to `master` deploys.
- TypeScript is `strict`, with `noUnusedLocals` and `noUnusedParameters`. Code is compact: short helpers, few comments, and doc comments on exported types and non-obvious functions. Match that density.
- Python uses type hints on public functions and puts module constants in `UPPER_CASE` at the top. Shared constants live in `pipeline/config.py`, and threshold constants live beside the code that uses them (e.g. `network.py`).
- Generated data (`web/public/data/`), downloads (`pipeline/cache/`) and local realtime CSVs (`pipeline/realtime/`) are git-ignored. Never commit them. Vendored inputs under `pipeline/data/` *are* committed on purpose.
- UI copy is English. Place names keep their Portuguese spelling and accents.
