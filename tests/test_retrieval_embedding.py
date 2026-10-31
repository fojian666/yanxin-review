"""向量检索接入的单元测试：全部用假嵌入器，不发真实请求。"""
import numpy as np
import pytest

from rag import config, db
from rag.embeddings import Embedder, EmbeddingUnavailable
from rag.retrieval import Retriever

DOCS = [
    {"id": "d1", "name": "甲文档", "kind": "policy"},
    {"id": "d2", "name": "乙文档", "kind": "proposal"},
]
CHUNKS = [
    {"id": "c1", "doc_id": "d1", "idx": 0, "section": "", "text": "无关内容甲", "page": None},
    {"id": "c2", "doc_id": "d2", "idx": 0, "section": "", "text": "无关内容乙", "page": None},
]


class FakeEmbedder:
    """按文本里的字返回固定方向，好让排序结果可预测。"""

    def __init__(self, fail_on: str | None = None) -> None:
        self.batch_calls = 0
        self.texts_seen: list[str] = []
        self.fail_on = fail_on

    def status(self) -> dict:
        return {
            "backend": "local",
            "model": "fake-embed",
            "base_url": "",
            "reason": "",
            "enabled": True,
        }

    def embed(self, texts, cache: bool = True):
        self.batch_calls += 1
        self.texts_seen.extend(texts)
        vectors = []
        for text in texts:
            if self.fail_on and self.fail_on in text:
                raise EmbeddingUnavailable("假的失败")
            if "甲" in text:
                vec = np.array([1.0, 0.0], dtype=np.float32)
            elif "乙" in text:
                vec = np.array([0.0, 1.0], dtype=np.float32)
            else:
                vec = np.array([0.2, 0.98], dtype=np.float32)
            vectors.append(vec / np.linalg.norm(vec))
        return np.stack(vectors).astype(np.float32)


@pytest.fixture
def seeded_db(monkeypatch):
    monkeypatch.setattr(db, "list_documents", lambda: [dict(d) for d in DOCS])
    monkeypatch.setattr(db, "get_chunks", lambda: [dict(c) for c in CHUNKS])


def test_search_uses_embedding_when_available(seeded_db, monkeypatch):
    """TF-IDF 对「随便」几乎没有信号；向量说乙更近，结果就该是乙。"""
    import rag.retrieval as retrieval

    fake = FakeEmbedder()
    monkeypatch.setattr(retrieval, "embedder", fake)
    retriever = Retriever()
    retriever.rebuild()

    assert retriever.uses_embedding
    assert retriever.embed_model == "fake-embed"
    hits = retriever.search("随便", top_k=2)
    assert hits and hits[0]["doc_id"] == "d2"
    assert hits[0]["score"] > 0.9


def test_search_falls_back_to_tfidf_when_query_embedding_fails(seeded_db, monkeypatch):
    """查询向量化失败不能让接口报错，只能熔断回 TF-IDF。"""
    import rag.retrieval as retrieval

    fake = FakeEmbedder(fail_on="随便")
    monkeypatch.setattr(retrieval, "embedder", fake)
    retriever = Retriever()
    retriever.rebuild()
    assert retriever.uses_embedding

    hits = retriever.search("随便", top_k=2)
    assert isinstance(hits, list)  # 不抛异常
    assert retriever.uses_embedding is False  # 已熔断，后续不再试


def test_rebuild_drops_embedding_when_row_count_mismatches(seeded_db, monkeypatch):
    import rag.retrieval as retrieval

    class ShortEmbedder(FakeEmbedder):
        def embed(self, texts, cache: bool = True):
            return super().embed(texts)[:1]  # 少一行

    monkeypatch.setattr(retrieval, "embedder", ShortEmbedder())
    retriever = Retriever()
    retriever.rebuild()
    assert retriever.uses_embedding is False
    assert retriever.ready  # TF-IDF 仍然可用


def test_rebuild_survives_embedding_backend_down(seeded_db, monkeypatch):
    import rag.retrieval as retrieval

    class DownEmbedder(FakeEmbedder):
        def embed(self, texts, cache: bool = True):
            raise EmbeddingUnavailable("端点在维护")

    monkeypatch.setattr(retrieval, "embedder", DownEmbedder())
    retriever = Retriever()
    retriever.rebuild()
    assert retriever.uses_embedding is False
    assert retriever.search("无关", top_k=1)


