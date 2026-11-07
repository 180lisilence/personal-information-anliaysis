'use strict';

// M4: 用户名跨站搜索 —— 封装开源 Maigret（3000+ 站点）
// 运行时依赖: Python + Maigret 依赖（pip install -r requirements.txt）
// 若环境缺失则优雅降级，不影响其他数据源。

const Scanner = require('./base');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MAIGRET = path.join(__dirname, '..', '..', 'third_party', 'maigret', 'maigret', 'maigret.py');
const PYTHON = process.env.PYTHON || 'python';

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let p;
    try {
      p = spawn(cmd, args, { windowsHide: true });
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

class MaigretScanner extends Scanner {
  constructor() {
    super('maigret-social');
  }

  canHandle(input) {
    const v = (input || '').trim();
    return /^[a-zA-Z][a-zA-Z0-9._-]{1,39}$/.test(v);
  }

  async scan(input) {
    if (!fs.existsSync(MAIGRET)) {
      return { source: 'maigret-social', error: 'Maigret 未安装（缺少 third_party/maigret）' };
    }
    const username = input.trim();
    const outFile = path.join(os.tmpdir(), 'maigret_' + username.replace(/\W/g, '') + '_' + Date.now() + '.json');
    let res;
    try {
      res = await run(PYTHON, [MAIGRET, username, '--json', outFile, '--timeout', '10'], 120000);
    } catch (e) {
      return { source: 'maigret-social', error: '执行失败: ' + e.message };
    }

    let found = [];
    if (fs.existsSync(outFile)) {
      try {
        const j = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        const sitesObj = (j && j.sites_accuracy) || j || {};
        found = Object.keys(sitesObj).map((k) => ({ site: k }));
      } catch (e) {
        // 解析失败返回空
      }
      try { fs.unlinkSync(outFile); } catch (e) {}
    }

    return {
      source: 'maigret-social',
      data: { username, found: found.length, sites: found.slice(0, 200) },
      error: res && res.code !== 0 ? 'Maigret 退出码 ' + res.code + '（需要 Python 依赖）' : null,
    };
  }
}

module.exports = MaigretScanner;
