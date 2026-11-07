'use strict';

// 验证 Telegram 模块可用性 + 机器人回复的字段解析
const tg = require('./src/core/telegram');
const { parseField, matchesType } = require('./src/scanners/tg-lookup');
const TgLookupScanner = require('./src/scanners/tg-lookup');

console.log('GramJS 可用:', tg.isAvailable());

const reply = [
  '查询结果：',
  '姓名：张三',
  '身份证号：440524199001011234',
  '户籍地址：广东省汕头市金平区金砂街道123号',
  '手机：13800138000',
].join('\n');

const rules = {
  name: { regex: '姓名[:：]\\s*([^\\s\\n]+)' },
  idcard: { regex: '(?:身份证号?|证件号)[:：]\\s*([0-9Xx]{15,18})' },
  address: { regex: '(?:住址|户籍地址?|地址)[:：]\\s*([^\\n]+)' },
  phone: { regex: '(?:手机|电话)[:：]\\s*([0-9]{7,15})' },
};

for (const [k, rule] of Object.entries(rules)) {
  console.log('  ' + k + ' =>', JSON.stringify(parseField(reply, rule)));
}

const scanner = new TgLookupScanner();
console.log('canHandle(未配置 sessionString，应 false):', scanner.canHandle('13800138000'));
console.log('matchesType name/张三:', matchesType('name', '张三'));
console.log('matchesType phone/13800138000:', matchesType('phone', '13800138000'));
console.log('matchesType idcard/440524199001011234:', matchesType('idcard', '440524199001011234'));
