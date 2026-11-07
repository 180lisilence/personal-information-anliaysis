'use strict';

/**
 * 一步式接入 connect 的端到端测试 + 「抓到的字段能浮到档案里」的回归。
 * 靶站 /api/query 用 keyword 参数，返回 {"code":0,"data":{姓名,住址,手机,身份证号}}。
 */

const assert = require('assert');
const http = require('http');
const target = require('./test-offsec-live');
const connect = require('./src/core/connect');
const config = require('./src/core/config');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? '  => ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  => ' + extra : '')); }
}

const targetsSnapshot = JSON.parse(JSON.stringify(
  (config.targets || []).filter((t) => !/^(查档站-|接管·)/.test(t.name || ''))
));
function restoreTargets() {
  config.targets.length = 0;
  targetsSnapshot.forEach((x) => config.targets.push(x));
  if (config.__save) config.__save();
}

(async () => {
  // ---- 纯函数：抽取规则推导 ----
  const j1 = connect.deriveExtract('{"code":0,"data":{"姓名":"张三","住址":"广东汕头金砂街道1号","手机":"13800138000","身份证号":"440524199001011234"}}');
  ok('JSON 响应推导出 json 路径规则', j1.format === 'json' && /json:/.test(j1.rules['姓名'] || ''),
    JSON.stringify(j1.rules));
  ok('住址规则指向 data.住址', j1.rules['住址'] === 'json:data.住址', j1.rules['住址']);
  ok('身份证规则指向 data.身份证号', j1.rules['身份证号'] === 'json:data.身份证号', j1.rules['身份证号']);

  const j2 = connect.deriveExtract('<div>姓名：李四<br>住址：北京市朝阳区XX街道5号</div>');
  ok('非 JSON 退回正则', j2.format === 'text' && /regex:/.test(j2.rules['姓名'] || ''), JSON.stringify(j2.rules['姓名']));

  ok('参数名候选覆盖 keyword/phone/idcard', ['keyword', 'phone', 'idcard'].every((p) => connect.PARAM_CANDIDATES.includes(p)),
    connect.PARAM_CANDIDATES.length + ' 个候选');

  // ---- 端到端：起靶站，一步接入 ----
  const srv = await new Promise((r) => { const s = target.startTarget(4622); s.on('listening', () => r(s)); });
  const base = 'http://127.0.0.1:4622';
  try {
    restoreTargets();
    const logs = [];
    const out = await connect.connect(
      { url: base, subdomains: false, usernames: ['admin'], passwords: ['admin888'] },
      (stage, msg, level) => logs.push({ stage, msg, level })
    );

    ok('侦察识别指纹', (out.fingerprints || []).includes('ThinkPHP'), JSON.stringify(out.fingerprints));
    ok('找到登录页', (out.loginUrls || []).length >= 1, JSON.stringify(out.loginUrls));
    ok('破登录拿到会话', !!out.cookie, out.cookie);
    ok('探测到参数名', out.apis && out.apis[0] && out.apis[0].param === 'keyword',
      JSON.stringify((out.apis || []).map((a) => a.path + ':' + a.param + '(分' + a.score + ')')));
    ok('没有误报（score 门槛生效）', (out.apis || []).every((a) => a.score >= 10), '');
    ok('落成数据源', !!out.target && out.target.enabled === true, out.target && out.target.name);
    ok('body 用探测到的参数名', out.target && out.target.body === 'keyword={input}', out.target && out.target.body);
    ok('写入 config.targets', (config.targets || []).some((t) => t.url === out.target.url), '');
    ok('无 warning', !out.warning, out.warning || '');

    // ---- 关键回归：抓到的字段要能浮到 /api/scan 的 standard 里 ----
    const s = require('./server/index.js');
    await s.start();
    const scan = await new Promise((res, rej) => {
      const d = Buffer.from(JSON.stringify({ input: '13800138000' }));
      const r = http.request({
        host: '127.0.0.1', port: s.getPort(), path: '/api/scan', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': d.length },
      }, (x) => { let t = ''; x.setEncoding('utf8'); x.on('data', (c) => { t += c; }); x.on('end', () => { try { res(JSON.parse(t)); } catch (e) { res({ raw: t.slice(0, 300) }); } }); });
      r.on('error', rej); r.write(d); r.end();
    });

    const std = scan.standard || {};
    ok('★ 档案里出现姓名', std.name === '张三', JSON.stringify(std));
    ok('★ 档案里出现街道住址', /金砂街道/.test(String(std.address || '')), std.address);
    ok('★ 档案里出现电话', /13800138000/.test(String(std.phone || '')), std.phone);
    ok('★ 档案里出现身份证', /440524199001011234/.test(String(std.idcard || '')), std.idcard);
    await s.stop();

    console.log('\n--- 接入日志 ---');
    logs.forEach((l) => console.log('  [' + l.stage + '] ' + l.msg));
  } finally {
    await target.stopTarget(srv);
    restoreTargets();
  }

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常:', e.stack || e.message); process.exit(1); });
