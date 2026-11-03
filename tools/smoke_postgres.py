"""在隔离的 PostgreSQL 测试库中执行一轮写入、评审状态机与清理。"""
from __future__ import annotations

import argparse
import os
import uuid


def main() -> int:
    parser = argparse.ArgumentParser(description="PostgreSQL 后端写链路冒烟")
    parser.add_argument(
        "--database-url",
        default=os.getenv("DATABASE_URL", "postgresql:///yanxin_review_test"),
    )
    args = parser.parse_args()
    os.environ["DATABASE_BACKEND"] = "postgresql"
    os.environ["DATABASE_URL"] = args.database_url
    os.environ["VECTOR_STORE_BACKEND"] = "pgvector"
    os.environ["EMBED_BACKEND"] = "none"
    os.environ["SEED_DEMO_USERS"] = "0"
    os.environ["SEED_DEMO_PAPERS"] = "0"
    os.environ["SEED_DEMO_PROPOSALS"] = "0"

    from rag import auth, config, db, review_cases

    config.DATABASE_BACKEND = "postgresql"
    config.DATABASE_URL = args.database_url
    config.VECTOR_STORE_BACKEND = "pgvector"
    suffix = uuid.uuid4().hex[:10]
    doc_id = f"smoke-doc-{suffix}"
    case_id = ""
    try:
        db.init_db()
        assert auth.create_user(
            f"smoke-reviewer-{suffix}",
            "reviewer123",
            "reviewer",
            "冒烟专家",
        )
        db.insert_document(
            {
                "id": doc_id,
                "name": "PostgreSQL 冒烟申报书",
                "kind": "proposal",
                "year": 2026,
                "source": "smoke",
                "path": "/tmp/smoke.txt",
                "text_len": 8,
            },
            [{"idx": 0, "page": 1, "section": "研究内容", "text": "科研诚信冒烟测试"}],
        )
        dossier = db.insert_dossier(
            {"name": f"冒烟课题-{suffix}", "year": 2026}
        )
        db.attach_dossier_document(dossier["id"], doc_id, "proposal_text")
        expert_id = db.insert_expert(
            {
                "name": f"冒烟专家-{suffix}",
                "institution": "测试单位",
                "title": "研究员",
                "discipline": "自然资源",
                "research_areas": "遥感监测",
                "available": True,
                "source": "smoke",
            }
        )
        case = review_cases.create_case(
            title=f"冒烟案卷-{suffix}",
            doc_id=doc_id,
            dossier_id=dossier["id"],
            actor="smoke-manager",
        )
        case_id = case["id"]
        report = {
            "doc": {"name": "PostgreSQL 冒烟申报书", "char_count": 8, "chunk_count": 1},
            "overall": {
                "risk_level": "低",
                "checked_items": 1,
                "generated_at": db.now(),
                "summary": "冒烟预审",
            },
            "sections": [],
            "disclaimer": "仅供冒烟测试。",
        }
        tool_result = {
            "doc": {"name": "PostgreSQL 冒烟申报书"},
            "duplicate": {"summary": "无重复"},
            "match": {
                "summary": "一位候选",
                "candidates": [{"expert": {"id": expert_id, "name": f"冒烟专家-{suffix}"}}],
            },
            "disclaimer": "仅供冒烟测试。",
        }
        case = review_cases.save_pre_results(
            case_id,
            actor="smoke-manager",
            report=report,
            tool_result=tool_result,
        )
        case = review_cases.assign_tasks(
            case_id,
            [{"expert_id": expert_id, "username": f"smoke-reviewer-{suffix}"}],
            "smoke-manager",
        )
        task_id = case["tasks"][0]["id"]
        review_cases.submit_task(
            task_id,
            {"username": f"smoke-reviewer-{suffix}", "role": "reviewer"},
            recommendation="approve",
            opinion="冒烟测试意见完整，可以提交。",
            conflict_declared=False,
            conflict_reason="",
        )
        review_cases.advance_to_final(case_id, "smoke-manager")
        completed = review_cases.finalize_case(
            case_id,
            "smoke-manager",
            decision="approved",
            comment="冒烟终审意见完整，状态机通过。",
        )
        assert completed["stage"] == "completed"
        assert db.stats()["documents"] >= 1
        print("PostgreSQL 写链路冒烟通过")
    finally:
        try:
            with db.connect() as conn:
                if case_id:
                    conn.execute("DELETE FROM review_actions WHERE case_id = ?", (case_id,))
                    conn.execute("DELETE FROM review_artifacts WHERE case_id = ?", (case_id,))
                    conn.execute("DELETE FROM review_tasks WHERE case_id = ?", (case_id,))
                    conn.execute("DELETE FROM review_cases WHERE id = ?", (case_id,))
                conn.execute("DELETE FROM dossier_documents WHERE doc_id = ?", (doc_id,))
                conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
                conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
                conn.execute("DELETE FROM dossiers WHERE name = ?", (f"冒烟课题-{suffix}",))
                conn.execute("DELETE FROM experts WHERE name = ?", (f"冒烟专家-{suffix}",))
                conn.execute("DELETE FROM users WHERE username = ?", (f"smoke-reviewer-{suffix}",))
        except Exception:
            pass
        db.close_db()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
