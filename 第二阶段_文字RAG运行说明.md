# 第二阶段：文字知识库语音客服已跑通

本目录是“新版适配”副本。原版 `rtc_basic` 不需要修改。第一阶段的 React 网页和 Node 后端仍分别使用 3002、3001 端口；本阶段 Python Agent 回调服务使用 3003 端口。

## 目前做到哪里

- 2026-10-27 用户最终实测确认：普通“新版语音客服助手”和“知识库客服（RAG）”均能正常运行。基础语音交互、文字知识库检索与语音回答的功能验收通过。此结论针对当前模拟知识库及本地开发运行方式。
- 火山知识库 `AI_kefu` 已建立，测试文档目前有 6 个切片。
- `rag_llm_server` 已准备知识库检索、方舟文字回答、RTC CustomLLM 回调的代码。
- 知识库 Key、方舟 Key 已写入 `rag_llm_server/.env`，并已真实调用成功；本地生成的 Agent 回调 Key 也已写入该文件。
- 文字问题“进阶实验每周几直播？”已通过知识库检索和方舟回答测试；本地 RTC SSE 回调也返回了回答及 `data: [DONE]`。
- ngrok 的公网 HTTPS 地址已经接入 Node 的 RAG 场景；公网鉴权请求已能返回完整的 SSE 和 `[DONE]`。
- 真人语音 RAG 已验证：网页识别“每周几直播？”，Python 检索知识库并调用方舟，RTC 播放了每周三 20:00 的回答；任务事件中识别、模型输出、回答结束等阶段的错误码为 0。
- 已修复挂断后切换客服时沿用旧房间的前端问题：每次点击“通话”都会读取当前场景的 AppId、RoomId、UserId 和 Token。模拟连续切换 RAG → 普通客服 → RAG → 普通客服以及 TypeScript 检查已通过；用户最终复测两个场景均正常。此前间歇性公网 EOF 的诊断和恢复步骤保留在下文，供再次出现时排查；尚未进行长期稳定性或并发测试。
- RTC `StartVoiceChat` 返回 HTTP 200 只证明启动请求被接收。VoiceChat 任务事件回调用于查看后续状态和错误，不是启用 RAG 对话的前提。

## 两个客服如何切换

前端更新编译完成后，先挂断旧通话，再用 Ctrl+F5 刷新网页一次。选择“新版语音客服助手”后点击“通话”，它直接使用 RTC 内置模型；选择“知识库客服（RAG）”则通过 Python 查询知识库、调用方舟模型。挂断后可以直接切换另一个客服再通话，每次切换无需刷新。

RAG 的数据流程是：你说话 → RTC 语音识别成文字 → Python 检索最多 3 个知识库片段 → 方舟根据片段生成回答 → Python 流式返回文字 → RTC 合成语音并由网页播放。

Python 终端中的 `POST /api/chat_callback ... 200 OK` 表示 RAG 请求已被服务接收；`asrFinish` 是语音识别完成，`llmOutput` 是模型输出，`answerStart` 和 `answerFinish` 是开始、结束播报。`ErrorCode=0` 表示对应事件没有报告错误。网页上的“AI 准备中”仅表示还没有收到第一条字幕，不能单独用来判断云端任务是否启动。

## 公网请求偶发 EOF 时

2026-10-27 排查记录：同一个 RAG 任务有成功的模型输出，也有 `1004002 / Post ... /api/chat_callback: EOF`。EOF 对应时刻在本地 ngrok 请求检查器中未找到模型请求。对照测试中，本机 `127.0.0.1:3003` 的 RAG 请求完整返回 `200` 和 `[DONE]`；公网地址一次连接断开，随后一次完整返回。用户确认正在使用 VPN/代理。目前证据指向公网连接间歇性中断，尚不能确定具体是哪一个网络节点造成。

先挂断网页通话，在 ngrok 终端按 Ctrl+C，然后重新建立隧道并写入日志。下面第一条命令切换到新版副本根目录；第二条启动 ngrok，明确转发到 Python 监听的 IPv4 地址，保留当前公网域名，并将日志保存到 `rag_llm_server/ngrok.log`。

```powershell
cd "E:\AI\AI Agent\懂王AI项目\AI实时语音对话-智能客服\rtc_basic_新版适配"
& "E:\AI\ngrok.exe" http http://127.0.0.1:3003 --url "https://avid-unclaimed-around.ngrok-free.dev" --log ".\rag_llm_server\ngrok.log" --log-format json
```

等 ngrok 显示 online 后，再开始一轮 RAG 通话。如果代理设置了自动切换节点，测试期间先固定节点。重建隧道是恢复连接并收集日志的排查步骤，不能保证它会永久消除 EOF；若仍出现，需要结合该日志定位公网或代理连接。

## 密钥放哪里

