'use strict';

// 端到端验证：启动 server，调用 /api/scan 验证完整链路
const server = require('./server/index.js');

server.start();

setTimeout(async () => {
  try {
    for (const input of ['13800138000', '50010319900307657X', '11010519491231002X']) {
      const res = await fetch('http://localhost:' + (server.getPort? server.getPort() : 3999) + '/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      const j = await res.json();
      console.log('### input:', input);
      console.log(JSON.stringify(j, null, 2));
    }
  } catch (e) {
    console.error('API test failed:', e.message);
  } finally {
    server.stop();
    process.exit(0);
  }
}, 600);
