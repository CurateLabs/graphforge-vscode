"""GraphForge VS Code Python bridge host (issue #12).

Ships with the extension (never executed from workspace-local Python) and is
spawned as a long-lived subprocess for one open project. It speaks a small,
versioned, newline-delimited JSON protocol over stdin/stdout so the extension
can execute Cypher and analyst verbs against the PyPI `graphforge` package
without reimplementing any engine semantics here — every request is a thin
marshal to a `graphforge.GraphForge` method call, and every table result is
returned as an Arrow IPC stream (base64) so the extension's existing
`apache-arrow` decode path (shared with the Node binding) can consume it
unchanged.

Protocol (see docs/engineering/ARCHITECTURE.md "Python bridge protocol"):

  Request  (one JSON object per line on stdin):
    {"id": <int>, "op": <str>, ...op-specific fields}

  Response (one JSON object per line on stdout):
    {"id": <int>, "protocol_version": 1, "ok": true, "result": {...}}
    {"id": <int>, "protocol_version": 1, "ok": false,
     "error": <str>, "error_kind": <str>, "code": <str|null>}

Ops: "open", "execute", "verb", "labels", "relationship_types",
"ontology_mode", "load_ontology", "list_assertions", "close".

Never prints anything other than protocol JSON lines to stdout; diagnostics
go to stderr. Exits after a successful "close" or a fatal top-level error.
"""

from __future__ import annotations

import base64
import io
import json
import sys
import traceback
from typing import Any

PROTOCOL_VERSION = 1


class HostError(Exception):
    """Raised for protocol-level problems (unknown op, bad args)."""


def _encode_table(table: Any) -> dict[str, Any]:
    import pyarrow as pa  # local import: keep startup fast when unused

    if not isinstance(table, pa.Table):
        # Some verbs may already return dict/list payloads (e.g. embedding
        # metadata); pass through as JSON-able result instead of an Arrow blob.
        return {"json": table}
    sink = io.BytesIO()
    with pa.ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    return {"arrow_ipc_base64": base64.b64encode(sink.getvalue()).decode("ascii")}


def _kwargs(**fields: Any) -> dict[str, Any]:
    """Drop None-valued fields so callee defaults apply instead of overriding them."""
    return {k: v for k, v in fields.items() if v is not None}


class Session:
    def __init__(self) -> None:
        self.forge: Any = None

    def handle(self, request: dict[str, Any]) -> dict[str, Any]:
        op = request.get("op")
        if op == "open":
            return self._open(request)
        if self.forge is None:
            raise HostError(f"no project open — cannot handle op {op!r}")
        if op == "execute":
            return self._execute(request)
        if op == "verb":
            return self._verb(request)
        if op == "labels":
            return {"labels": list(self.forge.labels())}
        if op == "relationship_types":
            return {"relationship_types": list(self.forge.relationship_types())}
        if op == "ontology_mode":
            return {"ontology_mode": self.forge.ontology_mode}
        if op == "load_ontology":
            path = request.get("path")
            if not path:
                raise HostError("load_ontology requires 'path'")
            self.forge.load_ontology(path)
            return {}
        if op == "list_assertions":
            table = self.forge.list_assertions()
            return _encode_table(table)
        if op == "close":
            self._close()
            return {"closed": True}
        raise HostError(f"unknown op {op!r}")

    def _open(self, request: dict[str, Any]) -> dict[str, Any]:
        import graphforge as g

        path = request.get("path")
        if not path:
            raise HostError("open requires 'path'")
        if self.forge is not None:
            self._close()
        self.forge = g.GraphForge(path, write_mode="single_writer")
        return {
            "path": self.forge.path,
            "ontology_mode": self.forge.ontology_mode,
            "graphforge_version": getattr(g, "__version__", None),
        }

    def _execute(self, request: dict[str, Any]) -> dict[str, Any]:
        cypher = request.get("cypher")
        if not cypher:
            raise HostError("execute requires 'cypher'")
        params = request.get("params") or None
        table = self.forge.execute(cypher, params)
        return _encode_table(table)

    def _verb(self, request: dict[str, Any]) -> dict[str, Any]:
        verb = request.get("verb")
        args = request.get("args") or {}
        label = args.get("label")
        by = args.get("by")
        via = args.get("via")
        directed = args.get("directed")
        k = args.get("k")

        if verb == "rank":
            table = self.forge.rank(label, **_kwargs(by=by, via=via, directed=directed))
        elif verb == "cluster":
            table = self.forge.cluster(label, **_kwargs(by=by, via=via, directed=directed))
        elif verb == "paths":
            table = self.forge.paths(
                args.get("source"),
                args.get("target"),
                **_kwargs(by=by, via=via, directed=directed, k=k),
            )
        elif verb == "analyze":
            table = self.forge.analyze(label, **_kwargs(by=by, via=via, directed=directed))
        elif verb == "similar":
            table = self.forge.similar(label, **_kwargs(by=by, k=k))
        elif verb == "find":
            table = self.forge.find(args.get("query"), **_kwargs(label=label, limit=k))
        else:
            raise HostError(f"unknown verb {verb!r}")
        return _encode_table(table)

    def _close(self) -> None:
        if self.forge is not None:
            try:
                self.forge.close()
            finally:
                self.forge = None


def _error_payload(err: BaseException) -> dict[str, Any]:
    return {
        "error": str(err),
        "error_kind": type(err).__name__,
        "code": getattr(err, "code", None),
    }


def main() -> None:
    session = Session()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id: Any = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            result = session.handle(request)
            response: dict[str, Any] = {
                "id": request_id,
                "protocol_version": PROTOCOL_VERSION,
                "ok": True,
                "result": result,
            }
        except Exception as err:  # noqa: BLE001 - marshal every failure to the client
            response = {
                "id": request_id,
                "protocol_version": PROTOCOL_VERSION,
                "ok": False,
                **_error_payload(err),
            }
            print(traceback.format_exc(), file=sys.stderr)
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()
        if request.get("op") == "close" and response.get("ok"):
            break


if __name__ == "__main__":
    main()
