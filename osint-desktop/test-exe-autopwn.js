'use strict';

/**
 * 对打包后的 exe 跑「一键接管」全链路冒烟（前置：exe 已启动，监听 3999）。
 * 用 keywords:[] 跳过 Telegram 找源，直接给本地靶站，验证 侦察→破登录→扫荡→接管→导入。
 */

const http = require('http');
const target = require('./test-offsec-live');

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const d = body ? Buffer.from(JSON.stringify(body)) : null;
    const h = { Accept: 'application/json' };
    if (d) { h['Content-Type'] = 'application/json'; h['Content-Length'] = d.length; }
    const r = http.request({ host: '127.0.0.1', port: 3999, path, method, headers: h, timeout: 30000 }, (res) => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { s += c; });
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { resolve({ __raw: s.slice(0, 300) }); } });
    });
    r.on('error', reject);
    if (d) r.write(d);
    r.end();
  });
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? '  => ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  => ' + extra : '')); }
}

(async () => {
  const srv = await new Promise((r) => { const s = target.startTarget(4611); s.on('listening', () => r(s)); });
  const base = 'http://127.0.0.1:4611';
  try {
    const st0 = await req('POST', '/api/offsec/autopwn', {
      keywords: [], sites: [base], subdomains: false,
      usernames: ['admin'], passwords: ['admin888'],
      maxSites: 1, maxBreach: 1, importTargets: false,
    });
    ok('启动任务', !!st0.jobId, st0.jobId);

    let st = null;
    for (let i = 0; i < 200; i++) {
      st = await req('GET', '/api/offsec/autopwn/status?id=' + st0.jobId);
      if (st.done) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    ok('任务完成且无异常', st.done && !st.error, st.error || '');
    ok('产出日志', (st.steps || []).length > 10, (st.steps || []).length + ' 条');

    const R = st.result || {};
    const site = (R.sites || [])[0] || {};
    ok('侦察出指纹', (site.fingerprints || []).includes('ThinkPHP'), JSON.stringify(site.fingerprints || []));
    ok('侦察出登录页', (site.loginUrls || []).length >= 1, JSON.stringify(site.loginUrls || []));
    ok('侦察出泄露面', (site.leaks || []).length >= 1, JSON.stringify((site.leaks || []).map((l) => l.note)));
    ok('破登录命中', (R.logins || []).length >= 1,
      JSON.stringify((R.logins || []).slice(0, 2).map((l) => l.via + ' ' + l.username + '/' + l.password)));
    ok('盲到查询接口', (R.apis || []).length >= 1, JSON.stringify((R.apis || []).map((a) => a.path)));
    ok('抠到 Bot Token 带来源', (R.tokens || []).length >= 1 && (R.tokens || []).every((t) => !!t.from),
      JSON.stringify((R.tokens || []).map((t) => t.from)));

    const im = await req('POST', '/api/offsec/import', { apis: R.apis || [] });
    ok('导入接口可用', !!im.ok && (im.added || []).length >= 1, JSON.stringify((im.added || []).map((a) => a.name)));

    const stopp = await req('POST', '/api/offsec/autopwn/stop', { id: st0.jobId });
    ok('停止接口可用', stopp.ok === true, JSON.stringify(stopp));

    const bad = await req('GET', '/api/offsec/autopwn/status?id=nope');
    ok('不存在的任务返回 404 提示', !!bad.error, bad.error);
  } finally {
    await target.stopTarget(srv);
  }

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常:', e.message); process.exit(1); });
