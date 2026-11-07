'use strict';

/**
 * 打包后 exe 的「自动找源」冒烟（前置：exe 已启动，监听 3999）。
 * 外网搜索在本环境不可达，用 hosts 覆盖跳过搜索，验证 快筛→攻破→接入→主查询 全链。
 */

const http = require('http');
const target = require('./test-offsec-live');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? '  => ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  => ' + extra : '')); }
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const d = body ? Buffer.from(JSON.stringify(body)) : null;
    const h = { Accept: 'application/json' };
    if (d) { h['Content-Type'] = 'application/json'; h['Content-Length'] = d.length; }
    const r = http.request({ host: '127.0.0.1', port: 3999, path, method, headers: h, timeout: 120000 }, (res) => {
      let t = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { t += c; });
      res.on('end', () => { try { resolve(JSON.parse(t)); } catch (e) { resolve({ __raw: t.slice(0, 300) }); } });
    });
    r.on('error', reject);
    if (d) r.write(d);
    r.end();
  });
}

(async () => {
  const srv = await new Promise((r) => { const s = target.startTarget(4666); s.on('listening', () => r(s)); });
  try {
    // 清掉历史接入项
    const before = await req('GET', '/api/quick/targets');
    for (let i = (before.targets || []).length - 1; i >= 0; i--) {
      if (/^(查档站-|接管·)/.test((before.targets[i] || {}).name || '')) await req('POST', '/api/quick/targets/remove', { i });
    }

    const st0 = await req('POST', '/api/discover/start', {
      hosts: ['127.0.0.1:4666'], scheme: 'http', maxProbe: 1, maxOk: 1,
      usernames: ['admin'], passwords: ['admin888'],
    });
    ok('启动自动找源', !!st0.jobId, st0.jobId || JSON.stringify(st0));

    let st = null;
    for (let i = 0; i < 300; i++) {
      st = await req('GET', '/api/discover/status?id=' + st0.jobId);
      if (st.done) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    ok('任务完成无异常', st.done && !st.error, st.error || '');
    ok('有过程日志', (st.steps || []).length >= 5, (st.steps || []).length + ' 条');

    const R = st.result || {};
    ok('快筛生效', R.good >= 1, JSON.stringify({ candidates: R.candidates, screened: R.screened, good: R.good }));
    ok('★ 自动接入成功', (R.connected || []).length >= 1,
      JSON.stringify((R.connected || []).map((c) => c.host + ' ' + c.body)));

    // 主查询 —— 用户每天用的那一下
    const scan = await req('POST', '/api/scan', { input: '13800138000' });
    const std = scan.standard || {};
    ok('★ 主查询出姓名', std.name === '张三', JSON.stringify(std));
    ok('★ 主查询出街道住址', /金砂街道/.test(String(std.address || '')), std.address);
    ok('★ 主查询出电话', /13800138000/.test(String(std.phone || '')), std.phone);
    ok('★ 主查询出身份证', /440524199001011234/.test(String(std.idcard || '')), std.idcard);

    ok('停止接口', (await req('POST', '/api/discover/stop', { id: st0.jobId })).ok === true, '');
    ok('不存在任务返回 404', !!(await req('GET', '/api/discover/status?id=nope')).error, '');

    console.log('\n--- 日志节选 ---');
    (st.steps || []).filter((s) => s.level === 'hit' || /完成/.test(s.stage)).slice(0, 10)
      .forEach((s) => console.log('  [' + s.stage + '] ' + s.msg));
  } finally {
    const cur = await req('GET', '/api/quick/targets');
    for (let i = (cur.targets || []).length - 1; i >= 0; i--) {
      if (/^(查档站-|接管·)/.test((cur.targets[i] || {}).name || '')) await req('POST', '/api/quick/targets/remove', { i });
    }
    await target.stopTarget(srv);
  }

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常:', e.message); process.exit(1); });
