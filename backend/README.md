# Portfolio demo backend

A small FastAPI backend that serves the portfolio site and its eight interactive
demos with computed project data. It binds to `127.0.0.1`; in production the
public site reaches it through the configured reverse proxy. Do not expose the
application port directly.

## What it provides

| Endpoint          | Backs                                        | Data source |
|-------------------|----------------------------------------------|-------------|
| `GET /api/health` | Backend liveness                             | Engine presence |
| `GET /api/stats`  | Repository files, Python lines, commits, tests, CI workflows | Sibling repository trees and Git history |
| `GET /api/summary` | Hero snapshot (cached 10 min) | Live demo count, Python lines, test functions, CI workflows |
| `GET /api/contract` | Contract demo: v1.2.0 -> v1.3.0 diff plus both spec texts | Direction-aware diff of the bundled Orders API fixtures |
| `POST /api/contract` | Contract demo: re-diff an edited v1.3.0 | Same diff, against the visitor's YAML |
| `POST /api/contract/validate` | Contract demo: validate a response body | api-contract-tester's enforcer (`contract_enforcer.py`) |
| `GET /api/profile?fixes=` | Profiler demo: measure, fix, measure | performance-profiler's `@profile` on an order-report workload |
| `GET /api/scan`     | Scanner demo: graded scan | vulnerability-scanner engine on a labeled, deliberately vulnerable sample app |
| `POST /api/scan/snippet` | Scanner demo: pasted code | Same engine and rules |
| `POST /api/rag`     | Code-RAG demo | Proxied call to the code-rag server (BM25 retrieval, extractive answers) |
| `GET /api/chaos`, `POST /api/chaos/run`, `WS /ws/chaos` | FaultLine demo | Saved and live FaultLine experiments: CPU pressure, network delay or process kill, with or without a mitigation |
| `POST /api/cnc/visualize` | G-Code Visualizer | Python modal parser with Matplotlib SVG export |
| `POST /api/cnc/convert` | DXF to G-Code Converter | ezdxf extraction; feed, depth, safe Z; contour-to-line map; cycle time |
| `POST /api/cnc/optimize` | G-Code Optimizer | Nearest neighbor, X sort and 2-opt; `"all"` compares them; `layout: "random"` |
| `GET /api/cnc/sample/{name}` | Sample DXF downloads | Bundled millimetre drawings |

Endpoints that do real CPU work are rate limited per client (`backend/ratelimit.py`):
FaultLine runs 4 per 10 minutes, profiles 20 per minute, and so on. One FaultLine
experiment runs at a time; other visitors watch it live. The last result for each
FaultLine scenario is saved to `PORTFOLIO_CACHE_DIR` (default `<server dir>/cache`).

The backend reuses the *actual* engines from the sibling projects rather than
copying them:

- `performance-profiler/profiler.py`: the `@profile` decorator (real CPU,
  wall and memory measurements) on an order report with three classic
  slowdowns (N+1 queries, list membership, a scan per day) and their fixes.
  SQLite runs in-process, so each query also sleeps 0.1 ms to model a database
  round trip; that is what makes N+1 show up as waiting rather than CPU.
- `vulnerability-scanner/backend/services/scanner.py`: the project's own
  engine, run on `samples/scan_target` (a small shop app with planted flaws and
  safe look-alikes, labeled in `expected.json`) so the demo reports measured
  precision and recall, and on snippets visitors paste.
- `api-contract-tester/backend/services/contract_enforcer.py`: the project's
  enforcer validates a response body against the contract.
- `contract_diff` implements the OpenAPI version diff directly. It is
  direction-aware: the same change can break request writers but not response
  readers (a new required field) or the reverse (a removed field).
- `rag` proxies to the code-rag project's own demo server (`coderag.main:app`),
  so the cited answers come from the project's real retrieval pipeline.
- `chaos` runs FaultLine's `ExperimentRunner` against FaultLine's bundled
  shop service.

The sibling repositories are expected to live next to this checkout (all under
the same parent directory). Override the parent path with the
`PORTFOLIO_SERVER_DIR` environment variable if they live elsewhere.

The three CNC demos run entirely in this backend (`backend/services/cnc.py`)
with `ezdxf` and `matplotlib`. Repository counters count the five sibling
repositories, not the eight showcased projects.

The visualizer supports G0/G1, XY G2/G3 with incremental I/J or R centers,
G20/G21, G90/G91 and drilling cycles (G81-G89, drawn as holes). Codes that do not
change the XY path (tool changes, spindle, coolant, offsets) are skipped with an
`info` note; codes whose motion cannot be previewed (G28, G53, G92) and cutter
compensation are skipped with a `warning` note. Real programs therefore render
instead of failing, and every skipped code is listed with its lines.
DXF conversion accepts planar LINE, LWPOLYLINE (including bulges), ARC, and CIRCLE
entities in mm or unitless drawings (assumed mm). Curves are tessellated at up to
2 degrees per chord. ASCII inputs are bounded to 500 KB and 100 entities; converted
programs and edited G-code are bounded to 2,000 lines and 10,000 preview points.

The optimizer compares nearest-neighbor, X-sorted and 2-opt contour orders,
preserving each contour's direction and starting vertex. 2-opt refines the
nearest-neighbor tour; because travel is asymmetric (a contour can end away from
its start), each reversal is scored with prefix sums of forward and backward
edge costs, O(n^2) per pass. It keeps the original order when a heuristic is
worse. Reported savings concern XY rapid distance from origin and exclude Z
travel; the converter's cycle time is an estimate at the programmed feed with
5,000 mm/min rapids. Generated programs are
geometry previews with fixed Z5 clearance and Z−1 depth, without machine tooling
or cutter compensation. Review the program and controller setup before machining.
Uploaded drawings are read from the request and are not stored by these routes.

The RAG demo additionally expects the code-rag demo server to be running on
`127.0.0.1:8090` (override with `CODE_RAG_HOST` / `CODE_RAG_PORT`). If it is
not up, the RAG demo degrades to an "offline" indicator like the other demos.

## Running

From this directory:

```bash
pip install -r requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8085
```

The site itself is served separately (e.g. `python -m http.server 8080`). The
frontend resolves the API base automatically: same-origin when served by this
backend, otherwise `http://<host>:8085` for `localhost`/`127.0.0.1`.

Demos load their results when they scroll into view. If the backend is down,
each card says so and keeps its layout; nothing is presented as a live result.

## Testing

```bash
python -m pytest backend/tests -q
```

The tests assert that each service returns data (positive CPU timings, scanner
matches from the configured repositories, and expected fixture-diff classes).
Scanner matches are heuristic and can be false positives.
