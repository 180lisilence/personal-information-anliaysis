'use strict';

// 验证批量接口：逐条补全资料 + 开户配置未启用时的降级返回
const server = require('./server/index.js');

server.start();

setTimeout(async () => {
  try {
    const res = await fetch('http://localhost:' + (server.getPort? server.getPort() : 3999) + '/api/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: ['13800138000', '50010319900307657X', '13600136000'], openAccount: false }),
    });
    const j = await res.json();
    console.log('批量解析与抓取 count =', j.count);
    j.results.forEach((r) => {
      console.log('  ', r.input, '=>', JSON.stringify(r.profile));
    });

    const { getCredential } = require('./src/core/session');
    const cred = await getCredential();
    console.log('自动登录（未启用配置，应为 null）:', JSON.stringify(cred));
  } catch (e) {
    console.error('batch test failed:', e.message);
  } finally {
    server.stop();
    process.exit(0);
  }
}, 600);
