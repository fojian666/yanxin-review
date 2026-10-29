from rag import keyword_graph


def test_keyword_graph_uses_actual_context_and_ignores_orphans(monkeypatch):
    docs = [{"id": "one", "name": "演示文档"}]
    chunks = [
        {"doc_id": "one", "idx": 0, "text": "耕地遥感监测", "section": "研究内容", "page": 2},
        {"doc_id": "one", "idx": 1, "text": "耕地变化监测", "section": "方法", "page": None},
        {"doc_id": "missing", "idx": 0, "text": "不应出现", "section": "", "page": None},
    ]
    monkeypatch.setattr(keyword_graph.db, "list_documents", lambda: docs)
    monkeypatch.setattr(keyword_graph.db, "get_chunks", lambda: chunks)
    monkeypatch.setattr(keyword_graph, "_chunk_terms", lambda text: {
        "耕地遥感监测": ("耕地", "监测", "遥感"),
        "耕地变化监测": ("耕地", "监测", "变化"),
    }[text])
    result = keyword_graph.build_keyword_graph()
    assert {node["name"] for node in result["nodes"]} == {"耕地", "监测", "遥感", "变化"}
    node = next(node for node in result["nodes"] if node["name"] == "遥感")
    assert node["sources"][0]["section"] == "研究内容"
    assert node["sources"][0]["page"] == 2
    assert "遥感" in node["sources"][0]["excerpt"]
    link = next(link for link in result["links"] if {link["source"], link["target"]} == {"耕地", "监测"})
    assert link["similarity"] == 1 and link["shared_chunks"] == 2
    assert result["document_count"] == 1
    chunks.clear()
    assert keyword_graph.build_keyword_graph()["nodes"] == []


def test_keyword_graph_limits_nodes_and_deduplicates_links(monkeypatch):
    monkeypatch.setattr(keyword_graph.db, "list_documents", lambda: [{"id": "one", "name": "演示"}])
    monkeypatch.setattr(keyword_graph.db, "get_chunks", lambda: [{"doc_id": "one", "idx": 0, "text": "正文"}])
    monkeypatch.setattr(keyword_graph, "_chunk_terms", lambda text: tuple(f"词条{i}" for i in range(510)))
    result = keyword_graph.build_keyword_graph(limit=600)
    assert len(result["nodes"]) == 500 and result["limit"] == 500
    assert len(keyword_graph.build_keyword_graph(limit=20)["nodes"]) == 20
    assert len(result["links"]) == len({(link["source"], link["target"]) for link in result["links"]})
    assert all(0 < link["similarity"] <= 1 for link in result["links"])


def test_keyword_graph_scope_excludes_unrelated_documents(monkeypatch):
    monkeypatch.setattr(keyword_graph.db, "list_documents", lambda: [{"id": "a", "name": "甲"}, {"id": "b", "name": "乙"}])
    monkeypatch.setattr(keyword_graph.db, "get_chunks", lambda: [{"doc_id": "a", "idx": 0, "text": "甲文"}, {"doc_id": "b", "idx": 0, "text": "乙文"}])
    monkeypatch.setattr(keyword_graph, "_chunk_terms", lambda text: (text,))
    assert [node["name"] for node in keyword_graph.build_keyword_graph(doc_ids={"a"})["nodes"]] == ["甲文"]
    assert keyword_graph.build_keyword_graph(doc_ids=set())["nodes"] == []
