'use strict';

// my.telegram.org 凭据申请自动化。
// 官方网页背后就是几个普通 HTTP 接口，用它们可以脚本化完成：
//   1) /auth/send_password  提交手机号 → 返回 random_hash（同时 Telegram 发来登录码）
//   2) /auth/login          提交 手机号 + random_hash + 登录码 → 拿到会话 Cookie
//   3) /apps/create         提交应用信息 → 返回 api_id / api_hash
//   4) /apps                读取已有应用（已有应用时直接从中抠 api_id / api_hash，不用新建）
//
// 说明：这里的"password"字段填的就是 Telegram 发来的登录码（官方页面就是这么叫的）。

const https = require('https');
const http = require('http');
const tls = require('tls');
const net = require('net');
const { URL } = require('url');
const config = require('./config');

const ORIGIN = 'https://my.telegram.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// 会话 Cookie（单用户工具，放模块级即可）
let cookieJar = '';

function setCookies(resp) {
  let arr = [];
  try {
    if (typeof resp.headers.getSetCookie === 'function') arr = resp.headers.getSetCookie();
  } catch (e) { /* ignore */ }
  if (!arr || !arr.length) {
    const raw = resp.headers.get('set-cookie');
    if (raw) arr = [raw];
  }
  for (const c of arr) {
    const kv = String(c).split(';')[0];
    if (!kv) continue;
    const name = kv.split('=')[0];
    const keep = cookieJar.split(';').filter((s) => s.trim() && s.trim().split('=')[0] !== name);
    keep.push(kv);
    cookieJar = keep.join('; ');
  }
}

// ---------- 代理（国内访问 my.telegram.org / Telegram 必须） ----------
// 支持 http://host:port 、https://host:port 、socks5://[user:pass@]host:port
function getProxy() {
  const p = (config && config.proxy) ? String(config.proxy).trim() : '';
  return p || (process.env.HTTPS_PROXY || process.env.https_proxy || '');
}

function httpConnectTunnel(proxyUrl, host, port) {
  return new Promise((resolve, reject) => {
    const p = new URL(proxyUrl);
    const req = http.request({
      host: p.hostname,
      port: parseInt(p.port || (p.protocol === 'https:' ? 443 : 80), 10),
      method: 'CONNECT',
      path: host + ':' + port,
      headers: { Host: host + ':' + port },
      timeout: 15000,
    });
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return reject(new Error('代理 CONNECT 返回 ' + res.statusCode)); }
      resolve(socket);
    });
    req.once('error', reject);
    req.once('timeout', () => { req.destroy(new Error('代理连接超时')); });
    req.end();
  });
}

// 极简 SOCKS5（无认证 / 用户名密码认证）
function socks5Connect(proxyUrl, host, port) {
  return new Promise((resolve, reject) => {
    const p = new URL(proxyUrl);
    const user = p.username ? decodeURIComponent(p.username) : '';
    const pass = p.password ? decodeURIComponent(p.password) : '';
    const sock = net.connect(parseInt(p.port || 1080, 10), p.hostname);
    let step = 0;
    const done = (err) => { if (err) { try { sock.destroy(); } catch (e) {} reject(err); } };
    sock.setTimeout(15000, () => done(new Error('SOCKS5 连接超时')));
    sock.once('error', (e) => done(e));
    sock.on('data', (buf) => {
      try {
        if (step === 0) {
          if (buf[0] !== 0x05) return done(new Error('SOCKS5 握手失败'));
          const method = buf[1];
          if (method === 0xff) return done(new Error('SOCKS5 不接受任何认证方式'));
          if (method === 0x02) {
            const u = Buffer.from(user, 'utf8');
            const pw = Buffer.from(pass, 'utf8');
            sock.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([pw.length]), pw]));
            step = 1;
          } else {
            request();
          }
        } else if (step === 1) {
          if (buf[0] !== 0x01 || buf[1] !== 0x00) return done(new Error('SOCKS5 认证失败'));
          request();
        } else if (step === 2) {
          if (buf[1] !== 0x00) return done(new Error('SOCKS5 连接失败，代码 ' + buf[1]));
          resolve(sock);
        }
      } catch (e) { done(e); }
    });
    function request() {
      step = 2;
      const h = Buffer.from(host, 'utf8');
      const req = Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, h.length]),
        h,
        Buffer.from([(port >> 8) & 0xff, port & 0xff]),
      ]);
      sock.write(req);
    }
    sock.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
  });
}

