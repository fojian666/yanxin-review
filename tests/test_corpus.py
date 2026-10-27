"""公开政策语料（corpus/ → documents）的回归测试。

覆盖四件事：
1. 溯源清单字段齐全、文本 sha256 与清单一致（来源可查）；
2. 导入幂等，--force 可重建；
3. 分块带上条号，供预审按条引用；
4. 预审的政策依据去重，且仍然只给提示、不给结论。
"""
import hashlib
import json

import pytest

from rag import corpus, db, review


def _tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "corpus.db")
    db.init_db()


def _stub_retriever(monkeypatch):
    monkeypatch.setattr(corpus.retriever, "rebuild", lambda: None)


def _manifest(tmp_path, text: str = "第一章 总则\n\n第一条 为规范测试。\n\n第二条 本办法适用于测试。") -> dict:
    path = tmp_path / "policy.txt"
    path.write_text(text, encoding="utf-8")
    return {
        "schema_version": 1,
        "sources": [
            {
                "id": "unit_test_policy",
                "kind": "policy",
                "title": "测试用政策",
                "issuer": "测试机关",
                "doc_no": "测规〔2026〕1号",
                "year": 2026,
                "url": "https://example.gov.cn/policy.html",
                "license": "政府公开信息",
                "fetched_at": "2026-01-01T00:00:00+08:00",
                "text_path": str(path),
                "text_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "text_chars": len(text),
            }
        ],
    }


def test_repo_manifest_matches_snapshots():
    """仓库自带清单的每条语料都要有来源、许可与一致的 sha256。"""
    manifest_path = corpus.MANIFEST
    if not manifest_path.exists():
        pytest.skip("尚未生成 corpus/sources.json")
    manifest = corpus.load_manifest()
    required = {"id", "title", "url", "license", "fetched_at", "text_path", "text_sha256"}
    for entry in manifest["sources"]:
        missing = required - set(entry)
        assert not missing, f"{entry.get('id')} 缺字段 {missing}"
        payload = (corpus.BASE_DIR / entry["text_path"]).read_bytes()
        assert hashlib.sha256(payload).hexdigest() == entry["text_sha256"]
        assert entry["url"].startswith("http")


def test_missing_manifest_raises(tmp_path):
    with pytest.raises(corpus.CorpusError):
        corpus.load_manifest(tmp_path / "nope.json")


def test_missing_text_file_raises(tmp_path):
    manifest = _manifest(tmp_path)
    manifest["sources"][0]["text_path"] = "policy/missing.txt"
    with pytest.raises(corpus.CorpusError):
        corpus.policy_entries(manifest, root=tmp_path)


def test_path_traversal_is_blocked(tmp_path):
    """清单随仓库分发且启动时自动导入，越界路径必须拒绝，不能变成任意文件读取。"""
    manifest = _manifest(tmp_path)
    for bad in ("../../../etc/hosts", "/etc/hosts", "policy/../../outside.txt"):
        manifest["sources"][0]["text_path"] = bad
        with pytest.raises(corpus.CorpusError):
            corpus.policy_entries(manifest, root=tmp_path)


def test_text_sha_mismatch_is_blocked(tmp_path):
    """快照被改动或截断时要拦住，不能静默入库。"""
    manifest = _manifest(tmp_path)
    manifest["sources"][0]["text_sha256"] = "0" * 64
    with pytest.raises(corpus.CorpusError):
        corpus.policy_entries(manifest, root=tmp_path)


def test_load_policies_works_on_empty_database(tmp_path, monkeypatch):
    """run.sh 在 uvicorn 之前调用，此时库表还不存在，不能报 no such table。"""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "fresh.db")  # 故意不 init_db
    _stub_retriever(monkeypatch)
    result = corpus.load_policies(manifest=_manifest(tmp_path), root=tmp_path)
    assert len(result["loaded"]) == 1


