# Portfolio demo backend

A small FastAPI backend that serves the portfolio site and its eight interactive
demos with computed project data. It binds to `127.0.0.1`; in production the
public site reaches it through the configured reverse proxy. Do not expose the
application port directly.

## What it provides

| Endpoint          | Backs                                        | Data source |
|-------------------|----------------------------------------------|-------------|
| `GET /api/health` | Backend liveness                             | Engine presence |
| `GET /api/stats`  | Repository files, Python source lines, Git commit totals, test-function definitions | Sibling repository trees, Git history, and test files |
| `GET /api/summary` | Hero snapshot | Repository counters plus heuristic scanner match count |
| `GET /api/contract` | OpenAPI compatibility demo | Reproducible diff of bundled Orders API v1.2.0 and v1.3.0 fixtures |
| `GET /api/profile`  | Performance profile demo | CPU timings from the performance-profiler `@profile` decorator |
| `GET /api/scan`     | Pattern-scan demo | Regex-based scan of the repositories; results are potential matches, not confirmed vulnerabilities |
| `POST /api/rag`     | Code-RAG demo | Proxied call to the code-rag server; retrieval answers are simulated or model-backed depending on its configuration |
| `POST /api/chaos/run`, `WS /ws/chaos` | FaultLine demo | Starts and streams a bounded local experiment with phase-level SLO grading |
| `WS /ws/profile`   | Profiler live stream | Live metric frames from the same decorator |
| `POST /api/cnc/visualize` | G-Code Visualizer | Python modal parser with Matplotlib SVG export |
| `POST /api/cnc/convert` | DXF to G-Code Converter | ezdxf extraction of planar drawing geometry |
| `POST /api/cnc/optimize` | G-Code Optimizer | Contour ordering with computed XY rapid travel |
| `GET /api/cnc/sample/{name}` | Sample DXF downloads | Bundled millimetre drawings |

The backend reuses the *actual* engines from the sibling projects rather than
copying them:

- `performance-profiler/profiler.py`: the `@profile` decorator (real timing).
- `vulnerability-scanner/backend/services/scanner.py`: the project's own
  `scan_codebase()` engine, called once per repo. Its regex results require
  human review; the portfolio does not present them as confirmed issues.
- `contract_diff` implements the OpenAPI version diff directly against the two
  bundled sample specs. The api-contract-tester project enforces a live
  endpoint against one spec; comparing two spec versions for breaking changes is
  a different job, so the demo keeps its own diff.
- `rag` proxies to the code-rag project's own demo server (`coderag.main:app`),
  so the cited answers come from the project's real retrieval pipeline.

The sibling repositories are expected to live next to this checkout (all under
the same parent directory). Override the parent path with the
`PORTFOLIO_SERVER_DIR` environment variable if they live elsewhere.

The three CNC demos are new portfolio implementations of the supplied project
descriptions; the original CNC source repositories were not available. They run
entirely in this backend with `ezdxf` and `matplotlib`. New cards are appended after
the existing five projects; repository counters still count the five sibling
repositories, not the eight showcased projects.

The visualizer supports G0/G1, XY G2/G3 with incremental I/J centers, G20/G21,
and G90/G91. It reports unsupported operations instead of silently skipping them.
DXF conversion accepts planar LINE, LWPOLYLINE (including bulges), ARC, and CIRCLE
entities in mm or unitless drawings (assumed mm). Curves are tessellated at up to
2 degrees per chord. ASCII inputs are bounded to 500 KB and 100 entities; converted
programs and edited G-code are bounded to 2,000 lines and 10,000 preview points.

The optimizer compares nearest-neighbor and X-sorted contour orders, preserving
each contour's direction and starting vertex. It keeps the original order when
a heuristic is worse. Reported savings concern XY rapid distance from origin;
they do not estimate machine time or include Z travel. Generated programs are
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

If the backend is down, the site keeps its illustrative examples visible and
marks live demos unavailable. The fixture diff filters still work on the sample
rows; live results appear when the backend is reachable.

## Testing

```bash
python -m pytest backend/tests -q
```

The tests assert that each service returns data (positive CPU timings, scanner
matches from the configured repositories, and expected fixture-diff classes).
Scanner matches are heuristic and can be false positives.
