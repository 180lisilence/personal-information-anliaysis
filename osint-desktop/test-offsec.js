'use strict';

// 后台突破模块的离线逻辑测试（不发真实请求）

const recon = require('./src/core/recon');
const breach = require('./src/core/breach');
const dict = require('./src/core/dict');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + label + ' => ' + JSON.stringify(actual) + (ok ? '' : ' (期望 ' + JSON.stringify(expected) + ')'));
  ok ? pass++ : fail++;
}

// 1. URL 提取（机器人回复里常藏官网）
const botReply = '官网：https://chaxun.example.com 备用 http://www.example2.com/?ref=tg\nTG频道 https://t.me/sgknews 联系 @somebot';
const urls = recon.extractUrls(botReply);
check('抠出 http(s) 链接数', urls.filter((u) => /^https?:\/\/(?!t\.me)/.test(u)).length, 2);
check('抠出 t.me 链接', urls.filter((u) => u.includes('t.me')).length, 1);
check('官网域名', urls[0], 'https://chaxun.example.com');

// 2. 隐藏字段解析（CSRF / token）
const html = '<form method="post"><input type="hidden" name="_token" value="abc123">' +
  '<input type="hidden" name="__hash__" value="h9x"><input type="text" name="username">' +
  '<input type="password" name="password"><input type="submit" value="登录"></form>';
const hidden = breach.parseHiddenInputs(html);
check('隐藏字段 _token', hidden._token, 'abc123');
check('隐藏字段 __hash__', hidden.__hash__, 'h9x');
const fields = breach.parseFormFields(html);
check('表单字段', fields, ['username', 'password']);
check('猜测字段组合', breach.guessFieldSet(['user_name', 'pwd', 'x']), [{ user: 'user_name', pass: 'pwd' }]);

// 3. 登录成功判定
const baseline = { status: 200, length: 1200, setCookie: '', location: '', text: '用户名或密码错误' };
const okRes = { status: 302, length: 80, setCookie: 'PHPSESSID=abc', location: '/admin/index', text: '' };
const failRes = { status: 200, length: 1205, setCookie: '', location: '', text: '密码错误，请重试' };
const diffRes = { status: 200, length: 4300, setCookie: 'admin_auth=1', location: '', text: '<div>欢迎</div>' };
check('登录成功(跳转+Cookie)', breach.looksSuccess(okRes, baseline).ok, true);
check('登录失败(命中失败特征)', breach.looksSuccess(failRes, baseline).ok, false);
check('登录成功(长度/Cookie 差异)', breach.looksSuccess(diffRes, baseline).ok, true);

// 4. Bot Token 识别与提取
const leak = 'config: {"tg_token":"7123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","api":"x"}';
const tokens = breach.extractBotTokens(leak);
check('抠出 bot token 数', tokens.length, 1);
check('token 格式', /^\d{8,10}:[A-Za-z0-9_-]{35}$/.test(tokens[0]), true);

// 5. JWT alg=none 伪造
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ user: 'guest', role: 'user' }) + '.sig';
const d = breach.jwtDecode(jwt);
check('JWT 解码 payload.user', d.payload.user, 'guest');
const forged = breach.jwtForge(jwt, { role: 'admin', user: 'admin' });
const fd = breach.jwtDecode(forged);
check('伪造 alg', fd.header.alg, 'none');
check('伪造 role', fd.payload.role, 'admin');
check('伪造签名留空', forged.split('.')[2], '');

// 6. 探测结果分类
check('.git 泄露', recon.classify({ url: 'http://a/.git/config', status: 200, body: '[core]\n\trepositoryformatversion = 0' }).startsWith('★'), true);
check('.env 泄露', recon.classify({ url: 'http://a/.env', status: 200, body: 'APP_KEY=base64:xx\nDB_PASSWORD=123\nTELEGRAM_TOKEN=1' }).startsWith('★'), true);
check('swagger 文档', recon.classify({ url: 'http://a/swagger-ui.html', status: 200, body: '' }).startsWith('★'), true);
check('登录页', recon.classify({ url: 'http://a/admin.php', status: 200, body: '<form><input type="password" name="pw">' }), '登录页');
check('需鉴权', recon.classify({ url: 'http://a/admin', status: 401, body: '' }), '存在但需鉴权');
check('404 不感兴趣', recon.classify({ url: 'http://a/nope', status: 404, body: '' }), '');

// 7. 字典规模（保证不是空壳）
check('后台路径', dict.ADMIN_PATHS.length > 15, true);
check('敏感文件', dict.EXPOSED_PATHS.length > 15, true);
check('弱口令', dict.WEAK_PASSWORDS.length > 30, true);
check('SQL 注入载荷', dict.SQLI_PAYLOADS.length > 8, true);
check('查询接口路径', dict.QUERY_API_PATHS.length > 8, true);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
