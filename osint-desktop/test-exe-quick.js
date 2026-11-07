'use strict';

/**
 * 打包后 exe 的极简主链路冒烟（前置：exe 已启动，监听 3999）。
 * 重点验证：一步接入 → 主查询输手机号 → 出姓名/住址/电话/身份证。
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
    const r = http.request({ host: '127.0.0.1', port: 3999, path, method, headers: h, timeout: 60000 }, (res) => {
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
  const srv = await new Promise((r) => { const s = target.startTarget(4644); s.on('listening', () => r(s)); });
  const base = 'http://127.0.0.1:4644';
  let idx = -1;
  try {
    // 先清掉历史接入项
    const before = await req('GET', '/api/quick/targets');
    for (let i = (before.targets || []).length - 1; i >= 0; i--) {
      if (/^(查档站-|接管·)/.test((before.targets[i] || {}).name || '')) await req('POST', '/api/quick/targets/remove', { i });
    }

    const c = await req('POST', '/api/quick/connect', {
      url: base, subdomains: false, usernames: ['admin'], passwords: ['admin888'],
    });
    ok('一步接入成功', !!c.ok && !!c.target, c.error || (c.target && c.target.name));
    ok('有过程日志', (c.log || []).length >= 3, (c.log || []).length + ' 条');
    ok('识别指纹', (c.fingerprints || []).includes('ThinkPHP'), JSON.stringify(c.fingerprints || []));
    ok('拿到后台 Cookie', !!c.cookie, c.cookie);
    ok('试出参数名', (c.apis || [])[0] && (c.apis || [])[0].param === 'keyword',
      JSON.stringify((c.apis || []).map((a) => a.path + ':' + a.param)));

    const list = await req('GET', '/api/quick/targets');
    idx = (list.targets || []).findIndex((t) => t.enabled && /查档站-/.test(t.name || ''));
    ok('数据源列表可见', idx >= 0, JSON.stringify((list.targets || []).map((t) => t.name)));

    const t = await req('POST', '/api/quick/test', { i: idx, input: '13800138000' });
    ok('试查抽到四个字段',
      t.fields && t.fields['姓名'] === '张三' && /金砂街道/.test(String(t.fields['住址'])) &&
      /13800138000/.test(String(t.fields['手机'])) && /440524/.test(String(t.fields['身份证号'])),
      JSON.stringify(t.fields));

    // 主查询：这才是用户每天用的那一下
    const scan = await req('POST', '/api/scan', { input: '13800138000' });
    const std = scan.standard || {};
    ok('★ 主查询出姓名', std.name === '张三', JSON.stringify(std));
    ok('★ 主查询出街道住址', /金砂街道/.test(String(std.address || '')), std.address);
    ok('★ 主查询出电话', /13800138000/.test(String(std.phone || '')), std.phone);
    ok('★ 主查询出身份证', /440524199001011234/.test(String(std.idcard || '')), std.idcard);

    // 网络自检
    const d = await req('GET', '/api/net/detect');
    ok('系统代理检测可用', !!d.ok, '来源=' + (d.source || '无') + ' 找到=' + ((d.found || []).length));
    const ck = await req('POST', '/api/net/check', {});
    ok('连通性自检可用', !!(ck.url && (ck.direct || ck.proxy)), '');
  } finally {
    if (idx >= 0) {
      try {
        const cur = await req('GET', '/api/quick/targets');
        const j = (cur.targets || []).findIndex((t) => /查档站-/.test(t.name || ''));
        if (j >= 0) await req('POST', '/api/quick/targets/remove', { i: j });
      } catch (e) { /* ignore */ }
    }
    await target.stopTarget(srv);
  }

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常:', e.message); process.exit(1); });