def test_embedder_blocks_public_endpoint_without_permission(monkeypatch):
    monkeypatch.setattr(config, "EMBED_BACKEND", "api")
    monkeypatch.setattr(config, "EMBED_API_KEY", "sk-test")
    monkeypatch.setattr(config, "EMBED_BASE_URL", "https://api.example.com/v1")
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_EMBED", False)
    status = Embedder().status()
    assert status["backend"] == "none"
    assert "ALLOW_EXTERNAL_EMBED" in status["reason"]


def test_embedder_allows_loopback_endpoint_without_permission(monkeypatch):
    monkeypatch.setattr(config, "EMBED_BACKEND", "api")
    monkeypatch.setattr(config, "EMBED_API_KEY", "sk-test")
    monkeypatch.setattr(config, "EMBED_BASE_URL", "http://127.0.0.1:11434/v1")
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_EMBED", False)
    assert Embedder().status()["backend"] == "api"


def test_embedder_caches_per_text_not_per_batch(tmp_path, monkeypatch):
    """新增一条文本只该补算它自己，不能整批重算。"""
    monkeypatch.setattr(config, "EMBED_CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(config, "EMBED_MODEL", "fake-embed")
    monkeypatch.setattr(config, "EMBED_BACKEND", "api")
    monkeypatch.setattr(config, "EMBED_API_KEY", "sk-test")
    monkeypatch.setattr(config, "EMBED_BASE_URL", "http://127.0.0.1:9/v1")

    calls: list[list[str]] = []

    def fake_call(backend, texts):
        calls.append(list(texts))
        return np.ones((len(texts), 2), dtype=np.float32) / np.sqrt(2)

    embedder = Embedder()
    monkeypatch.setattr(embedder, "_call", fake_call)

    first = embedder.embed(["甲", "乙"])
    assert first.shape == (2, 2)
    assert calls == [["甲", "乙"]]

    second = embedder.embed(["甲", "乙", "丙"])
    assert second.shape == (3, 2)
    assert calls[-1] == ["丙"]  # 只补算新增的那条

    embedder.embed(["甲", "乙", "丙"])
    assert len(calls) == 2  # 全命中缓存，不再调用


def test_embedder_rebuilds_cache_on_dimension_change(tmp_path, monkeypatch):
    """换了维度不同的模型/端点，旧缓存必须整仓作废，不能留着坏条目。"""
    monkeypatch.setattr(config, "EMBED_CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(config, "EMBED_MODEL", "fake-embed")
    monkeypatch.setattr(config, "EMBED_BACKEND", "api")
    monkeypatch.setattr(config, "EMBED_API_KEY", "sk-test")
    monkeypatch.setattr(config, "EMBED_BASE_URL", "http://127.0.0.1:9/v1")

    embedder = Embedder()
    dims = iter([2, 3, 3])  # 第二次调用后维度变了，重建时会整批再算一次
    monkeypatch.setattr(
        embedder,
        "_call",
        lambda backend, texts: np.ones((len(texts), next(dims)), dtype=np.float32),
    )
    assert embedder.embed(["甲"]).shape == (1, 2)
    rebuilt = embedder.embed(["甲", "乙"])
    assert rebuilt.shape == (2, 3)
    # 旧的两维条目不能残留在缓存里
    assert all(v.shape[0] == 3 for v in embedder._load_store().values())


# ---------- _api 的重试/落位/归一化（打桩 requests.post，不发真实请求） ----------


class _Resp:
    def __init__(self, code, payload=None, headers=None):
        self.status_code = code
        self._payload = {} if payload is None else payload
        self.headers = headers or {}

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


def _api_embedder(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "EMBED_CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(config, "EMBED_MODEL", "fake-embed")
    monkeypatch.setattr(config, "EMBED_BACKEND", "api")
    monkeypatch.setattr(config, "EMBED_API_KEY", "sk-test")
    monkeypatch.setattr(config, "EMBED_BASE_URL", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_EMBED", False)
    return Embedder()


def test_api_does_not_retry_on_4xx(tmp_path, monkeypatch):
    """401 是鉴权问题，重试只会放大风险。"""
    import rag.embeddings as embeddings

    calls = []
    monkeypatch.setattr(
        embeddings.requests, "post", lambda *a, **k: calls.append(1) or _Resp(401)
    )
    embedder = _api_embedder(tmp_path, monkeypatch)
    with pytest.raises(EmbeddingUnavailable):
        embedder.embed(["甲"])
    assert len(calls) == 1


def test_api_retries_on_5xx_then_gives_up(tmp_path, monkeypatch):
    import rag.embeddings as embeddings

    calls = []
    monkeypatch.setattr(
        embeddings.requests, "post", lambda *a, **k: calls.append(1) or _Resp(500)
    )
    monkeypatch.setattr(embeddings.time, "sleep", lambda s: None)
    embedder = _api_embedder(tmp_path, monkeypatch)
    with pytest.raises(EmbeddingUnavailable):
        embedder.embed(["甲"])
    assert len(calls) == embeddings.ATTEMPTS


def test_api_places_vectors_by_index_not_by_order(tmp_path, monkeypatch):
    """服务端乱序返回时，不能把向量挂到别的文本上。"""
    import rag.embeddings as embeddings

    payload = {
        "data": [
            {"index": 1, "embedding": [0.0, 1.0]},
            {"index": 0, "embedding": [1.0, 0.0]},
        ]
    }
    monkeypatch.setattr(embeddings.requests, "post", lambda *a, **k: _Resp(200, payload))
    embedder = _api_embedder(tmp_path, monkeypatch)
    vectors = embedder.embed(["甲", "乙"])
    assert vectors[0].tolist() == [1.0, 0.0]
    assert vectors[1].tolist() == [0.0, 1.0]


def test_api_returns_normalized_vectors(tmp_path, monkeypatch):
    """丢了三行归一化，点积就不再等价余弦，阈值全部失真。"""
    import rag.embeddings as embeddings

    payload = {"data": [{"index": 0, "embedding": [3.0, 4.0]}]}
    monkeypatch.setattr(embeddings.requests, "post", lambda *a, **k: _Resp(200, payload))
    embedder = _api_embedder(tmp_path, monkeypatch)
    vector = embedder.embed(["甲"])[0]
    assert abs(float(np.linalg.norm(vector)) - 1.0) < 1e-6
    assert vector.tolist() == pytest.approx([0.6, 0.8])


def test_api_rejects_redirect(tmp_path, monkeypatch):
    """跟随 307 会把同一份文本重发到未校验的地址，等于绕过出口门禁。"""
    import rag.embeddings as embeddings

    calls = []

    def fake_post(*args, **kwargs):
        assert kwargs.get("allow_redirects") is False
        calls.append(1)
        return _Resp(307)

    monkeypatch.setattr(embeddings.requests, "post", fake_post)
    embedder = _api_embedder(tmp_path, monkeypatch)
    with pytest.raises(EmbeddingUnavailable):
        embedder.embed(["甲"])
    assert len(calls) == 1


# ---------- 缓存健壮性 ----------


def test_truncated_cache_heals_instead_of_dying(tmp_path, monkeypatch):
    """截断的 npz 抛的是 BadZipFile；不能让它把向量链路永久卡死。"""
    import rag.embeddings as embeddings

    embedder = _api_embedder(tmp_path, monkeypatch)
    monkeypatch.setattr(
        embeddings.requests,
        "post",
        lambda *a, **k: _Resp(200, {"data": [{"index": 0, "embedding": [1.0, 0.0]}]}),
    )
    embedder.embed(["甲"])
    path = embedder._store_path()
    assert path is not None and path.exists()
    path.write_bytes(path.read_bytes()[:40])  # 模拟写入中断

    fresh = _api_embedder(tmp_path, monkeypatch)
    again = fresh.embed(["甲"])  # 不抛异常，直接重算
    assert again.shape == (1, 2)
    assert fresh._store_path().exists()


def test_cache_namespace_separates_endpoints(tmp_path, monkeypatch):
    """换端点不能读到另一家的向量。"""
    first = _api_embedder(tmp_path, monkeypatch)
    first_status = first._resolve()
    key_a = first._text_key("甲")

    monkeypatch.setattr(config, "EMBED_BASE_URL", "http://127.0.0.1:11434/v1")
    second = Embedder()
    second._resolve()
    assert second._text_key("甲") != key_a
    assert first_status[0] == "api"


# ---------- 打分尺度与阈值 ----------


def test_query_embedding_not_persisted(tmp_path, monkeypatch):
    """查询向量不入盘：否则每换一种问法都要重写整份缓存。"""
    import rag.embeddings as embeddings

    embedder = _api_embedder(tmp_path, monkeypatch)
    monkeypatch.setattr(
        embeddings.requests,
        "post",
        lambda *a, **k: _Resp(200, {"data": [{"index": 0, "embedding": [1.0, 0.0]}]}),
    )
    embedder.embed(["分块文本"])
    saved = len(embedder._load_store())
    embedder.embed(["一个临时查询"], cache=False)
    assert len(embedder._load_store()) == saved


def test_score_floor_differs_by_backend(seeded_db, monkeypatch):
    import rag.retrieval as retrieval

    monkeypatch.setattr(config, "EMBED_MIN_SCORE", 0.3)
    monkeypatch.setattr(retrieval, "embedder", FakeEmbedder())
    retriever = Retriever()
    retriever.rebuild()
    assert retriever.score_floor == 0.3
    retriever.embed_matrix = None
    assert retriever.score_floor == 0.0


def test_query_dimension_drift_trips_embedding_breaker(seeded_db, monkeypatch):
    import rag.retrieval as retrieval

    class ThreeDimEmbedder(FakeEmbedder):
        def embed(self, texts, cache: bool = True):
            return np.ones((len(texts), 3), dtype=np.float32)

    monkeypatch.setattr(retrieval, "embedder", ThreeDimEmbedder())
    retriever = Retriever()
    retriever.rebuild()
    assert retriever.embed_matrix.shape == (len(CHUNKS), 3)
    retriever.embed_matrix = np.ones((len(CHUNKS), 2), dtype=np.float32)
    assert retriever._score_embedding("任意问题") is None
    assert retriever.uses_embedding is False


def test_policy_threshold_follows_backend(monkeypatch):
    """两种分值的尺度不同，阈值必须跟着后端走。"""
    from types import SimpleNamespace

    from rag import review as review_service

    monkeypatch.setattr(
        review_service, "retriever", SimpleNamespace(uses_embedding=True)
    )
    assert review_service._policy_min_score() == review_service.POLICY_MIN_SCORE_EMBED
    monkeypatch.setattr(
        review_service, "retriever", SimpleNamespace(uses_embedding=False)
    )
    assert review_service._policy_min_score() == review_service.POLICY_MIN_SCORE


def test_similarity_between_docs_stays_on_tfidf(seeded_db, monkeypatch):
    """查重必须走字面重合：接上向量后结果不能变。"""
    import rag.retrieval as retrieval

    monkeypatch.setattr(retrieval, "embedder", FakeEmbedder())
    with_embedding = Retriever()
    with_embedding.rebuild()
    assert with_embedding.uses_embedding
    baseline = with_embedding.similarity_between_docs("d1", top_k=5)

    with_embedding.embed_matrix = None
    assert with_embedding.similarity_between_docs("d1", top_k=5) == baseline


def test_policy_is_searchable_but_excluded_before_duplicate_top_n(monkeypatch):
    text = "科研诚信声明：申请材料真实完整，遵守科研诚信相关规定。"
    docs = [{"id": "target", "name": "申报材料", "kind": "proposal"},
            {"id": "peer", "name": "另一申报材料", "kind": "proposal"},
            {"id": "policy", "name": "公开政策", "kind": "policy"}]
    chunks = [{"id": "target", "doc_id": "target", "text": text, "section": ""}]
    # 超过 top-80 的政策块不能挤掉真正的跨本子重复。
    chunks += [{"id": str(i), "doc_id": "policy", "text": text, "section": ""} for i in range(90)]
    chunks += [{"id": "peer", "doc_id": "peer", "text": text + "本项目", "section": ""}]
    monkeypatch.setattr(db, "list_documents", lambda: docs)
    monkeypatch.setattr(db, "get_chunks", lambda: chunks)
    monkeypatch.setattr(config, "EMBED_BACKEND", "none")
    retriever = Retriever()
    retriever.rebuild()
    matches = retriever.similarity_between_docs("target")
    assert [m["matched_doc_id"] for m in matches] == ["peer"]
    assert retriever.search(text, scope=["policy"])[0]["doc_id"] == "policy"
