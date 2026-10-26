const { Scenes, API_VERSION, validateConfiguration } = require('./app');

try {
  validateConfiguration('Custom');
  const { VoiceChat } = Scenes.Custom;
  console.log('本地配置字段检查通过。此检查不会调用云端，也不代表密钥权限已验证。');
  console.log(`OpenAPI 版本：${API_VERSION}`);
  console.log(`大模型：${VoiceChat.Config.LLMConfig.ModelName}`);
  console.log('语音识别：内置豆包流式识别；语音合成：内置豆包 2.0。');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
