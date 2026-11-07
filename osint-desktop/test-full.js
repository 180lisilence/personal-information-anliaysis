'use strict';

// 多类型输入端到端验证
const server = require('./server/index.js');

server.start();

setTimeout(async () => {
  try {
    const inputs = ['13800138000', '50010319900307657X', 'testuser123', 'someone@example.com'];
    for (const input of inputs) {
      const res = await fetch('http://localhost:' + (server.getPort? server.getPort() : 3999) + '/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      const j = await res.json();
      console.log('### input:', input, '| count =', j.count);
      j.results.forEach((r) => {
        if (r.source.startsWith('online-')) {
          const er = (r.data && r.data.engineResults) || {};
          const cnt = Object.values(er).reduce((a, b) => a + ((b && b.count) || 0), 0);
          console.log('   ', r.source, 'hits =', cnt, r.error ? 'err=' + r.error : '');
        } else {
          console.log('   ', r.source, '=>', JSON.stringify(r.data));
        }
      });
    }
  } catch (e) {
    console.error('test failed:', e.message);
  } finally {
    server.stop();
    process.exit(0);
  }
}, 600);
