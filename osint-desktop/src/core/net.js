'use strict';

// 全局网络出口：给 fetch 装上代理，同时保证本机/内网地址不走代理。
// Node 内置 fetch 不认 HTTP_PROXY / config.proxy，国内访问大多数境外源都会超时。
// 这里用 undici 的 ProxyAgent 接管全局 fetch（config.proxy 支持 http:// / https://）；
// localhost 与内网段始终直连，避免代理把本地后端请求也吞掉。

const config = require('./config');

let undici = null;
try {
  // eslint-disable-next-line global-require
  undici = require('undici');
} catch (e) {
  undici = null;
}

const nativeFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null;
let current = '';
let directDispatcher = null;

const DEFAULT_NO_PROXY = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];

function noProxyList() {
  const raw = (config && config.noProxy) ? String(config.noProxy) : '';
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).concat(DEFAULT_NO_PROXY);
}

function isLocal(input) {
  try {
    const u = typeof input === 'string' ? input : (input && input.url);
    if (!u) return false;
    const h = new URL(u).hostname.toLowerCase();
    if (noProxyList().includes(h)) return true;
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return true;
    return false;
  } catch (e) {
    return false;
  }
}

// 与 mytelegram 保持一致：没显式配置时，沿用环境变量里的代理
function currentProxy() {
  const p = (config && config.proxy) ? String(config.proxy).trim() : '';
  return p || (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '');
}

// 应用（或撤销）代理；配置变化后调用即可热生效
function applyProxy() {
  const proxy = currentProxy();
  if (!proxy) {
    if (current) {
      try { if (undici && undici.setGlobalDispatcher) undici.setGlobalDispatcher(new undici.Agent()); } catch (e) { /* ignore */ }
      if (nativeFetch) globalThis.fetch = nativeFetch;
      current = '';
    }
    return { proxy: '', applied: false };
  }
  if (!undici) {
    return { proxy, applied: false, error: '未安装 undici，代理不生效（在线源会直连）' };
  }
  try {
    directDispatcher = new undici.Agent();
    undici.setGlobalDispatcher(new undici.ProxyAgent(proxy));
    globalThis.fetch = function proxyAwareFetch(input, init) {
      if (isLocal(input)) {
        return undici.fetch(input, Object.assign({}, init || {}, { dispatcher: directDispatcher }));
      }
      return undici.fetch(input, init);
    };
    current = proxy;
    return { proxy, applied: true };
  } catch (e) {
    return { proxy, applied: false, error: e.message };
  }
}

// ---------- 系统代理自动检测（Windows 读注册表） ----------
function detectSystemProxy() {
  const out = { found: [], source: '', error: null };
  // 环境变量优先
  const envP = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
  if (envP) { out.found.push(envP); out.source = out.source || '环境变量'; }

  if (process.platform === 'win32') {
    try {
      // eslint-disable-next-line global-require
      const { execFileSync } = require('child_process');
      const txt = execFileSync('reg', [
        'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      ], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      const lines = String(txt || '').split(/\r?\n/);
      let enable = null, server = null;
      lines.forEach((l) => {
        const m = l.match(/^\s*(\w+)\s+REG_\w+\s+(.*)$/);
        if (!m) return;
        const k = m[1].toLowerCase();
        const v = String(m[2] || '').trim();
        if (k === 'proxyenable') enable = v;
        if (k === 'proxyserver') server = v;
      });
      if (server && String(enable) !== '0') {
        // 可能是 "http=127.0.0.1:7890;https=127.0.0.1:7890"，也可能是 "127.0.0.1:7890"
        const parts = server.split(/[;,\s]+/).map((s) => s.trim()).filter(Boolean);
        parts.forEach((p) => {
          const kv = p.match(/^(https?)=(.*)$/i);
          const raw = kv ? kv[2] : p;
          if (!raw) return;
          const url = /^https?:\/\//i.test(raw) ? raw : 'http://' + raw;
          if (!out.found.includes(url)) out.found.push(url);
        });
        out.source = out.source ? out.source + '+系统代理' : '系统代理';
      }
    } catch (e) {
      out.error = e.message;
    }
  }
  return out;
}

// 连通性自检：分别试直连与走代理，告诉用户哪条路通
async function checkReachability(testUrl) {
  const url = testUrl || 'https://www.google.com/generate_204';
  const res = { url, direct: null, proxy: null, proxyUrl: currentProxy() };
  const tryFetch = async (useProxy) => {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const r = await (useProxy ? globalThis.fetch : (nativeFetch || globalThis.fetch))(url, {
        method: 'GET', redirect: 'follow', signal: ctrl.signal,
      });
      clearTimeout(timer);
      return { ok: true, status: r.status, ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: e.message, ms: Date.now() - t0 };
    }
  };
  if (res.proxyUrl) res.proxy = await tryFetch(true);
  res.direct = await tryFetch(false);
  return res;
}

module.exports = { applyProxy, currentProxy, isLocal, hasUndici: () => !!undici, detectSystemProxy, checkReachability };
