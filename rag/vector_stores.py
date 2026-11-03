from __future__ import annotations

import hashlib
import logging
from typing import Any

import numpy as np

from . import config, db

log = logging.getLogger("rag.vector_stores")


def _vector_literal(vector: np.ndarray) -> str:
    return "[" + ",".join(f"{float(value):.8g}" for value in vector) + "]"


def _namespace(model_name: str) -> str:
    return f"{config.EMBED_MODEL}|{model_name}|{config.PGVECTOR_DIM}"


class NumpyVectorStore:
    kind = "numpy"

    def __init__(self) -> None:
        self.matrix: np.ndarray | None = None
        self.model = ""
        self.chunks: list[dict[str, Any]] = []

    @property
    def ready(self) -> bool:
        return self.matrix is not None and self.matrix.ndim == 2

    def index(
        self,
        chunks: list[dict[str, Any]],
        vectors: np.ndarray,
        model: str,
    ) -> None:
        self.matrix = np.asarray(vectors, dtype=np.float32)
        self.model = model
        self.chunks = chunks

    def score(
        self,
        query: np.ndarray,
        chunks: list[dict[str, Any]],
        scope: set[str] | None = None,
        candidate_k: int | None = None,
    ) -> np.ndarray:
        del chunks, candidate_k
        if self.matrix is None:
            raise RuntimeError("NumPy 向量索引尚未建立")
        scores = self.matrix @ query
        if scope is not None:
            mask = np.array([item["doc_id"] in scope for item in self.chunks])
            scores = np.where(mask, scores, -1.0)
        return scores

    def clear(self) -> None:
        self.matrix = None
        self.model = ""
        self.chunks = []

    def status(self) -> dict[str, Any]:
        return {
            "backend": self.kind,
            "ready": self.ready,
            "count": int(self.matrix.shape[0]) if self.matrix is not None else 0,
            "model": self.model,
        }


class PgVectorStore:
    kind = "pgvector"

    def __init__(self) -> None:
        self.model = ""
        self.namespace = ""
        self.dimension = config.PGVECTOR_DIM
        self.table = config.PGVECTOR_TABLE

    @property
    def ready(self) -> bool:
        return bool(self.namespace and self.model)

    def index(
        self,
        chunks: list[dict[str, Any]],
        vectors: np.ndarray,
        model: str,
    ) -> None:
        matrix = np.asarray(vectors, dtype=np.float32)
        if matrix.ndim != 2 or matrix.shape[1] != self.dimension:
            raise ValueError(
                f"pgvector 需要 {self.dimension} 维向量，实际为 {getattr(matrix, 'shape', None)}"
            )
        self.model = model
        self.namespace = _namespace(model)
        rows = [
            (
                self.namespace,
                str(chunk["id"]),
                str(chunk["doc_id"]),
                int(chunk.get("idx") or 0),
                str(chunk.get("section") or ""),
                model,
                _vector_literal(vector),
                db.now(),
            )
            for chunk, vector in zip(chunks, matrix, strict=True)
        ]
        with db.connect() as conn:
            conn.execute(
                f"DELETE FROM {self.table} WHERE namespace = ?",
                (self.namespace,),
            )
            conn.executemany(
                f"""
                INSERT INTO {self.table}
                (namespace, chunk_id, doc_id, idx, section, model, embedding, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?::vector, ?)
                """,
                rows,
            )

    def score(
        self,
        query: np.ndarray,
        chunks: list[dict[str, Any]],
        scope: set[str] | None = None,
        candidate_k: int | None = None,
    ) -> np.ndarray:
        if not self.ready:
            raise RuntimeError("pgvector 索引尚未建立")
        if scope is not None and not scope:
            return np.full(len(chunks), -1.0, dtype=np.float32)
        query_text = _vector_literal(np.asarray(query, dtype=np.float32))
        limit = max(1, int(candidate_k or config.VECTOR_CANDIDATE_K))
        filters = ["namespace = ?"]
        params: list[Any] = [self.namespace]
        if scope is not None:
            ids = sorted(scope)
            filters.append(f"doc_id IN ({','.join('?' for _ in ids)})")
            params.extend(ids)
        where = " AND ".join(filters)
        sql = f"""
            SELECT chunk_id, 1 - (embedding <=> ?::vector) AS score
            FROM {self.table}
            WHERE {where}
            ORDER BY embedding <=> ?::vector
            LIMIT ?
        """
        scores = np.full(len(chunks), -1.0, dtype=np.float32)
        positions = {str(chunk["id"]): index for index, chunk in enumerate(chunks)}
        with db.connect() as conn:
            rows = conn.execute(
                sql,
                (query_text, *params, query_text, limit),
            ).fetchall()
        for row in rows:
            position = positions.get(str(row["chunk_id"]))
            if position is not None:
                scores[position] = float(row["score"])
        return scores

    def clear(self) -> None:
        if not self.namespace:
            return
        with db.connect() as conn:
            conn.execute(
                f"DELETE FROM {self.table} WHERE namespace = ?",
                (self.namespace,),
            )
        self.model = ""
        self.namespace = ""

    def status(self) -> dict[str, Any]:
        count = 0
        if self.namespace:
            with db.connect() as conn:
                count = int(
                    conn.execute(
                        f"SELECT COUNT(*) AS count FROM {self.table} WHERE namespace = ?",
                        (self.namespace,),
                    ).fetchone()["count"]
                )
        return {
            "backend": self.kind,
            "ready": self.ready,
            "count": count,
            "model": self.model,
            "dimension": self.dimension,
        }