def test_load_policies_is_idempotent(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    _stub_retriever(monkeypatch)
    manifest = _manifest(tmp_path)

    first = corpus.load_policies(manifest=manifest, root=tmp_path)
    assert len(first["loaded"]) == 1 and first["chunks"] > 0

    second = corpus.load_policies(manifest=manifest, root=tmp_path)
    assert second["loaded"] == [] and second["skipped"][0]["reason"] == "已入库"
    assert len([d for d in db.list_documents() if d["kind"] == "policy"]) == 1

    forced = corpus.load_policies(force=True, manifest=manifest, root=tmp_path)
    assert len(forced["loaded"]) == 1
    assert len([d for d in db.list_documents() if d["kind"] == "policy"]) == 1


def test_imported_policy_keeps_provenance(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    _stub_retriever(monkeypatch)
    corpus.load_policies(manifest=_manifest(tmp_path), root=tmp_path)

    doc = [d for d in db.list_documents() if d["kind"] == "policy"][0]
    assert doc["source"] == "public"
    assert "测规〔2026〕1号" in doc["name"]
    meta = db.get_document(doc["id"])["meta"]
    assert meta["url"].startswith("https://")
    assert meta["license"] and meta["fetched_at"] and meta["text_sha256"]


def test_chunks_carry_article_number(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    _stub_retriever(monkeypatch)
    corpus.load_policies(manifest=_manifest(tmp_path), root=tmp_path)

    doc = [d for d in db.list_documents() if d["kind"] == "policy"][0]
    sections = [c["section"] for c in db.get_chunks(doc["id"])]
    assert any("第一条" in s for s in sections)
    assert all(s.startswith("第一章") for s in sections if s)


def test_article_label_follows_chunk_start():
    """块首落在上一条正文中间时，标签必须是上一条，不能指向块内下一个条号。"""
    source = "第一章 总则\n第一条 甲字。\n第二条 乙字。\n第三条 丙字。"
    chunks = [
        {"idx": 0, "page": None, "section": "第一章 总则", "text": "第一章 总则\n第一条 甲字。"},
        # 块首是第二条的后半段，块内还含第三条
        {"idx": 1, "page": None, "section": "第一章 总则", "text": "第一章 总则\n乙字。\n第三条 丙字。"},
    ]
    corpus._label_articles(chunks, source)
    assert chunks[0]["section"] == "第一章 总则 · 第一条"
    assert chunks[1]["section"] == "第一章 总则 · 第二条"


def test_normalize_keeps_fullwidth_punctuation():
    """政策引用要保留全角标点；全角数字仍要转半角（检索与年份抽取依赖）。"""
    from rag.text import normalize_text

    assert normalize_text("（一）２０２２年；") == "（一）2022年；"


def test_non_policy_entries_are_ignored(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    _stub_retriever(monkeypatch)
    manifest = _manifest(tmp_path)
    manifest["sources"][0]["kind"] = "paper"
    assert corpus.policy_entries(manifest, root=tmp_path) == []
    assert corpus.load_policies(manifest=manifest, root=tmp_path)["loaded"] == []


def test_review_policy_cites_are_deduped_and_keep_disclaimer():
    """同一文件同一章节的多条命中只算一条；结论仍是提示 + 人工核对。"""
    cites = [
        {"doc_name": "某办法", "section": "第一章 总则 · 第一条", "text": "第一条 正文A"},
        {"doc_name": "某办法", "section": "第一章 总则 · 第一条", "text": "第一条 正文A"},
        {"doc_name": "某办法", "section": "第二章 责任 · 第三条", "text": "第三条 正文B"},
    ]
    sections, _questions = review._heuristic_sections(
        "研究内容：测试。", {"name": "测试本子"}, [], cites, True
    )
    items = {s["key"]: s for s in sections}["policy"]["items"]
    assert len(items) == 2
    assert "第一条" in items[0]["label"] and "第三条" in items[1]["label"]
    for item in items:
        assert "人工核对" in item["detail"]
        assert "score" not in item and "level" not in item


def test_default_manifest_cannot_read_project_files(tmp_path, monkeypatch):
    manifest = _manifest(tmp_path)
    monkeypatch.setattr(corpus, "BASE_DIR", tmp_path)
    allowed = tmp_path / "corpus"
    allowed.mkdir()
    monkeypatch.setattr(corpus, "CORPUS_DIR", allowed)
    for path in ("policy.txt", str(tmp_path / "policy.txt"), "corpus/../policy.txt"):
        manifest["sources"][0]["text_path"] = path
        with pytest.raises(corpus.CorpusError):
            corpus.policy_entries(manifest)
    (allowed / "escape.txt").symlink_to(tmp_path / "policy.txt")
    manifest["sources"][0]["text_path"] = "corpus/escape.txt"
    with pytest.raises(corpus.CorpusError):
        corpus.policy_entries(manifest)


def test_manifest_requires_valid_sha(tmp_path):
    manifest = _manifest(tmp_path)
    for bad in (None, "", "xyz", "g" * 64):
        manifest["sources"][0]["text_sha256"] = bad
        with pytest.raises(corpus.CorpusError, match="sha256"):
            corpus.policy_entries(manifest, root=tmp_path)


def test_article_alignment_survives_paragraph_joining():
    source = "第一章 总则\n\n第二十条 上一段正文结束。\n\n紧接正文。\n\n第二十一条 下一条正文。"
    chunks = [{"section": "第一章 总则", "text": "第一章 总则\n上一段正文结束。\n紧接正文。\n第二十一条 下一条正文。"}]
    corpus._label_articles(chunks, source)
    assert chunks[0]["section"] == "第一章 总则 · 第二十条"
    unknown = [{"section": "第一章 总则", "text": "无法定位的片段。第二十一条 下一条正文。"}]
    corpus._label_articles(unknown, source)
    assert unknown[0]["section"] == "第一章 总则"
    entry = next(e for e in corpus.policy_entries() if e["id"] == "most_research_misconduct")
    from rag.text import chunk_document
    actual = chunk_document([{"page": None, "text": entry["_text"]}], 700, 100)
    corpus._label_articles(actual, entry["_text"])
    assert actual[6]["section"] == "第二节 调查 · 第二十条"
    assert actual[9]["section"] == "第四章 处理 · 第三十条"


def test_existing_policy_relabels_without_changing_citations(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    _stub_retriever(monkeypatch)
    manifest = _manifest(tmp_path)
    corpus.load_policies(manifest=manifest, root=tmp_path)
    doc_id = db.public_policy_docs()["unit_test_policy"]
    original = db.get_chunks(doc_id)
    with db.connect() as conn:
        conn.execute("UPDATE chunks SET section = '第一章 总则 · 第二条' WHERE doc_id = ?", (doc_id,))
    result = corpus.load_policies(manifest=manifest, root=tmp_path)
    assert result["relabeled"] == len(original)
    assert db.get_chunks(doc_id) == original
    assert corpus.load_policies(manifest=manifest, root=tmp_path)["relabeled"] == 0
    # 已存快照不一致时保留旧元数据，不能用另一版本快照重新解释旧引用。
    with db.connect() as conn:
        conn.execute("UPDATE documents SET meta_json = '{}' WHERE id = ?", (doc_id,))
        conn.execute("UPDATE chunks SET section = '旧版本章名' WHERE doc_id = ?", (doc_id,))
    assert corpus.load_policies(manifest=manifest, root=tmp_path)["relabeled"] == 0
    assert all(c["section"] == "旧版本章名" for c in db.get_chunks(doc_id))



def test_force_rebuild_preserves_policies_removed_from_manifest(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    _stub_retriever(monkeypatch)
    manifest = _manifest(tmp_path)
    corpus.load_policies(manifest=manifest, root=tmp_path)
    old_id = db.public_policy_docs()["unit_test_policy"]
    manifest["sources"][0]["id"] = "replacement_policy"
    corpus.load_policies(force=True, manifest=manifest, root=tmp_path)
    assert db.public_policy_docs()["unit_test_policy"] == old_id
    assert db.get_chunks(old_id)


def test_policy_fetch_requires_https_and_refuses_redirects(monkeypatch):
    import urllib.error
    import urllib.request
    from tools import fetch_corpus as fetch

    calls = []

    class FakeOpener:
        def open(self, request, **kwargs):
            calls.append(request.full_url)
            raise urllib.error.HTTPError(request.full_url, 307, "redirect", {}, None)

    def build_opener(handler):
        assert isinstance(handler, fetch._NoRedirect)
        return FakeOpener()

    monkeypatch.setattr(urllib.request, "build_opener", build_opener)
    url = fetch.SOURCES[0]["url"]
    for invalid in (url.replace("https:", "http:"), "https://example.com/policy"):
        with pytest.raises(RuntimeError, match="HTTPS"):
            fetch._http_get(invalid)
    assert calls == []
    with pytest.raises(RuntimeError, match="307"):
        fetch._http_get(url)
    assert calls == [url]  # 重定向既不跟随，也不重试
    request = urllib.request.Request(url)
    for target in ("https://evil.example/policy", url, url.replace("https:", "http:")):
        with pytest.raises(urllib.error.HTTPError):
            fetch._NoRedirect().redirect_request(request, None, 307, "redirect", {}, target)
