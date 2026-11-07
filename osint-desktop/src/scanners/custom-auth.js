'use strict';

// 非公开数据源抓取：用你自己的登录态（Cookie / Authorization）请求目标接口，
// 并按配置的提取规则解析字段。目标地址与凭据全部来自 config.json 的 targets，
// 不内置任何站点，也不内置任何第三方凭据。

const Scanner = require('./base');
const config = require('../core/config');
const { limiter } = require('../core/limiter');
const { getCredential } = require('../core/session');

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(t));
  });
}

function matchesType(type, value) {
  switch (type) {
    case 'phone': return /^1[3-9]\d{9}$/.test(value);
    case 'idcard': return /^\d{15}$/.test(value) || /^\d{17}[\dXx]$/.test(value);
    case 'email': return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
    case 'username': return /^[a-zA-Z][a-zA-Z0-9._-]{1,39}$/.test(value);
    case 'any': return true;
    default: return false;
  }
}

async function fetchTarget(target, input, extraHeaders) {
  const enc = encodeURIComponent(input);
  const url = String(target.url || '').replace(/\{input\}/g, enc);
  if (!url) throw new Error('target.url 为空');
  // 合并顺序：登录态 < 目标显式配置（显式优先）
  const headers = Object.assign(
    { 'User-Agent': config.userAgent || 'Mozilla/5.0' },
    extraHeaders || {},
    target.headers || {}
  );
  const opts = { method: (target.method || 'GET').toUpperCase(), headers, redirect: 'follow' };
  if (target.body != null) {
    const raw = typeof target.body === 'string'
      ? target.body.replace(/\{input\}/g, enc)
      : JSON.stringify(target.body).replace(/\{input\}/g, enc);
    opts.body = raw;
    if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
  }
  const resp = await fetch(url, opts);
  const text = await resp.text();
  return { status: resp.status, text, url };
}

// 提取规则: json:a.b.c / regex:<pattern> / css:.class|#id / 其他=整段截断
function extractValue(text, rule) {
  if (!rule) return null;
  if (rule.startsWith('json:')) {
    const path = rule.slice(5);
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return null; }
    const val = path.split('.').reduce((o, k) => (o == null ? null : o[k]), obj);
    return val == null ? null : String(val);
  }
  if (rule.startsWith('regex:')) {
    let re;
    try { re = new RegExp(rule.slice(6)); } catch (e) { return null; }
    const m = String(text).match(re);
    if (!m) return null;
    return m[1] !== undefined ? m[1] : m[0];
  }
  if (rule.startsWith('css:')) {
    const sel = rule.slice(4);
    const isId = sel.startsWith('#');
    const name = sel.replace(/^[.#]/, '');
    let re;
    try {
      re = new RegExp(isId
        ? `id="${name}"[^>]*>([\\s\\S]*?)<`
        : `class="[^"]*\\b${name}\\b[^"]*"[^>]*>([\\s\\S]*?)<`, 'i');
    } catch (e) { return null; }
    const m = String(text).match(re);
    return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
  }
  return String(text).slice(0, 500);
}

function credToHeaders(cred) {
  if (!cred) return {};
  const h = {};
  if (cred.cookie) h['Cookie'] = cred.cookie;
  if (cred.token) h['Authorization'] = 'Bearer ' + cred.token;
  return h;
}

class CustomAuthScanner extends Scanner {
  constructor() {
    super('custom-auth');
  }

  canHandle(input) {
    const v = (input || '').trim();
    const targets = (config.targets || []).filter((t) => t && t.enabled);
    return targets.some((t) => matchesType(t.type, v));
  }

  async scan(input) {
    const v = input.trim();
    let cred = null;
    try { cred = await getCredential(); } catch (e) { /* 登录失败不阻断，回退到静态配置 */ }
    const out = {};
    const errs = [];
    for (const t of (config.targets || [])) {
      if (!t || !t.enabled) continue;
      if (!matchesType(t.type, v)) continue;
      try {
        await limiter.acquire();
        const r = await withTimeout(fetchTarget(t, v, credToHeaders(cred)), t.timeout || 15000);
        const fields = {};
        for (const [k, rule] of Object.entries(t.extract || {})) {
          fields[k] = extractValue(r.text, rule);
        }
        out[t.name || t.url] = { status: r.status, fields };
      } catch (e) {
        errs.push((t.name || t.url) + ': ' + e.message);
      }
    }
    return { source: 'custom-auth', data: out, error: errs.length ? errs.join('; ') : null };
  }
}

module.exports = CustomAuthScanner;
module.exports.extractValue = extractValue;
module.exports.matchesType = matchesType;