class MilvusVectorStore:
    kind = "milvus"

    def __init__(self) -> None:
        self.model = ""
        self.dimension = 0
        self.collection = ""
        self._client = None

    @property
    def ready(self) -> bool:
        return bool(self.model and self.dimension and self.collection)

    def _get_client(self):
        if self._client is not None:
            return self._client
        try:
            from pymilvus import MilvusClient
        except ImportError as exc:
            raise RuntimeError(
                "Milvus 后端需要安装 pymilvus：python3 -m pip install 'pymilvus>=2.4,<3'"
            ) from exc
        kwargs: dict[str, Any] = {"uri": config.MILVUS_URI}
        if config.MILVUS_TOKEN:
            kwargs["token"] = config.MILVUS_TOKEN
        self._client = MilvusClient(**kwargs)
        return self._client

    def _collection_name(self, model: str) -> str:
        digest = hashlib.sha1(
            f"{config.MILVUS_COLLECTION}|{config.EMBED_MODEL}|{model}".encode("utf-8")
        ).hexdigest()[:10]
        prefix = "".join(
            char if char.isalnum() or char == "_" else "_"
            for char in config.MILVUS_COLLECTION
        ).strip("_") or "yanxin_chunks"
        return f"{prefix}_{digest}"

    def index(
        self,
        chunks: list[dict[str, Any]],
        vectors: np.ndarray,
        model: str,
    ) -> None:
        matrix = np.asarray(vectors, dtype=np.float32)
        if matrix.ndim != 2:
            raise ValueError(f"Milvus 向量形状异常：{matrix.shape}")
        client = self._get_client()
        self.model = model
        self.dimension = int(matrix.shape[1])
        self.collection = self._collection_name(model)
        if client.has_collection(self.collection):
            client.drop_collection(self.collection)
        client.create_collection(
            collection_name=self.collection,
            dimension=self.dimension,
            primary_field_name="chunk_id",
            id_type="str",
            max_length=128,
            vector_field_name="vector",
            metric_type="COSINE",
            auto_id=False,
            enable_dynamic_field=True,
        )
        entities = [
            {
                "chunk_id": str(chunk["id"]),
                "doc_id": str(chunk["doc_id"]),
                "idx": int(chunk.get("idx") or 0),
                "section": str(chunk.get("section") or ""),
                "vector": vector.tolist(),
            }
            for chunk, vector in zip(chunks, matrix, strict=True)
        ]
        if entities:
            client.insert(collection_name=self.collection, data=entities)
            client.flush(collection_name=self.collection)

    @staticmethod
    def _filter(scope: set[str] | None) -> str:
        if scope is None:
            return ""
        escaped = [
            '"' + doc_id.replace("\\", "\\\\").replace('"', '\\"') + '"'
            for doc_id in sorted(scope)
        ]
        return f"doc_id in [{','.join(escaped)}]"

    def score(
        self,
        query: np.ndarray,
        chunks: list[dict[str, Any]],
        scope: set[str] | None = None,
        candidate_k: int | None = None,
    ) -> np.ndarray:
        if not self.ready:
            raise RuntimeError("Milvus 索引尚未建立")
        if scope is not None and not scope:
            return np.full(len(chunks), -1.0, dtype=np.float32)
        client = self._get_client()
        limit = max(1, int(candidate_k or config.VECTOR_CANDIDATE_K))
        result = client.search(
            collection_name=self.collection,
            data=[np.asarray(query, dtype=np.float32).tolist()],
            anns_field="vector",
            search_params={"metric_type": "COSINE", "params": {}},
            limit=limit,
            filter=self._filter(scope),
            output_fields=["doc_id"],
        )
        scores = np.full(len(chunks), -1.0, dtype=np.float32)
        positions = {str(chunk["id"]): index for index, chunk in enumerate(chunks)}
        hits = result[0] if result else []
        for hit in hits:
            chunk_id = str(hit.get("id") or hit.get("chunk_id") or "")
            position = positions.get(chunk_id)
            if position is not None:
                scores[position] = float(hit.get("distance") or 0.0)
        return scores

    def clear(self) -> None:
        if self.collection:
            client = self._get_client()
            if client.has_collection(self.collection):
                client.drop_collection(self.collection)
        self.model = ""
        self.dimension = 0
        self.collection = ""

    def status(self) -> dict[str, Any]:
        return {
            "backend": self.kind,
            "ready": self.ready,
            "model": self.model,
            "dimension": self.dimension,
            "collection": self.collection,
        }


def create_vector_store() -> NumpyVectorStore | PgVectorStore | MilvusVectorStore:
    backend = config.VECTOR_STORE_BACKEND
    if backend == "pgvector":
        return PgVectorStore()
    if backend == "milvus":
        return MilvusVectorStore()
    return NumpyVectorStore()
