# Python RAG 服务

完整安装、密钥配置和四终端启动步骤见项目根目录的 [运行指南](../运行指南.md)。

本服务使用已激活的 Conda `ai_agent` 环境，当前验收环境是 Python 3.13.16。`requirements.txt` 与 `pyproject.toml` 声明主要依赖，`uv.lock` 和导出的 `requirements.lock.txt` 保存完整解析版本；新电脑按运行指南安装后者。方舟 SDK 固定为实际验证过的 `volcengine-python-sdk==5.0.54`，不使用不存在的 `[ark]` extra。

在本目录执行 `python main.py`，服务监听 `127.0.0.1:3003`。密钥从同目录 `.env` 读取，模板为 `.env.example`。修改 `.env` 或 Python 源码后重新启动进程。

| 接口 | 用途 |
| --- | --- |
| `GET /health` | 检查配置是否存在；不验证外部账号权限 |
| `POST /api/chat_callback` | RTC CustomLLM 请求入口，使用 Bearer 鉴权并返回 SSE |
| `GET /api/rtc_event` | 检查任务事件接收接口是否已加载 |
| `POST /api/rtc_event` | 验证 RTC 事件签名并记录任务阶段、错误码和原因 |

`services/rag_service.py` 调用云端知识库检索，`services/llm_service.py` 将检索片段与对话发送给方舟。知识文档的切片在云端知识库控制台完成，当前服务负责检索已有切片。
