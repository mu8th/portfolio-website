# Portfolio demo backend

A small FastAPI backend that drives the four project demos and the About
counters on the portfolio site with **real, computed data** instead of canned
values. It runs on `127.0.0.1` only and is never intended to be
hosted publicly.

## What it provides

| Endpoint          | Backs                                        | Data source |
|-------------------|----------------------------------------------|-------------|
| `GET /api/health` | Backend liveness                             | Engine presence |
| `GET /api/stats`  | About counters (files, LOC, commits)         | The sibling project repos, live via `git` + filesystem |
| `GET /api/contract` | "API Contract Tester" diff visual          | A real OpenAPI breaking-change diff (Orders API v1.2.0 -> v1.3.0) |
| `GET /api/profile`  | "Performance Profiler" flame visual               | Real CPU timings from the performance-profiler `@profile` decorator |
| `GET /api/scan`     | "Vulnerability Scanner" sweep visual                | A real regex-pattern scan of the repos |
| `POST /api/rag`     | "Local RAG Code Assistant" live answer     | A proxied call to the code-rag server's `/api/ask` (real retrieval + cited answer) |
| `WS  /ws/profile`   | "Performance Profiler" live stream                | Live metric frames from the same decorator |

The backend reuses the *actual* engines from the sibling projects rather than
copying them:

- `performance-profiler/profiler.py`: the `@profile` decorator (real timing).
- `vulnerability-scanner/backend/services/scanner.py`: the project's own
  `scan_codebase()` engine, called once per repo (real findings, including the
  offline dependency-advisory check).
- `contract_diff` implements the OpenAPI version diff directly against the two
  bundled sample specs. The api-contract-tester project enforces a live
  endpoint against one spec; comparing two spec versions for breaking changes is
  a different job, so the demo keeps its own diff.
- `rag` proxies to the code-rag project's own demo server (`coderag.main:app`),
  so the cited answers come from the project's real retrieval pipeline.

The sibling repositories are expected to live next to this checkout (all under
the same parent directory). Override the parent path with the
`PORTFOLIO_SERVER_DIR` environment variable if they live elsewhere.

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

If the backend is down, the site degrades gracefully: every demo card shows an
"offline" indicator and keeps its ambient visuals, and the counters fall back to
the values baked into the markup. Nothing on the page depends on the backend
being up.

## Testing

```bash
python -m pytest backend/tests -q
```

The tests assert that each service returns real data (positive CPU timings, a
non-empty real vulnerability scan, the expected breaking-change classes), not
hardcoded constants.