密钥分别保存在 `rag_llm_server/.env` 和 `Server/local.config.json`，这两个文件均在新副本内且被 `.gitignore` 排除。不要把密钥写进 `*.py` 或 `*.js` 源文件。

- `VIKING_API_KEY`：在**知识库控制台**创建、允许访问 `AI_kefu` 的 API Key。
- `ARK_API_KEY`：在**火山方舟**创建、允许调用当前豆包模型的 API Key。
- `KB_RESOURCE_ID`、`KB_COLLECTION_NAME`、`KB_PROJECT_NAME`、`ARK_MODEL` 已按当前测试资源填写，测试时先不用改。
- `AGENT_API_KEY`：由本地生成，用于 RTC 调用 Python 回调；同一值已同步到 `Server/local.config.json` 的 `AgentApiKey`。它不是 RTC AppKey、RTC Token、知识库 Key 或方舟 Key。
- `RTC_EVENT_SECRET`：由本地生成，仅用于火山 RTC 的 VoiceChat 任务事件回调验签。控制台要求回调密钥只含大小写英文字母与数字，且最长 32 位；本副本 `.env` 中已使用符合要求的 32 位新值。旧截图中超过 32 位的值已作废。在控制台“回调密钥”中填写这一行等号右边的值，不要填写到 `AGENT_API_KEY`。修改 `.env` 后须重启 Python 服务。

知识库 Key 如果创建后没有保存明文，重新创建一条即可。

## 在 Cursor 终端先测文字

```powershell
conda activate ai_agent
cd "E:\AI\AI Agent\懂王AI项目\AI实时语音对话-智能客服\rtc_basic_新版适配\rag_llm_server"
$env:PYTHONIOENCODING = "utf-8"
python text_test.py rag "进阶实验每周几直播？"
python text_test.py chat "进阶实验每周几直播？"
```

第一条只测知识库检索，应返回“上课时间与有效期”等切片；第二条再调用方舟豆包，输出文字回答。这里不需要运行 `uv init`、`uv sync`、ngrok、Node 服务或前端网页。

## 下一步：公网回调

1. 在第一个 Cursor 终端激活 `ai_agent`，切换到 `rag_llm_server`，运行 `python main.py`，保持终端打开。服务监听 `127.0.0.1:3003`。
2. 安装并登录 ngrok。在另一个终端首次运行 `ngrok config add-authtoken "<你的 ngrok Authtoken>"`，之后运行 `ngrok http 3003`，保持终端打开。
3. ngrok 会显示一个 `https://...` 的公网地址。只将这个 **HTTPS 地址本身**写入 `Server/local.config.json` 的 `AgentUrl`（末尾不加 `/api/chat_callback`），重新启动 Node 后端。
4. 网页会多出“知识库客服（RAG）”场景。选中它再开始通话；原“新版语音客服助手”场景仍使用内置模型。

Python Agent 回调要求 Bearer 鉴权，Node 服务会把本地 `AgentApiKey` 作为 RTC `CustomLLM.APIKey` 下发给云端；浏览器拿不到这个 Key。

## 任务状态排障：接收 VoiceChat 事件

1. 在运行 `python main.py` 的终端按 `Ctrl+C`，然后仍在 `rag_llm_server` 目录、`(ai_agent)` 环境下重新运行 `python main.py`。Python 服务不会自动重载新代码。
2. 浏览器访问 `http://127.0.0.1:3003/api/rtc_event`，显示 `{"status":"ready"}` 才说明新的事件接收接口已加载。ngrok 终端继续保持在线，并确认当前的 Forwarding 地址。
3. 打开火山引擎 **AI 音视频互动方案**控制台，在当前 RTC 应用的**功能配置 → 回调设置 → 添加配置**中，选择事件 `VoiceChat`。必须选择与本副本 `Server/local.config.json` 中 `AppId` 完全一致的应用（目前是 `6adaf83c2657760167aaa078`）。如果下拉框只有 `01` 和另一个 AppId 不同的 `AI智能客服`，先不要保存，检查控制台顶部项目及应用列表。
4. 回调 URL 填当前 ngrok 的 `https://...` Forwarding 地址加 `/api/rtc_event`；“回调密钥”填 `rag_llm_server/.env` 中 `RTC_EVENT_SECRET=` 后面的值。业务标识留空。保存后不要发送或截图密钥。
5. 在网页退出旧通话，选择“知识库客服（RAG）”并重新进入，说一句测试问题。Python 终端将打印 `[RTC VoiceChat]`、`TaskId`、`RunStage`，若任务异常还会打印 `ErrorCode`、`Reason`。根据错误阶段再改对应配置。

这里的 VoiceChat **任务事件回调**是 RTC 控制台级配置，用于排障；它与 `AgentConfig.EnableConversationStateCallback`（客户端智能体状态）和 `CustomLLM` 的 `/api/chat_callback` 是三个不同的入口。
