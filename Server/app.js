/**
 * Copyright 2025 Beijing Volcano Engine Technology Co., Ltd. All Rights Reserved.
 * SPDX-license-identifier: BSD-3-Clause
 */

const Koa = require('koa');
const uuid = require('uuid');
const bodyParser = require('koa-bodyparser');
const cors = require('koa2-cors');
const { Signer } = require('@volcengine/openapi');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { wrapper, assert, readFiles } = require('./util');
const TokenManager = require('./token');
const Privileges = require('./token').privileges;

const Scenes = readFiles('./scenes', '.json');
const API_VERSION = '2025-06-01';
const localConfigPath = path.join(__dirname, 'local.config.json');

// 密钥只从服务端本地文件读取，不返回给浏览器。
if (fs.existsSync(localConfigPath)) {
  let localConfig;
  try {
    localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf8').replace(/^\uFEFF/, ''));
    if (!localConfig || typeof localConfig !== 'object' || Array.isArray(localConfig)) {
      throw new Error('Invalid configuration');
    }
  } catch {
    throw new Error('Server/local.config.json 格式错误，请参照 local.config.example.json 填写。');
  }
  Scenes.Custom.AccountConfig.accessKeyId = localConfig.accessKeyId || '';
  Scenes.Custom.AccountConfig.secretKey = localConfig.secretKey || '';
  Scenes.Custom.RTCConfig.AppId = localConfig.AppId || '';
  Scenes.Custom.RTCConfig.AppKey = localConfig.AppKey || '';

  // 只有配置公网 HTTPS 回调地址后才展示第二阶段 RAG 场景。
  // 基础场景继续使用内置 ArkV3，不受 Agent 服务影响。
  const agentUrl = String(localConfig.AgentUrl || '').replace(/\/+$/, '');
  const agentApiKey = String(localConfig.AgentApiKey || '');
  if (agentUrl && agentApiKey) {
    if (!agentUrl.startsWith('https://')) {
      console.warn('RAG 场景未启用：Server/local.config.json 的 AgentUrl 必须是 HTTPS 地址。');
    } else {
      const ragScene = JSON.parse(JSON.stringify(Scenes.Custom));
      ragScene.SceneConfig.name = '知识库客服（RAG）';
      ragScene.VoiceChat.Config.LLMConfig = {
        Mode: 'CustomLLM',
        Url: `${agentUrl}/api/chat_callback`,
        APIKey: agentApiKey,
        ModelName: 'doubao-seed-2-1-turbo-260628',
        HistoryLength: 10,
        MaxTokens: 256,
        Prefill: false,
      };
      // 在 RAG 场景接收 RTC 客户端任务状态，方便定位异步启动错误。
      ragScene.VoiceChat.AgentConfig.EnableConversationStateCallback = true;
      Scenes.RAG = ragScene;
    }
  }
}

function validateConfiguration(sceneId) {
  assert(Object.prototype.hasOwnProperty.call(Scenes, sceneId), '场景不存在，请使用 Custom 场景。');
  const scene = Scenes[sceneId];
  const fields = {
    accessKeyId: scene.AccountConfig?.accessKeyId,
    secretKey: scene.AccountConfig?.secretKey,
    AppId: scene.RTCConfig?.AppId,
    AppKey: scene.RTCConfig?.AppKey,
  };
  const missing = Object.keys(fields).filter(name => (
    typeof fields[name] !== 'string' || !fields[name].trim() || /\s/.test(fields[name])
  ));
  assert(missing.length === 0,
    `请先填写 Server/local.config.json 中的这些字段（不可留空或含空白）：${missing.join('、')}`);
  return scene;
}

function prepareScene(sceneId, generateToken = false) {
  const scene = validateConfiguration(sceneId);
  const { RTCConfig, VoiceChat } = scene;
  RTCConfig.RoomId = RTCConfig.RoomId || uuid.v4();
  RTCConfig.UserId = RTCConfig.UserId || uuid.v4();
  VoiceChat.AppId = RTCConfig.AppId;
  VoiceChat.RoomId = RTCConfig.RoomId;
  VoiceChat.TaskId = VoiceChat.TaskId || uuid.v4();
  VoiceChat.AgentConfig.TargetUserId = [RTCConfig.UserId];
  VoiceChat.AgentConfig.UserId = VoiceChat.AgentConfig.UserId || `bot_${uuid.v4()}`;

  if (generateToken || !RTCConfig.Token) {
    const token = new TokenManager.AccessToken(
      RTCConfig.AppId, RTCConfig.AppKey, RTCConfig.RoomId, RTCConfig.UserId
    );
    token.addPrivilege(Privileges.PrivSubscribeStream, 0);
    token.addPrivilege(Privileges.PrivPublishStream, 0);
    token.expireTime(Math.floor(Date.now() / 1000) + (24 * 3600));
    RTCConfig.Token = token.serialize();
  }
  return scene;
}

