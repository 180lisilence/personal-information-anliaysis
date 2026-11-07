'use strict';

// 首次登录 Telegram 账号，生成 sessionString（填进 config.json 的 telegram.sessionString）。
// 用法：先在 config.json 填好 apiId / apiHash（从 https://my.telegram.org 获取），然后：
//   node scripts/tg-login.js

const readline = require('readline');
const config = require('../src/core/config');

let getGramJS;
try {
  getGramJS = require('../src/core/telegram').getGramJS;
} catch (e) {
  console.error('加载 telegram 模块失败:', e.message);
  process.exit(1);
}

(async () => {
  const tg = config.telegram || {};
  if (!tg.apiId || !tg.apiHash) {
    console.error('请先在 config.json 的 telegram 段填写 apiId 与 apiHash（从 https://my.telegram.org 获取）');
    process.exit(1);
  }

  const { TelegramClient } = getGramJS();
  const { StringSession } = require('telegram/sessions');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));

  const client = new TelegramClient(
    new StringSession(''),
    parseInt(tg.apiId, 10),
    String(tg.apiHash),
    { connectionRetries: 5 }
  );

  console.log('开始登录 Telegram 账号…');
  await client.start({
    phoneNumber: async () => ask('手机号（含国家码，如 +8613800138000）: '),
    password: async () => ask('两步验证密码（没有就直接回车）: '),
    phoneCode: async () => ask('Telegram 发来的验证码: '),
    onError: (e) => console.error('错误:', e.message),
  });

  const session = client.session.save();
  config.__update({ telegram: { enabled: true, apiId: String(tg.apiId), apiHash: String(tg.apiHash), sessionString: String(session) } });
  console.log('\n====== 登录成功 ======');
  console.log('sessionString 已自动写入: ' + config.__userFile);
  console.log('\n如需手动填写，内容如下：\n');
  console.log(session);
  console.log('\n（同时把 telegram.enabled 设为 true，并配置 bots）');

  rl.close();
  await client.disconnect();
  process.exit(0);
})();
