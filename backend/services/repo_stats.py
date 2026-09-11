"""Live repository statistics.

Pulls real file counts, Python line-of-code totals, test-function counts, and
commit counts straight from the sibling project repositories so the
About-section counters are backed by the actual repos rather than hand-typed
estimates.

Counts are computed on demand (no cache) so they stay honest as the repos
change. ``git`` is shelled out for commit counts; if a repo or git is missing
the field degrades to ``0`` rather than raising.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from typing_extensions import TypedDict

from .. import config

#: Matches test-function definitions (pytest collects ``def test_*``).
_TEST_FUNC = re.compile(r"^\s*def\s+test_")


class RepoStats(TypedDict):
    """Per-repository statistics."""

    name: str
    present: bool
    files: int
    py_files: int
    py_loc: int
    commits: int


class StatsPayload(TypedDict):
    """Full stats payload returned by :func:`get_stats`."""

    projects_shipped: int
    files_committed: int
    lines_of_code: int
    commits_pushed: int
    automated_tests: int
    repos: list[RepoStats]


def _count_repo_files(repo_dir: Path) -> tuple[int, int, int]:
    """Return ``(total_files, py_files, py_loc)`` for one repository.

    Walks the tree, skipping VCS and cache directories, and counts Python
    source lines.
    """
    total_files = 0
    py_files = 0
    py_loc = 0
    for root, _dirs, files in _walk(repo_dir):
        for name in files:
            total_files += 1
            if name.endswith(".py"):
                py_files += 1
                py_loc += _line_count(root / name)
    return total_files, py_files, py_loc


def _walk(base: Path):
    """``os.walk``-style generator that prunes :data:`config.WALK_SKIP` dirs."""
    import os

    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in config.WALK_SKIP]
        yield Path(root), dirs, files


def _line_count(path: Path) -> int:
    """Return the number of lines in a file, or 0 if unreadable."""
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as fh:
            return sum(1 for _ in fh)
    except OSError:
        return 0


def _count_test_functions(repo_dir: Path) -> int:
    """Count ``def test_`` functions across the Python files of one tree."""
    total = 0
    for root, _dirs, files in _walk(repo_dir):
        for name in files:
            if not name.endswith(".py"):
                continue
            try:
                with (root / name).open("r", encoding="utf-8", errors="ignore") as fh:
                    total += sum(1 for line in fh if _TEST_FUNC.match(line))
            except OSError:
                continue
    return total


def _git_commit_count(repo_dir: Path) -> int:
    """Return ``git rev-list --count HEAD`` for a repo, or 0 on any failure."""
    try:
        out = subprocess.run(
            ["git", "-C", str(repo_dir), "rev-list", "--count", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        return int(out.stdout.strip() or 0)
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0


def get_stats() -> StatsPayload:
    """Compute live stats for every sibling repo plus the aggregate the site shows."""
    repos: list[RepoStats] = []
    tot_files = tot_py = tot_loc = tot_commits = tot_tests = 0
    for name in config.REPO_NAMES:
        repo_dir = config.SERVER_DIR / name
        if not repo_dir.is_dir():
            repos.append(
                {
                    "name": name,
                    "present": False,
                    "files": 0,
                    "py_files": 0,
                    "py_loc": 0,
                    "commits": 0,
                }
            )
            continue
        files, py_files, py_loc = _count_repo_files(repo_dir)
        commits = _git_commit_count(repo_dir)
        repos.append(
            {
                "name": name,
                "present": True,
                "files": files,
                "py_files": py_files,
                "py_loc": py_loc,
                "commits": commits,
            }
        )
        tot_files += files
        tot_py += py_files
        tot_loc += py_loc
        tot_commits += commits
        tot_tests += _count_test_functions(repo_dir)

    # The site's own backend suite counts toward the total too.
    tot_tests += _count_test_functions(config.BACKEND_DIR)

    return {
        "projects_shipped": len(config.REPO_NAMES),
        "files_committed": tot_files,
        "lines_of_code": tot_loc,
        "commits_pushed": tot_commits,
        "automated_tests": tot_tests,
        "repos": repos,
    }
