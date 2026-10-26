"""调用火山引擎 Viking 知识库，返回检索到的文本切片。"""

import httpx

from config import settings


class KnowledgeBaseError(RuntimeError):
    pass


class RagService:
    ENDPOINT = (
        "https://api-knowledgebase.mlp.cn-beijing.volces.com"
        "/api/knowledge/collection/search_knowledge"
    )

    async def search(self, query: str, limit: int = 3) -> list[dict]:
        query = query.strip()
        if not query:
            raise ValueError("检索问题不能为空")
        if not settings.VIKING_API_KEY:
            raise KnowledgeBaseError("缺少 VIKING_API_KEY，请填写 rag_llm_server/.env")

        body = {
            "project": settings.KB_PROJECT_NAME,
            "query": query,
            "limit": limit,
        }
        if settings.KB_RESOURCE_ID:
            body["resource_id"] = settings.KB_RESOURCE_ID
        else:
            body["name"] = settings.KB_COLLECTION_NAME

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.VIKING_API_KEY}",
        }
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(self.ENDPOINT, headers=headers, json=body)
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPStatusError as exc:
            raise KnowledgeBaseError(
                f"知识库请求返回 HTTP {exc.response.status_code}"
            ) from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise KnowledgeBaseError(f"知识库请求失败：{exc}") from exc

        if payload.get("code") not in (0, None):
            raise KnowledgeBaseError(
                f"知识库返回错误：{payload.get('code')} {payload.get('message', '')}"
            )

        rows = payload.get("data", {}).get("result_list", [])
        chunks = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            content = row.get("content")
            if not isinstance(content, str) or not content.strip():
                continue
            doc_info = row.get("doc_info") or {}
            chunks.append(
                {
                    "title": row.get("chunk_title") or "",
                    "content": content.strip(),
                    "score": row.get("score"),
                    "doc_name": doc_info.get("doc_name") if isinstance(doc_info, dict) else "",
                }
            )
        return chunks

    async def retrieve(self, query: str, limit: int = 3) -> str:
        chunks = await self.search(query, limit)
        return "\n\n".join(
            f"[资料{i}] {chunk['title']}\n{chunk['content']}"
            for i, chunk in enumerate(chunks, 1)
        )


rag_service = RagService()