async function makeConnection(host, port) {
  const proxy = getProxy();
  if (!proxy) return null;
  const pu = new URL(proxy);
  if (pu.protocol === 'socks5:' || pu.protocol === 'socks:') {
    const raw = await socks5Connect(proxy, host, port);
    return tls.connect({ socket: raw, servername: host });
  }
  const raw = await httpConnectTunnel(proxy, host, port);
  return tls.connect({ socket: raw, servername: host });
}

// 轻量 HTTPS 请求（自管理 Cookie + 代理 + 错误码提取，不依赖第三方库）
function request(method, path, form) {
  return (async () => {
    const u = new URL(ORIGIN + path);
    const host = u.hostname;
    const port = parseInt(u.port || 443, 10);
    const body = form ? new URLSearchParams(form).toString() : null;
    const headers = {
      'User-Agent': UA,
      'Origin': ORIGIN,
      'Referer': ORIGIN + '/',
      'Accept': 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
      'Host': host,
    };
    if (cookieJar) headers['Cookie'] = cookieJar;
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const conn = await makeConnection(host, port);
    let agent;
    if (conn) {
      agent = new https.Agent({ keepAlive: false });
      agent.createConnection = () => conn;
    }

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host,
          port,
          path: u.pathname + (u.search || ''),
          method: method.toUpperCase(),
          headers,
          timeout: 25000,
          ...(agent ? { agent } : {}),
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (d) => { data += d; });
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
        }
      );
      req.on('timeout', () => req.destroy(new Error('请求超时')));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  })();
}

function tryJson(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

// 统一错误提取：优先 JSON 的 error 字段，其次纯文本
function fail(resp, fallback) {
  const j = tryJson(resp.text);
  if (j && j.error) return new Error(String(j.error));
  if (j && j.message) return new Error(String(j.message));
  if (resp.text && resp.text.length < 200 && /^[A-Z_]+$/.test(resp.text.trim())) return new Error(resp.text.trim());
  return new Error(fallback || ('HTTP ' + resp.status));
}

function normalizePhone(p) {
  let s = String(p || '').trim().replace(/[\s()-]/g, '');
  if (!s) throw new Error('缺少手机号');
  if (!s.startsWith('+')) s = '+' + s.replace(/^0+/, '');
  return s;
}

// ① 发送登录码
async function sendCode(phoneNumber) {
  const phone = normalizePhone(phoneNumber);
  cookieJar = '';
  const r = await request('POST', '/auth/send_password', { phone });
  setCookies(r);
  const j = tryJson(r.text);
  if (j && j.error) throw new Error(String(j.error));
  if (!j || !j.random_hash) throw fail(r, '未能取得 random_hash（接口可能已改版）');
  return { phone, randomHash: String(j.random_hash) };
}

// ② 用登录码完成登录，拿到会话 Cookie
async function login(phoneNumber, randomHash, code) {
  const phone = normalizePhone(phoneNumber);
  const r = await request('POST', '/auth/login', {
    phone,
    random_hash: String(randomHash || ''),
    password: String(code || '').trim(),
  });
  setCookies(r);
  const j = tryJson(r.text);
  if (j && j.error) throw new Error(String(j.error));
  if (!cookieJar) {
    // 有的版本成功时返回空 JSON 且靠 Set-Cookie 标记会话
    throw fail(r, '登录未成功（Cookie 未下发），请检查登录码');
  }
  return { ok: true, phone };
}

// 从 /apps 页面 HTML（或 apps/create 返回）里抠出 api_id / api_hash
function parseApps(text) {
  const apps = [];
  const src = String(text || '');
  const ids = [];
  const hashes = [];
  const titles = [];
  let m;
  const reId = /"api_id"\s*:\s*"?(\d+)"?/g;
  const reHash = /"api_hash"\s*:\s*"([0-9a-fA-F]{32})"/g;
  const reTitle = /"app_title"\s*:\s*"([^"]*)"/g;
  while ((m = reId.exec(src))) ids.push(m[1]);
  while ((m = reHash.exec(src))) hashes.push(m[1]);
  while ((m = reTitle.exec(src))) titles.push(m[1]);
  const n = Math.min(ids.length, hashes.length);
  for (let i = 0; i < n; i++) {
    apps.push({ apiId: ids[i], apiHash: hashes[i], title: titles[i] || '' });
  }
  return apps;
}

