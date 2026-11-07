'use strict';

// 验证各查询服务的字段提取（单路径 / 多字段拼接）
const { extractField } = require('./src/scanners/people-lookup');

const whitepages = [{ name: 'John Smith', current_addresses: [{ address: '123 Main St, New York, NY 10001' }] }];
const tdg = {
  Name: { FName: 'Tom', LName: 'Smith' },
  Address: { House: '123', Street: 'Main', StrType: 'St.', City: 'Anytown', State: 'FL', Zip: '34786' },
};
const dehashed = { entries: [{ name: '张三', address: '广东省汕头市金平区金砂街道123号', phone: '13800138000' }] };

const checks = [
  ['whitepages name', whitepages, { path: '0.name' }, 'John Smith'],
  ['whitepages address', whitepages, { path: '0.current_addresses.0.address' }, '123 Main St, New York, NY 10001'],
  ['thedatagroup name', tdg, { combine: ['Name.FName', 'Name.LName'] }, 'Tom Smith'],
  ['thedatagroup address', tdg, { combine: ['Address.House', 'Address.Street', 'Address.StrType', 'Address.City', 'Address.State', 'Address.Zip'] }, '123 Main St. Anytown FL 34786'],
  ['dehashed name', dehashed, { path: 'entries.0.name' }, '张三'],
  ['dehashed address', dehashed, { path: 'entries.0.address' }, '广东省汕头市金平区金砂街道123号'],
];

let pass = 0;
let fail = 0;
for (const [name, json, spec, expect] of checks) {
  const got = extractField(json, spec);
  const ok = got === expect;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' => ' + JSON.stringify(got) + (ok ? '' : ' (期望 ' + JSON.stringify(expect) + ')'));
  ok ? pass++ : fail++;
}
console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
