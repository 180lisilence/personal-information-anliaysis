'use strict';

/**
 * 极简主区相关接口的端到端测试：
 *   /api/quick/connect（一步接入）、/api/quick/targets（列表/启停/删除）、
 *   /api/quick/test（试查）、/api/net/detect（系统代理检测）、/api/net/check（连通性）
 */

const http = require('http');
const target = require('./test-offsec-live');
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

(async () => {
  const s = require('./server/index.js');
  await s.start();
  const port = s.getPort();

  function req(method, path, body) {
    return new Promise((resolve, reject) => {
      const d = body ? Buffer.from(JSON.stringify(body)) : null;
      const h = { Accept: 'application/json' };
      if (d) { h['Content-Type'] = 'application/json'; h['Content-Length'] = d.length; }
      const r = http.request({ host: '127.0.0.1', port, path, method, headers: h, timeout: 60000 }, (res) => {
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

  const srv = await new Promise((r) => { const x = target.startTarget(4633); x.on('listening', () => r(x)); });
  const base = 'http://127.0.0.1:4633';
  try {
    restore();

    // ---- 一步接入 ----
    const c = await req('POST', '/api/quick/connect', {
      url: base, subdomains: false, usernames: ['admin'], passwords: ['admin888'],
    });
    ok('connect 成功', !!c.ok && !!c.target, c.error || (c.target && c.target.name));
    ok('connect 有过程日志', (c.log || []).length >= 3, (c.log || []).length + ' 条');
    ok('connect 识别指纹', (c.fingerprints || []).includes('ThinkPHP'), JSON.stringify(c.fingerprints || []));
    ok('connect 拿到 Cookie', !!c.cookie, c.cookie);
    ok('connect 探测到参数名', (c.apis || [])[0] && (c.apis || [])[0].param === 'keyword',
      JSON.stringify((c.apis || []).map((a) => a.path + ':' + a.param)));
    ok('connect 缺 url 时报错', !!(await req('POST', '/api/quick/connect', {})).error, '');

    // ---- 列表 ----
    const list = await req('GET', '/api/quick/targets');
    const idx = (list.targets || []).findIndex((t) => t.enabled && /查档站-/.test(t.name || ''));
    ok('targets 列表含新接入的源', idx >= 0, JSON.stringify((list.targets || []).map((t) => t.name)));

    // ---- 试查 ----
    const t = await req('POST', '/api/quick/test', { i: idx, input: '13800138000' });
    ok('试查抽到姓名', t.fields && t.fields['姓名'] === '张三', JSON.stringify(t.fields));
    ok('试查抽到住址', /金砂街道/.test(String((t.fields || {})['住址'] || '')), (t.fields || {})['住址']);
    ok('试查缺 input 报错', !!(await req('POST', '/api/quick/test', { i: idx })).error, '');

    // ---- 启停 / 删除 ----
    const off = await req('POST', '/api/quick/targets/set', { i: idx, enabled: false });
    ok('停用生效', off.target && off.target.enabled === false, '');
    const on = await req('POST', '/api/quick/targets/set', { i: idx, enabled: true });
    ok('启用生效', on.target && on.target.enabled === true, '');
    ok('越界索引报错', !!(await req('POST', '/api/quick/targets/set', { i: 999, enabled: true })).error, '');

    // ---- 主查询：确认接进来的源真能出档案 ----
    const scan = await req('POST', '/api/scan', { input: '13800138000' });
    const std = scan.standard || {};
    ok('★ 主查询出姓名', std.name === '张三', JSON.stringify(std));
    ok('★ 主查询出住址', /金砂街道/.test(String(std.address || '')), std.address);
    ok('★ 主查询出身份证', /440524199001011234/.test(String(std.idcard || '')), std.idcard);

    // ---- 删除 ----
    const rm = await req('POST', '/api/quick/targets/remove', { i: idx });
    ok('删除生效', !!rm.ok, rm.removed);

    // ---- 网络 ----
    const d = await req('GET', '/api/net/detect');
    ok('系统代理检测不报错', !!d.ok, '来源=' + (d.source || '无') + ' 找到=' + ((d.found || []).length));
    const ck = await req('POST', '/api/net/check', {});
    ok('连通性自检返回结构', !!(ck.url && (ck.direct || ck.proxy)), JSON.stringify({ direct: ck.direct, proxy: ck.proxy }).slice(0, 160));
  } finally {
    await target.stopTarget(srv);
    restore();
    await s.stop();
  }

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常:', e.stack || e.message); process.exit(1); });
