"""第二阶段 Python Agent 回调服务。RTC 代理仍由已跑通的 Node 服务承担。"""

import hmac
import hashlib
import json
import logging
import time
import uuid

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

from config import settings
from services.llm_service import llm_service
from services.rag_service import KnowledgeBaseError, rag_service


app = FastAPI(title="AI 语音客服 RAG Agent")
logger = logging.getLogger("uvicorn.error")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "kb_configured": bool(settings.VIKING_API_KEY),
        "ark_configured": bool(settings.ARK_API_KEY),
        "callback_configured": bool(settings.AGENT_API_KEY),
    }


def _text_chunk(text: str, chunk_id: str, finish_reason=None) -> str:
    payload = {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": settings.ARK_MODEL,
        "choices": [
            {
                "index": 0,
                "delta": {"role": "assistant", "content": text},
                "finish_reason": finish_reason,
            }
        ],
        "stream_options": {"include_usage": True},
    }
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@app.get("/api/rtc_event")
async def rtc_event_ready():
    return {"status": "ready" if settings.RTC_EVENT_SECRET else "not_configured"}


@app.post("/api/rtc_event")
async def rtc_event(request: Request):
    """接收并验签 RTC 控制台的 VoiceChat 任务事件，用于定位异步错误。"""
    if not settings.RTC_EVENT_SECRET:
        raise HTTPException(status_code=503, detail="尚未配置 RTC_EVENT_SECRET")
    try:
        event = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="事件必须为 JSON") from exc
    if not isinstance(event, dict):
        raise HTTPException(status_code=400, detail="事件格式错误")

    fields = ("EventType", "EventData", "EventTime", "EventId", "AppId", "Version", "Nonce")
    if any(not isinstance(event.get(field), str) for field in fields):
        raise HTTPException(status_code=400, detail="事件缺少签名字段")
    provided = event.get("Signature")
    if not isinstance(provided, str):
        raise HTTPException(status_code=400, detail="事件缺少签名")
    values = [event[field] for field in fields] + [settings.RTC_EVENT_SECRET]
    expected = hashlib.sha256("".join(sorted(values)).encode("utf-8")).hexdigest()
    if not hmac.compare_digest(expected, provided.lower()):
        raise HTTPException(status_code=401, detail="事件签名无效")

    if event["EventType"] != "VoiceChat":
        return {"status": "ignored"}
    try:
        data = json.loads(event["EventData"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="VoiceChat EventData 不是 JSON") from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="VoiceChat EventData 格式错误")
    error = data.get("ErrorInfo") or {}
    if not isinstance(error, dict):
        error = {}
    logger.info(
        "[RTC VoiceChat] TaskId=%s EventType=%s RunStage=%s ErrorCode=%s Reason=%s",
        data.get("TaskId", ""),
        data.get("EventType", ""),
        data.get("RunStage", ""),
        error.get("ErrorCode", error.get("Errorcode", "")),
        error.get("Reason", ""),
    )
    return {"status": "ok"}


@app.post("/api/chat_callback")
async def chat_callback(request: Request):
    """供 RTC CustomLLM 调用；鉴权值由 StartVoiceChat.LLMConfig.APIKey 传入。"""
    if not settings.AGENT_API_KEY:
        raise HTTPException(status_code=503, detail="服务端尚未配置 AGENT_API_KEY")
    expected = f"Bearer {settings.AGENT_API_KEY}"
    provided = request.headers.get("Authorization", "")
    if not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Agent 鉴权失败")

    try:
        data = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="请求必须是 JSON") from exc
    messages = data.get("messages") if isinstance(data, dict) else None
    if not isinstance(messages, list) or not messages:
        raise HTTPException(status_code=400, detail="缺少 messages")
    last = messages[-1]
    if not isinstance(last, dict) or last.get("role") != "user":
        raise HTTPException(status_code=400, detail="最后一条消息必须来自 user")
    question = last.get("content")
    if not isinstance(question, str) or not question.strip():
        raise HTTPException(status_code=400, detail="当前仅支持文字 ASR 问题")
    if not settings.ARK_API_KEY or not settings.VIKING_API_KEY:
        raise HTTPException(status_code=503, detail="Agent 所需密钥尚未配置")

    try:
        chunks = await rag_service.search(question, limit=3)
    except KnowledgeBaseError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    async def generate_sse():
        if not chunks:
            chunk_id = f"chatcmpl-{uuid.uuid4().hex}"
            yield _text_chunk("知识库没有找到可用资料，请联系人工客服核实。", chunk_id)
            yield _text_chunk("", chunk_id, finish_reason="stop")
        else:
            async for chunk_json in llm_service.chat_stream(messages, chunks):
                yield f"data: {chunk_json}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate_sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=3003)
