"""Exercise the shipped Python host without requiring a native Core or PyArrow install."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import UUID


root = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("graphforge_host", root / "python" / "graphforge_host.py")
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)

G1 = UUID("0190a000-0000-7000-8000-000000000001")
G2 = UUID("0190a000-0000-7000-8000-000000000002")


class Forge:
    generation = G1

    def committed_generation_identity(self):
        return {"generation_uuid": self.generation.bytes, "manifest_sha256": bytes(32)}

    def execute(self, query, params):
        if query == "MUTATE":
            self.generation = G2
        return query

    def rank(self, label, **kwargs):
        return "rank"


class HostGenerationTests(unittest.TestCase):
    def test_execute_and_verb_keep_identity_with_their_payload(self):
        session = host.Session()
        session.forge = Forge()
        with patch.object(host, "_encode_table", side_effect=lambda table: {"arrow_ipc_base64": table}):
            before = session.handle({"op": "execute", "cypher": "READ"})
            ranked = session.handle({"op": "verb", "verb": "rank", "args": {"label": "Person"}})
            mutation = session.handle({"op": "execute", "cypher": "MUTATE"})
        self.assertEqual(before, {"arrow_ipc_base64": "READ", "generation_uuid": str(G1)})
        self.assertEqual(ranked, {"arrow_ipc_base64": "rank", "generation_uuid": str(G1)})
        self.assertEqual(mutation, {"arrow_ipc_base64": "MUTATE", "generation_uuid": str(G2)})

    def test_identity_is_captured_before_encoding(self):
        session = host.Session()
        session.forge = Forge()

        def encode(table):
            session.forge.generation = G2
            return {"arrow_ipc_base64": "unchanged"}

        with patch.object(host, "_encode_table", side_effect=encode):
            result = session.handle({"op": "execute", "cypher": "READ"})
        self.assertEqual(result, {"arrow_ipc_base64": "unchanged", "generation_uuid": str(G1)})

    def test_older_core_without_identity_remains_inspectable(self):
        session = host.Session()
        session.forge = object()
        with patch.object(host, "_encode_table", return_value={"arrow_ipc_base64": "unchanged"}):
            self.assertEqual(session._result("table"), {"arrow_ipc_base64": "unchanged"})


if __name__ == "__main__":
    unittest.main()
