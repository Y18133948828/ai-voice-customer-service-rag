"""先验证知识库检索，再验证 RAG + 方舟的文字回答。

用法：
  python text_test.py rag "进阶实验每周几直播？"
  python text_test.py chat "进阶实验每周几直播？"
"""

import asyncio
import sys
import time

from services.llm_service import llm_service
from services.rag_service import rag_service


async def main() -> int:
    if len(sys.argv) < 3 or sys.argv[1] not in {"rag", "chat"}:
        print('用法：python text_test.py rag|chat "你的问题"')
        return 2

    mode = sys.argv[1]
    question = " ".join(sys.argv[2:]).strip()
    if not question:
        print("问题不能为空")
        return 2

    try:
        started = time.perf_counter()
        chunks = await rag_service.search(question, limit=3)
        retrieved_at = time.perf_counter()
        print(f"知识库返回 {len(chunks)} 个切片")
        for i, chunk in enumerate(chunks, 1):
            print(f"\n[资料{i}] {chunk['title']}")
            print(chunk["content"])
        if mode == "chat":
            print("\n模型回答：")
            print(await llm_service.answer(question, chunks))
            print(f"方舟耗时：{time.perf_counter() - retrieved_at:.2f} 秒")
        print(f"知识库耗时：{retrieved_at - started:.2f} 秒")
        return 0
    except Exception as exc:
        print(f"测试失败：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
