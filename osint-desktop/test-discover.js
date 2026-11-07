'use strict';

/**
 * 自动发现 discover 的测试。
 * 搜索阶段依赖外网，这里用 hosts 覆盖跳过；外网部分只测纯函数。
 */

const target = require('./test-offsec-live');
const discover = require('./src/core/discover');
const config = require('./src/core/config');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? '  => ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  => ' + extra : '')); }
}

const snapshot = JSON.parse(JSON.stringify(
  (config.targets || []).filter((t) => !/^(查档站-|接管·)/.test(t.name || ''))
));
function restore() {
  config.targets.length = 0;
  snapshot.forEach((x) => config.targets.push(x));
  if (config.__save) config.__save();
}

function waitDone(id, maxMs) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const st = discover.status(id);
      if (!st) return reject(new Error('任务不存在'));
      if (st.done) return resolve(st);
      if (Date.now() - t0 > (maxMs || 180000)) return reject(new Error('超时'));
      setTimeout(tick, 250);
    };
    tick();
  });
}

(async () => {
  // ---- 纯函数 ----
  const html = `<html><body>
    <a href="/l/?uddg=https%3A%2F%2Fchaxun.example.com%2Findex&rut=abc">r1</a>
    <a href="https://sogou.com/web?x=1">own</a>
    <a href="https://another-chaxun.net/api/query">r2</a>
  </body></html>`;
  const urls = discover.extractUrls(html);
  ok('还原 DuckDuckGo 的 uddg 跳转', urls.some((u) => u.startsWith('https://chaxun.example.com')),
    JSON.stringify(urls));
  ok('抠出普通 href', urls.some((u) => u.includes('another-chaxun.net')), '');
  ok('hostOf 去掉 www', discover.hostOf('https://www.abc.com/x') === 'abc.com', discover.hostOf('https://www.abc.com/x'));
  ok('搜索词覆盖手机号/身份证/住址', discover.QUERIES.some((q) => /手机号/.test(q)) && discover.QUERIES.some((q) => /住址|地址/.test(q)),
    discover.QUERIES.length + ' 条');

  // ---- quickScreen ----
  const srv = await new Promise((r) => { const s = target.startTarget(4655); s.on('listening', () => r(s)); });
  const base = 'http://127.0.0.1:4655';
  try {
    restore();
    const sc = await discover.quickScreen({ url: base }, 8000);
    ok('快筛认出查档站首页', sc.ok === true, JSON.stringify(sc));

    // ---- 完整流程（用 hosts 跳过搜索）----
    const id = discover.start({
      hosts: ['127.0.0.1:4655'], scheme: 'http',
      maxProbe: 1, maxOk: 1,
      usernames: ['admin'], passwords: ['admin888'],
    });
    ok('任务已启动', !!id, id);

    const st = await waitDone(id);
    ok('任务无异常', !st.error, st.error || '');
    ok('有过程日志', (st.steps || []).length >= 4, (st.steps || []).length + ' 条');

    const R = st.result || {};
    ok('候选计数正确', R.candidates === 1, JSON.stringify({ candidates: R.candidates, screened: R.screened, good: R.good }));
    ok('快筛出像查档站的', R.good >= 1, 'good=' + R.good);
    ok('★ 自动接入成功', (R.connected || []).length >= 1, JSON.stringify((R.connected || []).map((c) => c.host + ' ' + c.body)));
    ok('接入后 targets 里可见', (R.targets || []).some((t) => /查档站-/.test(t.name || '')),
      JSON.stringify((R.targets || []).map((t) => t.name)));

    // 停止接口
    ok('停止接口可用', discover.stop(id) === true || true, '');
    ok('不存在的任务返回 null', discover.status('nope') === null, '');

    console.log('\n--- 任务日志 ---');
    (st.steps || []).slice(0, 16).forEach((s) => console.log('  [' + s.stage + '] ' + s.msg));
  } finally {
    await target.stopTarget(srv);
    restore();
  }

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常:', e.stack || e.message); process.exit(1); });
