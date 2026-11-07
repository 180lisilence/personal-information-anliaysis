'use strict';

// 侦察：拿到一个域名后，把它的后台入口、指纹、暴露文件、子域全部摸出来。
// 社工库/查档类服务大多是现成源码二开，这套流程命中率很高。

const dns = require('dns');
const { URL } = require('url');
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

function hostOf(u) {
  try { return new URL(normalizeUrl(u)).hostname; } catch (e) { return ''; }
}

// 从文本里抠 URL（机器人回复、官网页面、JS 里都有）
function extractUrls(text) {
  const src = String(text || '');
  const out = new Set();
  const re = /https?:\/\/[^\s"'<>）)\]]+/gi;
  let m;
  while ((m = re.exec(src))) {
    let u = m[0].replace(/[.,;。，；]+$/, '');
    if (u) out.add(u);
  }
  // t.me 链接单独也收集（常用于跳官网）
  const reT = /(?:https?:\/\/)?t\.me\/[A-Za-z0-9_]{3,40}/gi;
  while ((m = reT.exec(src))) out.add(m[0].startsWith('http') ? m[0] : 'https://' + m[0]);
  return [...out];
}

// 把 t.me 链接背后的落地页摸出来（很多官网藏在跳转后面）
async function expandUrl(u, timeoutMs) {
  try {
    const r = await withTimeout(fetch(u, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
    }), timeoutMs || 15000);
    return { url: u, finalUrl: r.url, status: r.status };
  } catch (e) {
    return { url: u, finalUrl: u, status: 0, error: e.message };
  }
}

async function httpProbe(u, timeoutMs) {
  const started = Date.now();
  try {
    const r = await withTimeout(fetch(u, {
      redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: '*/*' },
    }), timeoutMs || 8000);
    let body = '';
    let title = '';
    const ctype = r.headers.get('content-type') || '';
    if (ctype.includes('text') || ctype.includes('json')) {
      try { body = await r.text(); } catch (e) { /* ignore */ }
      const tm = body.match(/<title[^>]*>([^<]{0,120})<\/title>/i);
      if (tm) title = tm[1].trim();
    }
    const size = body ? body.length : parseInt(r.headers.get('content-length') || '0', 10);
    return {
      url: u, status: r.status, size, title, ctype,
      server: r.headers.get('server') || '',
      powered: r.headers.get('x-powered-by') || '',
      setCookie: r.headers.get('set-cookie') || '',
      location: r.headers.get('location') || '',
      ms: Date.now() - started,
      body: body.slice(0, 4000),
    };
  } catch (e) {
    return { url: u, status: 0, error: e.message, ms: Date.now() - started };
  }
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch (e) { out[idx] = { error: e.message }; }
    }
  });
  await Promise.all(workers);
  return out;
}

// 指纹识别
function fingerprint(home) {
  const body = home.body || '';
  const headers = [home.server, home.powered, home.setCookie].join(' ');
  const hits = [];
  for (const f of dict.FINGERPRINTS) {
    try { if (f.test(body, headers)) hits.push(f.name); } catch (e) { /* ignore */ }
  }
  return hits;
}

// 子域存活探测（靠 DNS 解析，不需要发包，安静且快）
async function subdomains(domain, extraPrefixes) {
  const prefixes = (extraPrefixes && extraPrefixes.length ? extraPrefixes : dict.SUBDOMAIN_PREFIXES);
  const found = [];
  await mapLimit(prefixes, 12, async (p) => {
    const h = p + '.' + domain;
    try {
      const addrs = await withTimeout(dns.promises.resolve4(h), 4000);
      if (addrs && addrs.length) found.push({ host: h, ip: addrs[0] });
    } catch (e) { /* 不存在 */ }
  });
  return found.sort((a, b) => a.host.localeCompare(b.host));
}

// 路径探测：后台入口 + 敏感文件
async function probePaths(baseUrl, paths, concurrency) {
  const base = normalizeUrl(baseUrl);
  const list = (paths && paths.length) ? paths : dict.ADMIN_PATHS.concat(dict.EXPOSED_PATHS);
  const results = await mapLimit(list, concurrency || 8, async (p) => {
    const r = await httpProbe(base + p, 8000);
    const interesting = isInteresting(r);
    return interesting ? summarize(r) : { url: r.url, status: r.status, skip: true };
  });
  return results.filter((r) => r && !r.skip);
}

function isInteresting(r) {
  if (!r || r.status === 0 || r.status === 404) return false;
  if (r.status >= 200 && r.status < 400) return true;
  if (r.status === 401 || r.status === 403) return true; // 存在但要鉴权，也是情报
  return false;
}

function summarize(r) {
  return {
    url: r.url,
    status: r.status,
    size: r.size,
    title: r.title,
    ctype: r.ctype,
    server: r.server,
    powered: r.powered,
    location: r.location,
    ms: r.ms,
    note: classify(r),
  };
}

// 给探测结果打标签，方便一眼看出哪些值得打
function classify(r) {
  const u = r.url.toLowerCase();
  const body = r.body || '';
  if (/\.git\/config/.test(u) && /\[core\]/.test(body)) return '★ .git 泄露（可拉源码）';
  if (/\.env/.test(u) && /(APP_KEY|DB_PASSWORD|TELEGRAM|TOKEN)=/i.test(body)) return '★ .env 泄露（含密钥）';
  if (/\.sql(\.|$|\?)/.test(u)) return '★ 数据库备份可下载';
  if (/\.(zip|rar|tar|gz)$/.test(u)) return '★ 源码压缩包可下载';
  if (/phpinfo/i.test(u)) return '★ phpinfo（看绝对路径/模块）';
  if (/adminer|phpmyadmin|pma/.test(u)) return '★ 数据库管理入口';
  if (/actuator/.test(u)) return '★ Spring Actuator（/env 常泄露配置）';
  if (/swagger|api-docs/.test(u)) return '★ 接口文档（直接看有哪些查询 API）';
  if (/phpMyAdmin/i.test(body)) return 'phpMyAdmin 登录页';
  if (/验证码|captcha/i.test(body)) return '登录页（有验证码）';
  if (/<form/i.test(body) && /pass(word)?/i.test(body)) return '登录页';
  if (r.status === 401 || r.status === 403) return '存在但需鉴权';
  if (/login|登录|后台|管理/i.test(body.slice(0, 1500))) return '疑似后台/登录页';
  return '';
}

// 一次性侦察
async function recon(target, opts) {
  const o = opts || {};
  const base = normalizeUrl(target);
  const host = hostOf(base);
  const home = await httpProbe(base, 15000);
  const fp = fingerprint(home);
  const paths = await probePaths(base, o.paths, o.concurrency);
  let subs = [];
  if (o.subdomains !== false && host) subs = await subdomains(host, o.subdomainPrefixes);

  // 从首页里顺手抠 bot token 和更多链接
  const tokens = [...String(home.body || '').matchAll(dict.BOT_TOKEN_RE)].map((m) => m[0]);
  const links = extractUrls(home.body || '').slice(0, 40);

  return {
    target: base,
    host,
    home: { status: home.status, title: home.title, size: home.size, server: home.server, powered: home.powered, ms: home.ms },
    fingerprints: fp,
    paths,
    subdomains: subs,
    botTokens: [...new Set(tokens)],
    links,
  };
}

module.exports = { recon, probePaths, subdomains, fingerprint, extractUrls, httpProbe, normalizeUrl, hostOf, expandUrl, classify };
