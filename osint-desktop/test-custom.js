'use strict';

// 验证非公开数据源的字段提取逻辑（json / regex / css）与输入类型匹配
const { extractValue, matchesType } = require('./src/scanners/custom-auth');

const cases = [
  ['json', '{"data":{"name":"张三","address":"北京市朝阳区"}}', 'json:data.name', '张三'],
  ['json-nested', '{"data":{"user":{"tel":"13800138000"}}}', 'json:data.user.tel', '13800138000'],
  ['regex', '<p>姓名：李四</p><p>电话：13800138000</p>', 'regex:姓名[:：]\\s*([^\\s<]+)', '李四'],
  ['css-class', '<div class="addr">上海市浦东新区</div>', 'css:.addr', '上海市浦东新区'],
  ['css-id', '<span id="mobile">13900139000</span>', 'css:#mobile', '13900139000'],
];

let pass = 0;
let fail = 0;
for (const [name, text, rule, expect] of cases) {
  const got = extractValue(text, rule);
  const ok = got === expect;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' => ' + JSON.stringify(got) + (ok ? '' : ' (期望 ' + JSON.stringify(expect) + ')'));
  ok ? pass++ : fail++;
}

const typeCases = [
  ['phone', '13800138000', true],
  ['phone-bad', '12345', false],
  ['idcard', '50010319900307657X', true],
  ['email', 'a@b.com', true],
  ['username', 'abc_123', true],
  ['any', 'whatever', true],
];
for (const [type, val, expect] of typeCases) {
  const got = matchesType(type, val);
  const ok = got === expect;
  console.log((ok ? 'PASS ' : 'FAIL ') + 'match ' + type + '/' + val + ' => ' + got);
  ok ? pass++ : fail++;
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
