const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

async function main() {
  const configPath = path.join(__dirname, 'local.config.json');
  const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''))
    : { accessKeyId: '', secretKey: '', AppId: '6adaf83c2657760167aaa078', AppKey: '' };
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('新版语音客服：填写本地密钥');
  console.log('只保存到本副本的 Server/local.config.json。按 Ctrl+C 可取消。');
  console.log(`AppId 已填好：${config.AppId}`);
  console.log('第 1、2 项来自：https://console.volcengine.com/iam/keymanage/');
  console.log('请取页面上半部分 Access Key 同一行的两项。');
  try {
    const fields = [
      ['accessKeyId', '1. Access Key ID'],
      ['secretKey', '2. Secret Access Key'],
      ['AppKey', '3. AI 应用 defaultAIAgentAppName 的 AppKey'],
    ];
    for (const [name, label] of fields) {
      if (name === 'AppKey') {
        console.log('第 3 项来自：AI 音视频互动方案 → 辅助开发 → 应用管理。');
        console.log('选择 defaultAIAgentAppName 那一行的 AppKey，不是临时 Token。');
      }
      while (true) {
        const suffix = config[name] ? '（已填过，直接回车保留）' : '';
        const value = (await input.question(`${label}${suffix}：`)).trim();
        if (process.stdout.isTTY) {
          process.stdout.moveCursor(0, -1);
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          console.log(`${label}：已接收输入`);
        }
        if ((!value && !config[name]) || /\s/.test(value)) {
          console.log('这一项不可为空，也不可含空白，请重新粘贴。');
          continue;
        }
        if (value) config[name] = value;
        break;
      }
    }
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    console.log('已保存三项密钥。关闭本窗口，接着双击 1_启动后端.cmd。');
    console.log('没有改动原始 rtc_basic 目录。');
  } finally {
    input.close();
  }
}

main().catch(error => {
  console.error(`未完成保存：${error.message}`);
  process.exitCode = 1;
});
