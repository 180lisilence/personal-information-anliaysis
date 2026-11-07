'use strict';

// 标准档案构建：把各数据源抓到的字段，按别名映射归集为
// 姓名 / 户籍或生活住址 / 电话号 / 身份证号 四个核心字段。
// 街道一级地址无法从身份证或公开数据推导，必须由 targets 配置的非公开源提供。

const config = require('./config');

const DEFAULT_MAP = {
  name: ['姓名', '名字', 'name', 'realName', 'real_name', 'userName'],
  address: ['住址', '地址', '户籍地址', '生活住址', '详细地址', 'address', 'addr', 'domicile'],
  phone: ['电话', '手机号', '手机', '电话号', 'phone', 'mobile', 'tel'],
  idcard: ['身份证', '身份证号', '证件号', 'idcard', 'idCard', 'idNo', 'id_number'],
};

function pick(attrs, aliases) {
  if (!attrs) return null;
  const keys = Object.keys(attrs);
  const lower = (s) => String(s).toLowerCase();
  // 精确匹配优先
  for (const a of aliases) {
    const hit = keys.find((k) => lower(k) === lower(a));
    if (hit && attrs[hit] != null && String(attrs[hit]).trim() !== '') return String(attrs[hit]);
  }
  // 其次包含匹配
  for (const a of aliases) {
    const hit = keys.find((k) => lower(k).includes(lower(a)));
    if (hit && attrs[hit] != null && String(attrs[hit]).trim() !== '') return String(attrs[hit]);
  }
  return null;
}

function buildProfile(attrs, input) {
  const map = Object.assign({}, DEFAULT_MAP, config.profileMap || {});
  const out = { name: null, address: null, phone: null, idcard: null };
  for (const std of Object.keys(out)) {
    out[std] = pick(attrs, map[std] || []);
  }

  // 输入本身就是手机号 / 身份证号时直接补位
  const v = String(input || '').trim();
  if (/^1[3-9]\d{9}$/.test(v) && !out.phone) out.phone = v;
  if (/^\d{17}[\dXx]$/.test(v) && !out.idcard) out.idcard = v.toUpperCase();

  // 住址兜底：身份证只能解析到区县，街道需非公开源补充
  if (!out.address && attrs && attrs.province && attrs.city) {
    out.address = attrs.province + (attrs.city || '') + '（户籍区县，街道级需非公开源）';
  }
  return out;
}

module.exports = { buildProfile, pick };