// ③ 读取已有应用（从 /apps 页面 HTML 里抠 api_id / api_hash）
async function listApps() {
  const r = await request('GET', '/apps');
  setCookies(r);
  if (r.status >= 400 && !r.text) throw fail(r, '读取应用列表失败');
  const apps = parseApps(r.text);
  return { apps, loggedIn: !/Sign in|Log in|<form[^>]+id="login_form"/i.test(r.text) || apps.length > 0 };
}

// ④ 创建应用，返回 api_id / api_hash
async function createApp(opts) {
  const o = opts || {};
  const payload = {
    app_title: String(o.appTitle || 'OSINT Desktop'),
    app_shortname: String(o.appShortname || (o.appTitle || 'osint')).toLowerCase().replace(/[^a-z0-9_]/g, '') || 'osintapp',
    app_url: String(o.appUrl || ''),
    app_platform: String(o.appPlatform || 'desktop'),
    app_desc: String(o.appDesc || ''),
  };
  const r = await request('POST', '/apps/create', payload);
  setCookies(r);
  const j = tryJson(r.text);
  if (j && j.error) throw new Error(String(j.error));
  if (j && (j.api_id || j.api_hash)) {
    return { apiId: String(j.api_id || (j.app && j.app.api_id) || ''), apiHash: String(j.api_hash || (j.app && j.app.api_hash) || '') };
  }
  // 有的版本把整个 app 对象包在 data 里，或返回 HTML 片段
  const parsed = parseApps(r.text);
  if (parsed.length) return { apiId: parsed[0].apiId, apiHash: parsed[0].apiHash };
  throw fail(r, '创建应用未返回 api_id / api_hash');
}

// 连通性自检：能不能连上 my.telegram.org（用来判断代理是否配好）
async function probeProxy() {
  const started = Date.now();
  const proxy = getProxy();
  try {
    const r = await request('GET', '/');
    const reachable = r.status < 500;
    return {
      ok: reachable,
      status: r.status,
      proxy: proxy || '(直连)',
      latencyMs: Date.now() - started,
      hint: reachable ? 'my.telegram.org 可达' : '返回 HTTP ' + r.status,
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message,
      proxy: proxy || '(直连)',
      latencyMs: Date.now() - started,
      hint: '连不上：国内需要填可用的代理（HTTP/SOCKS5），或用能访问 Telegram 的网络',
    };
  }
}

// 一次性走完：发送码 → 登录 → （有现成的就直接读，没有就新建）→ 返回凭据
async function obtain(opts) {
  const o = opts || {};
  if (!o.randomHash) {
    const s = await sendCode(o.phoneNumber);
    return { needCode: true, phone: s.phone, randomHash: s.randomHash };
  }
  await login(o.phoneNumber, o.randomHash, o.code);
  let existing = [];
  try { existing = (await listApps()).apps; } catch (e) { /* 忽略，直接尝试新建 */ }
  if (existing.length) {
    return { apiId: existing[0].apiId, apiHash: existing[0].apiHash, source: 'existing', all: existing };
  }
  const created = await createApp(o);
  return { apiId: created.apiId, apiHash: created.apiHash, source: 'created' };
}

function reset() { cookieJar = ''; }

module.exports = {
  sendCode, login, listApps, createApp, obtain, probeProxy, reset,
  ORIGIN, getProxy, normalizePhone, parseApps,
};
