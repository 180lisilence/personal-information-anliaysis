'use strict';

// 验证标准档案：把各源字段归集为 姓名 / 住址 / 电话 / 身份证号
const { buildProfile } = require('./src/core/profile');

const cases = [
  ['中文键（非公开源返回）', { '姓名': '张三', '详细地址': '广东省汕头市金平区金砂街道123号', '手机': '13800138000', '身份证号': '440524199001011234' }, '13800138000'],
  ['仅有身份证解析结果', { regionCode: '500103', province: '重庆', city: '重庆市', birth: '1990-03-07' }, '50010319900307657X'],
  ['英文键', { realName: 'John', address: 'Some Street 5', mobile: '13900139000', idNo: '11010519491231002X' }, '13900139000'],
];

for (const [name, attrs, input] of cases) {
  console.log('=== ' + name + ' ===');
  console.log(JSON.stringify(buildProfile(attrs, input), null, 2));
}
