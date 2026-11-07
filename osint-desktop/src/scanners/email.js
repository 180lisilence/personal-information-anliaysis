'use strict';

// M4: 邮箱注册检测 —— 封装开源 holehe（120+ 站点）
// 运行时依赖: Python + holehe（pip install holehe）
// 若环境缺失则优雅降级，不影响其他数据源。

const Scanner = require('./base');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const HOLEHE_DIR = path.join(__dirname, '..', '..', 'third_party', 'holehe');
const PYTHON = process.env.PYTHON || 'python';

function run(cmd, args, opts, timeoutMs) {
  return new Promise((resolve, reject) => {
    let p;
    try {
      p = spawn(cmd, args, opts);
    } catch (e) {
      return reject(e);
    }
    let out = '';
    let err = '';
    if (p.stdout) p.stdout.on('data', (d) => (out += d));
    if (p.stderr) p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
    p.on('error', (e) => reject(e));
    setTimeout(() => { try { p.kill(); } catch (e) {} }, timeoutMs);
  });
}

class HoleheScanner extends Scanner {
  constructor() {
    super('holehe-email');
  }

  canHandle(input) {
    const v = (input || '').trim();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
  }

  async scan(input) {
    if (!fs.existsSync(HOLEHE_DIR)) {
      return { source: 'holehe-email', error: 'holehe 未安装（缺少 third_party/holehe）' };
    }
    const email = input.trim();
    let res;
    try {
      res = await run(PYTHON, ['-m', 'holehe', email], { cwd: HOLEHE_DIR }, 120000);
    } catch (e) {
      return { source: 'holehe-email', error: '执行失败: ' + e.message };
    }

    // holehe 输出形如: [+] Twitter : email
    const hits = [];
    const lines = (res.out || '').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\[\+\]\s*(.+?)\s*:\s*(.+)$/);
      if (m) hits.push({ site: m[1].trim(), account: m[2].trim() });
    }

    return {
      source: 'holehe-email',
      data: { email, registered: hits.length, hits: hits.slice(0, 200) },
      error: res && res.code !== 0 ? 'holehe 退出码 ' + res.code + '（需 pip install holehe）' : null,
    };
  }
}

module.exports = HoleheScanner;
