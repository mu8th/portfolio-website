"""Live RAG demo proxy for the code-rag project.

The code-rag project ships its own FastAPI demo server (``coderag.main:app``)
on a separate port (:data:`config.CODE_RAG_PORT`). The portfolio frontend only
talks to this backend, so this service acts as a thin same-origin proxy: it
forwards a natural-language question to code-rag's ``/api/ask`` endpoint with
stdlib ``urllib`` and returns the grounded answer plus its source citations.

No embeddings or LLM calls happen here: the real retrieval and synthesis run
inside the code-rag server, so the demo is backed by the project's actual code
rather than a copy. If the code-rag server is unreachable the function returns
a graceful error payload the frontend understands instead of raising, so the
site keeps working even when the demo server is down.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

from .. import config

logger = logging.getLogger("portfolio-backend.rag")

#: Default question used when the frontend does not supply one.
DEFAULT_QUESTION = "How does the retrieval index rank code chunks?"

#: Hard cap so a long answer can't bloat the payload.
_MAX_ANSWER_CHARS = 1400


def ask(question: str = DEFAULT_QUESTION) -> dict[str, Any]:
    """Forward a question to the code-rag server and return its cited answer.

    Args:
        question: The natural-language question to pose to the codebase.
            Falls back to :data:`DEFAULT_QUESTION` if empty.

    Returns:
        A dict with ``answer``, ``sources`` (cited code chunks), ``model``,
        ``latency_ms`` and ``status``. On any failure (server down, timeout,
        malformed response) returns ``status="ERROR"`` with an ``error`` field
        and safe defaults so the frontend can degrade gracefully.
    """
    question = (question or DEFAULT_QUESTION).strip() or DEFAULT_QUESTION
    url = f"http://{config.CODE_RAG_HOST}:{config.CODE_RAG_PORT}/api/ask"
    payload = json.dumps({"question": question}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        logger.warning("code-rag /api/ask unavailable: %s", exc)
        return {
            "status": "ERROR",
            "error": str(exc),
            "question": question,
            "answer": "",
            "sources": [],
            "model": "n/a",
            "latency_ms": 0,
        }

    sources = [
        {
            "path": s.get("path", ""),
            "symbol": s.get("symbol", ""),
            "start_line": s.get("start_line", 0),
            "score": round(float(s.get("score", 0.0)), 3),
        }
        for s in data.get("sources", [])[:4]
    ]
    answer = (data.get("answer") or "").strip()
    if len(answer) > _MAX_ANSWER_CHARS:
        answer = answer[:_MAX_ANSWER_CHARS].rsplit(" ", 1)[0] + "…"

    return {
        "status": "OK",
        "question": question,
        "answer": answer,
        "sources": sources,
        "model": data.get("model", "n/a"),
        "latency_ms": round(float(data.get("latency_ms", 0.0)), 0),
    }
