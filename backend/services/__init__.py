"""Demo data services for the portfolio backend.

Each service backs one project card with *real* computed data:

* :mod:`repo_stats`    -- live files / lines-of-code / commit counts from git.
* :mod:`contract_diff` -- real OpenAPI breaking-change diff (Orders API v1.2.0 vs v1.3.0).
* :mod:`profiling`     -- real CPU-time profiling via the Performance Profiler
  ``@profile`` decorator.
* :mod:`vuln_scan`     -- real vulnerability scan reusing the Vulnerability
  Scanner pattern engine.
"""