const app = new Koa();

app.use(cors({
  origin: '*'
}));

app.use(bodyParser());

app.use(async ctx => {
  /**
   * @brief 代理 AIGC 的 OpenAPI 请求
   */
  await wrapper({
    ctx,
    apiName: 'proxy',
    containResponseMetadata: false,
    logic: async () => {
      const { Action, Version = API_VERSION } = ctx.query || {};
      assert(Action, 'Action 不能为空');
      assert(['StartVoiceChat', 'StopVoiceChat'].includes(Action), '此基础版只支持开始和结束语音通话。');
      assert(Version === API_VERSION, `新版语音接口版本必须为 ${API_VERSION}`);

      const { SceneID } = ctx.request.body || {};

      assert(SceneID, 'SceneID 不能为空, SceneID 用于指定场景的 JSON');

      const { VoiceChat, AccountConfig } = prepareScene(SceneID);

      let body = {};
      switch(Action) {
        case 'StartVoiceChat':
          VoiceChat.TaskId = uuid.v4();
          body = VoiceChat;
          break;
        case 'StopVoiceChat':
          const { AppId, RoomId, TaskId } = VoiceChat;
          assert(AppId, 'VoiceChat.AppId 不能为空');
          assert(RoomId, 'VoiceChat.RoomId 不能为空');
          assert(TaskId, 'VoiceChat.TaskId 不能为空');
          body = {
            AppId, RoomId, TaskId
          };
          break;
        default:
          break;
      }

      /** 参考 https://github.com/volcengine/volc-sdk-nodejs 可获取更多 火山 TOP 网关 SDK 的使用方式 */
      const openApiRequestData = {
        region: 'cn-north-1',
        method: 'POST',
        params: {
          Action,
          Version,
        },
        headers: {
          Host: 'rtc.volcengineapi.com',
          'Content-type': 'application/json',
        },
        body,
      };
      const signer = new Signer(openApiRequestData, "rtc");
      signer.addAuthorization(AccountConfig);
      
      /** 参考 https://www.volcengine.com/docs/6348/69828 可获取更多 OpenAPI 的信息 */
      const result = await fetch(`https://rtc.volcengineapi.com?Action=${Action}&Version=${Version}`, {
        method: 'POST',
        headers: openApiRequestData.headers,
        body: JSON.stringify(body),
        timeout: 30000,
      });
      const response = await result.json();
      if (Action === 'StartVoiceChat') {
        const metadata = response?.ResponseMetadata || {};
        if (metadata.Error) {
          console.error(
            '[StartVoiceChat] 火山接口拒绝启动：',
            metadata.Error.Code,
            metadata.Error.Message,
            'Scene:', SceneID,
            'TaskId:', body.TaskId,
            'RequestId:', metadata.RequestId || '未返回'
          );
        } else {
          console.log(
            '[StartVoiceChat] 接口已返回，任务状态待确认，HTTP:', result.status,
            'Scene:', SceneID,
            'TaskId:', body.TaskId,
            'RequestId:', metadata.RequestId || '未返回'
          );
        }
      }
      return response;
    }
  });

  await wrapper({
    ctx,
    apiName: 'getScenes',
    logic: () => {
      const scenes = Object.keys(Scenes).map((scene) => {
        const { SceneConfig, RTCConfig, VoiceChat } = prepareScene(scene, true);
        const { AppId, RoomId, UserId, Token } = RTCConfig;
        SceneConfig.id = scene;
        SceneConfig.botName = VoiceChat?.AgentConfig?.UserId;
        SceneConfig.isInterruptMode = VoiceChat?.Config?.InterruptMode === 0;
        SceneConfig.isVision = VoiceChat?.Config?.LLMConfig?.VisionConfig?.Enable;
        SceneConfig.isScreenMode = VoiceChat?.Config?.LLMConfig?.VisionConfig?.SnapshotConfig?.StreamType === 1;
        SceneConfig.isAvatarScene = VoiceChat?.Config?.AvatarConfig?.Enabled;
        SceneConfig.avatarBgUrl = VoiceChat?.Config?.AvatarConfig?.BackgroundUrl;
        return {
          scene: SceneConfig || {},
          rtc: { AppId, RoomId, UserId, Token },
        };
      });
      return {
        scenes,
      };
    }
  });
});

if (require.main === module) {
  app.listen(3001, '127.0.0.1', () => {
    console.log(`新版语音客服后端：http://localhost:3001，接口版本：${API_VERSION}`);
  });
}

module.exports = { app, Scenes, API_VERSION, validateConfiguration };

