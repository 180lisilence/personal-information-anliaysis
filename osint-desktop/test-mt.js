'use strict';

// my.telegram.org 凭据申请模块的离线逻辑测试（不发真实请求）

const mt = require('./src/core/mytelegram');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + label + ' => ' + JSON.stringify(actual) + (ok ? '' : ' (期望 ' + JSON.stringify(expected) + ')'));
  ok ? pass++ : fail++;
}

// 1. 手机号规范化
// 未带 + 时无法推断国家码，只做原样补号（因此 UI 要求填完整国际格式）
check('phone 补加号', mt.normalizePhone('13800138000'), '+13800138000');
check('phone 带国家码', mt.normalizePhone('+8613800138000'), '+8613800138000');
check('phone 去空格括号', mt.normalizePhone('+86 138 0013 8000'), '+8613800138000');
check('phone 去前导 0', mt.normalizePhone('008613800138000'), '+8613800138000');
try {
  mt.normalizePhone('');
  console.log('FAIL 空手机号应抛错'); fail++;
} catch (e) { console.log('PASS 空手机号抛错 => ' + e.message); pass++; }

// 2. 从 /apps 页面抠凭据
const appsHtml = `
<html><body><script>
var apps = [
  {"app_id":1,"app_title":"My OSINT","app_shortname":"myosint","api_id":12345678,"api_hash":"0123456789abcdef0123456789abcdef","app_platform":"desktop"},
  {"app_id":2,"app_title":"Backup","app_shortname":"backup","api_id":87654321,"api_hash":"fedcba9876543210fedcba9876543210","app_platform":"web"}
];
</script></body></html>`;
const apps = mt.parseApps(appsHtml);
check('解析出应用数', apps.length, 2);
check('第一个 apiId', apps[0].apiId, '12345678');
check('第一个 apiHash', apps[0].apiHash, '0123456789abcdef0123456789abcdef');
check('第一个 title', apps[0].title, 'My OSINT');
check('第二个 apiId', apps[1].apiId, '87654321');

// 3. api_id 为字符串数字的情况
const apps2 = mt.parseApps('<div data-app=\'{"api_id":"11111","api_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}\'></div>');
check('字符串型 api_id', apps2.length ? apps2[0].apiId : null, '11111');

// 4. 无凭据页面不应误判
check('空页面', mt.parseApps('<html>请登录</html>').length, 0);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
