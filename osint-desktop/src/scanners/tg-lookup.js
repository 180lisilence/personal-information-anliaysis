'use strict';

// Telegram 社工库机器人查询：以账号身份向配置的机器人/群组发送手机号、身份证号或姓名，
// 读取机器人返回的户籍、快递地址等信息，按正则解析出 姓名/住址/电话/身份证号。
// Bot API 做不到（只能操作自己的 bot），必须走 MTProto，见 src/core/telegram.js。

const Scanner = require('./base');
const config = require('../core/config');
const tg = require('../core/telegram');

function matchesType(type, value) {
  switch (type) {
    case 'phone': return /^1[3-9]\d{9}$/.test(value) || /^\+?\d{7,15}$/.test(value);
    case 'idcard': return /^\d{15}$/.test(value) || /^\d{17}[\dXx]$/.test(value);
    case 'name': return /^[一-龥]{2,10}$/.test(value);
    case 'email': return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
    case 'any': return true;
    default: return false;
  }
}

function parseField(text, rule) {
  if (!text || !rule || !rule.regex) return null;
  try {
    const re = new RegExp(rule.regex);
    const m = String(text).match(re);
    if (!m) return null;
    return m[1] !== undefined ? m[1] : m[0];
  } catch (e) {
    return null;
  }
}

class TgLookupScanner extends Scanner {
  constructor() {
    super('tg-lookup');
  }

  canHandle(input) {
    const t = config.telegram || {};
    if (!t.enabled || !t.sessionString) return false;
    if (!tg.isAvailable()) return false;
    const v = (input || '').trim();
    return (t.bots || []).filter((b) => b && b.enabled).some((b) => matchesType(b.type, v));
  }

  async scan(input) {
    const v = input.trim();
    const t = config.telegram || {};
    const merged = { name: null, address: null, phone: null, idcard: null };
    const detail = {};
    const errs = [];

    for (const b of (t.bots || [])) {
      if (!b || !b.enabled) continue;
      if (!b.target) { errs.push((b.name || '?') + ': 缺少 target'); continue; }
      if (!matchesType(b.type, v)) continue;
      try {
        const query = String(b.queryTemplate || '{input}').replace(/\{input\}/g, v);
        const reply = await tg.sendQuery(b.target, query, b.waitMs);
        const fields = {};
        for (const std of ['name', 'address', 'phone', 'idcard']) {
          if (b.parse && b.parse[std]) {
            const val = parseField(reply, b.parse[std]);
            fields[std] = val;
            if (val && !merged[std]) merged[std] = val;
          }
        }
        detail[b.name || b.target] = {
          query,
          reply: reply ? String(reply).slice(0, 600) : null,
          fields,
        };
      } catch (e) {
        errs.push((b.name || b.target) + ': ' + e.message);
      }
    }

    if (/^1[3-9]\d{9}$/.test(v) && !merged.phone) merged.phone = v;
    if (/^\d{17}[\dXx]$/.test(v) && !merged.idcard) merged.idcard = v.toUpperCase();

    return { source: 'tg-lookup', data: merged, meta: { detail }, error: errs.length ? errs.join('; ') : null };
  }
}

module.exports = TgLookupScanner;
module.exports.parseField = parseField;
module.exports.matchesType = matchesType;
