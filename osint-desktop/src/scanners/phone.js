'use strict';

const Scanner = require('./base');
const fs = require('fs');
const path = require('path');

// 基于 xluohome/phonedata 的 phone.dat 格式自行解析（离线、最新数据）
// 头部: [0..4)=版本(4字节字符串), [4..8)=索引区偏移(firstoffset)
// 索引区: 每条 9 字节 = 前缀(4) + 记录偏移(4) + 运营商类型(1)
// 数据区: 每条记录以 '\0' 结尾，字段以 '|' 分隔: 省份|城市|邮编|区号
const DAT_PATH = path.join(__dirname, '..', '..', 'data', 'phone.dat');

const CARD_TYPE = {
  1: '中国移动',
  2: '中国联通',
  3: '中国电信',
  4: '中国电信虚拟运营商',
  5: '中国联通虚拟运营商',
  6: '中国移动虚拟运营商',
  7: '中国广电',
  8: '中国广电虚拟运营商',
};

let buf = null;
let firstOffset = 0;

function load() {
  if (buf) return;
  buf = fs.readFileSync(DAT_PATH);
  firstOffset = buf.readInt32LE(4);
}

function find(phoneNum) {
  load();
  const prefix = parseInt((phoneNum + '').substring(0, 7), 10);
  if (isNaN(prefix)) return null;
  const total = buf.length;
  const count = Math.floor((total - firstOffset) / 9);
  let left = 0;
  let right = count - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const offset = firstOffset + mid * 9;
    const curPhone = buf.readInt32LE(offset);
    if (curPhone > prefix) {
      right = mid - 1;
    } else if (curPhone < prefix) {
      left = mid + 1;
    } else {
      const recordOffset = buf.readInt32LE(offset + 4);
      const cardType = buf[offset + 8];
      const endIdx = buf.indexOf(0, recordOffset);
      const sliceEnd = endIdx === -1 ? total : endIdx;
      const data = buf.toString('utf8', recordOffset, sliceEnd).split('|');
      return {
        phone: phoneNum,
        province: data[0] || '',
        city: data[1] || '',
        zipcode: data[2] || '',
        areacode: data[3] || '',
        cardType: CARD_TYPE[cardType] || '未知',
      };
    }
  }
  return null;
}

class PhoneScanner extends Scanner {
  constructor() {
    super('phone');
  }

  canHandle(input) {
    const v = (input || '').trim();
    return /^1[3-9]\d{9}$/.test(v);
  }

  async scan(input) {
    const r = find(input.trim());
    if (!r) {
      return { source: 'phone', error: '未查询到该号段归属地', data: null };
    }
    return {
      source: 'phone',
      data: {
        phone: r.phone,
        operator: r.cardType,
        province: r.province,
        city: r.city,
        zipcode: r.zipcode,
        areacode: r.areacode,
      },
    };
  }
}

module.exports = PhoneScanner;
