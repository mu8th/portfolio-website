"""Demo data services for the portfolio backend.

Each service backs one project card with *real* computed data:

* :mod:`repo_stats`    -- repository file, Python-line, test-function, and commit counts.
* :mod:`contract_diff` -- OpenAPI fixture compatibility diff (Orders API v1.2.0 vs v1.3.0).
* :mod:`profiling`     -- real CPU-time profiling via the Performance Profiler
  ``@profile`` decorator.
* :mod:`vuln_scan`     -- heuristic pattern scan reusing the Vulnerability
  Scanner engine; matches require human review.
"""
