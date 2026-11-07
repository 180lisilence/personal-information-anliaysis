'use strict';

// 人员身份查询：对接能返回「姓名 + 详细住址」的非公开数据服务。
// 预置接入模板见 config.json 的 lookupProviders，填入自己的 apiKey 并把 enabled 设为 true 即可。
// 返回字段直接用标准键（name/address/phone/idcard），会被 profile.js 归集进「个人档案」卡片。

const Scanner = require('./base');
const config = require('../core/config');
const { limiter } = require('../core/limiter');

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(t));
  });
}

function matchesType(type, value) {
  switch (type) {
    case 'phone': return /^\+?\d{7,15}$/.test(value);
    case 'idcard': return /^\d{15}$/.test(value) || /^\d{17}[\dXx]$/.test(value);
    case 'email': return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
    case 'username': return /^[a-zA-Z][a-zA-Z0-9._-]{1,39}$/.test(value);
    case 'any': return true;
    default: return false;
  }
}

function getByPath(obj, path) {
  return String(path).split('.').reduce((o, k) => (o == null ? null : o[k]), obj);
}

// spec: { path: "0.name" } / { combine: [...] } / { regex: "...", flags: "i" }
function extractField(json, spec) {
  if (!spec || json == null) return null;
  if (spec.regex) return extractFromText(json, spec);
  if (spec.path) {
    const v = getByPath(json, spec.path);
    return v == null ? null : String(v);
  }
  if (Array.isArray(spec.combine)) {
    const parts = spec.combine
      .map((p) => { const v = getByPath(json, p); return v == null ? '' : String(v); })
      .filter((s) => s !== '');
    return parts.length ? parts.join(' ') : null;
  }
  return null;
}

// 从 HTML/纯文本里按正则抠字段（用于没有 API、只能抓网页的站点）
function extractFromText(text, spec) {
  if (!spec || !spec.regex || text == null) return null;
  try {
    const m = String(text).match(new RegExp(spec.regex, spec.flags || ''));
    if (!m) return null;
    const v = m[1] !== undefined ? m[1] : m[0];
    return v == null ? null : String(v).replace(/\s+/g, ' ').trim();
  } catch (e) {
    return null;
  }
}

class PeopleLookupScanner extends Scanner {
  constructor() {
    super('people-lookup');
  }

  canHandle(input) {
    const v = (input || '').trim();
    const providers = (config.lookupProviders || []).filter(
      (p) => p && p.enabled && (p.apiKey || p.requireKey === false)
    );
    return providers.some((p) => matchesType(p.type, v));
  }

  async scan(input) {
    const v = input.trim();
    const merged = { name: null, address: null, phone: null, idcard: null };
    const detail = {};
    const errs = [];

    for (const p of (config.lookupProviders || [])) {
      if (!p || !p.enabled) continue;
      if (!(p.apiKey || p.requireKey === false)) continue;
      if (!matchesType(p.type, v)) continue;
      try {
        await limiter.acquire();
        const headers = { 'User-Agent': config.userAgent || 'Mozilla/5.0' };
        if (p.authHeader) headers[p.authHeader] = (p.authPrefix || '') + p.apiKey;

        const opts = { method: (p.method || 'GET').toUpperCase(), headers, redirect: 'follow' };
        let url = String(p.url || '').replace(/\{input\}/g, encodeURIComponent(v));

        if (opts.method === 'POST') {
          const bodyObj = {};
          for (const [k, val] of Object.entries(p.body || {})) {
            bodyObj[k] = String(val).replace(/\{input\}/g, v);
          }
          if (p.contentType === 'form') {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            opts.body = new URLSearchParams(bodyObj).toString();
          } else {
            headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(bodyObj);
          }
        }

        const resp = await withTimeout(fetch(url, opts), p.timeout || 20000);
        const text = await resp.text();
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }

        const fields = {};
        for (const std of ['name', 'address', 'phone', 'idcard']) {
          if (p.fields && p.fields[std]) {
            // format=html（或响应非 JSON）时按正则从文本抠；否则按 json path/combine 取
            const src = (p.format === 'html' || json === null) ? text : json;
            const val = (p.format === 'html' || json === null)
              ? extractFromText(text, p.fields[std])
              : extractField(json, p.fields[std]);
            fields[std] = val;
            if (val && !merged[std]) merged[std] = val;
          }
        }
        detail[p.name || p.url] = { status: resp.status, fields };
      } catch (e) {
        errs.push((p.name || '?') + ': ' + e.message);
      }
    }

    // 输入本身是手机号/身份证时补位
    if (/^1[3-9]\d{9}$/.test(v) && !merged.phone) merged.phone = v;
    if (/^\d{17}[\dXx]$/.test(v) && !merged.idcard) merged.idcard = v.toUpperCase();

    return {
      source: 'people-lookup',
      data: merged,
      meta: { detail },
      error: errs.length ? errs.join('; ') : null,
    };
  }
}

module.exports = PeopleLookupScanner;
module.exports.extractField = extractField;
module.exports.extractFromText = extractFromText;
module.exports.getByPath = getByPath;
