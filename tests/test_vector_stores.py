import sys
from types import SimpleNamespace

import numpy as np
import pytest

from rag import config
from rag.vector_stores import (
    MilvusVectorStore,
    NumpyVectorStore,
    PgVectorStore,
    create_vector_store,
)


def _chunks():
    return [
        {"id": "c1", "doc_id": "d1", "idx": 0, "section": "研究内容"},
        {"id": "c2", "doc_id": "d2", "idx": 0, "section": "技术路线"},
    ]


def _vectors():
    return np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)


def test_numpy_vector_store_scores_and_scope():
    store = NumpyVectorStore()
    store.index(_chunks(), _vectors(), "fake")
    scores = store.score(
        np.array([1.0, 0.0], dtype=np.float32),
        _chunks(),
        {"d1"},
    )
    assert scores.tolist() == [1.0, -1.0]
    assert store.status()["backend"] == "numpy"


def test_pgvector_store_uses_parameterized_cosine_query(monkeypatch):
    monkeypatch.setattr(config, "PGVECTOR_DIM", 2)
    records = []

    class Cursor:
        rowcount = 1

        def __init__(self, rows=None):
            self._rows = rows or []

        def fetchall(self):
            return self._rows

        def fetchone(self):
            return self._rows[0]

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, sql, params=()):
            records.append((sql, params))
            if "SELECT chunk_id" in sql:
                return Cursor([{"chunk_id": "c2", "score": 0.93}])
            if "COUNT(*)" in sql:
                return Cursor([{"count": 2}])
            return Cursor()

        def executemany(self, sql, rows):
            records.append((sql, tuple(rows)))
            return Cursor()

    monkeypatch.setattr("rag.vector_stores.db.connect", lambda: Connection())
    store = PgVectorStore()
    store.index(_chunks(), _vectors(), "fake")
    scores = store.score(
        np.array([0.0, 1.0], dtype=np.float32),
        _chunks(),
        {"d1", "d2"},
        20,
    )

    assert scores.tolist() == pytest.approx([-1.0, 0.93])
    score_sql, score_params = next(item for item in records if "SELECT chunk_id" in item[0])
    assert "<=> ?::vector" in score_sql
    assert "doc_id IN (?,?)" in score_sql
    assert score_params[0].startswith("[")
    assert store.status()["count"] == 2


def test_milvus_store_creates_collection_and_scores():
    calls = []

    class Client:
        def has_collection(self, name):
            calls.append(("has", name))
            return False

        def create_collection(self, **kwargs):
            calls.append(("create", kwargs))

        def insert(self, **kwargs):
            calls.append(("insert", kwargs))

        def flush(self, **kwargs):
            calls.append(("flush", kwargs))

        def search(self, **kwargs):
            calls.append(("search", kwargs))
            return [[{"id": "c2", "distance": 0.88}]]

    store = MilvusVectorStore()
    store._client = Client()
    store.index(_chunks(), _vectors(), "fake")
    scores = store.score(
        np.array([0.0, 1.0], dtype=np.float32),
        _chunks(),
        {"d2"},
        20,
    )
    assert scores.tolist() == pytest.approx([-1.0, 0.88])
    assert any(item[0] == "create" for item in calls)
    assert any(item[0] == "insert" for item in calls)


def test_vector_store_factory_honors_backend(monkeypatch):
    for backend, expected in (
        ("numpy", NumpyVectorStore),
        ("pgvector", PgVectorStore),
        ("milvus", MilvusVectorStore),
    ):
        monkeypatch.setattr(config, "VECTOR_STORE_BACKEND", backend)
        assert isinstance(create_vector_store(), expected)


def test_milvus_public_uri_requires_explicit_permission(monkeypatch):
    monkeypatch.setattr(config, "MILVUS_URI", "https://milvus.example.com:19530")
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_MILVUS", False)
    with pytest.raises(RuntimeError, match="ALLOW_EXTERNAL_MILVUS"):
        MilvusVectorStore()._get_client()


@pytest.mark.parametrize(
    "uri",
    ["http://127.0.0.1:19530", "http://milvus.internal:19530"],
)
def test_milvus_private_http_uri_is_allowed_without_external_opt_in(
    monkeypatch,
    uri,
):
    seen = []

    class Client:
        def __init__(self, **kwargs):
            seen.append(kwargs)

    monkeypatch.setitem(
        sys.modules,
        "pymilvus",
        SimpleNamespace(MilvusClient=Client),
    )
    monkeypatch.setattr(config, "MILVUS_URI", uri)
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_MILVUS", False)
    store = MilvusVectorStore()
    assert isinstance(store._get_client(), Client)
    assert seen == [{"uri": uri}]
