'use strict';

// 登录态获取：非公开数据通常需要先登录。配置 login 后自动换取凭据，
// 供 custom-auth 抓取时注入，省去手动粘贴 Cookie。

const config = require('./config');

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(t));
  });
}

function pickByPath(obj, path) {
  if (!path) return null;
  const val = String(path).split('.').reduce((o, k) => (o == null ? null : o[k]), obj);
  return val == null ? null : String(val);
}

async function getCredential() {
  const login = config.login || {};
  if (!login.enabled) return null;

  // 直接配置静态凭据
  if (login.staticCookie || login.staticToken) {
    return { cookie: login.staticCookie || '', token: login.staticToken || '' };
  }
  if (!login.url) return null;

  const headers = { 'User-Agent': config.userAgent || 'Mozilla/5.0' };
  const opts = { method: (login.method || 'POST').toUpperCase(), headers, redirect: 'follow' };
  if (login.contentType === 'form') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(login.body || {}).toString();
  } else {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(login.body || {});
  }

  const resp = await withTimeout(fetch(login.url, opts), login.timeout || 15000);

  // 优先从 Set-Cookie 响应头取
  let cookie = '';
  const setCookie = resp.headers && resp.headers.get ? resp.headers.get('set-cookie') : null;
  if (setCookie) {
    cookie = String(setCookie).split(';')[0];
  }

  let token = '';
  const text = await resp.text();
  if (login.tokenPath || login.cookiePath) {
    try {
      const j = JSON.parse(text);
      if (login.tokenPath) token = pickByPath(j, login.tokenPath) || '';
      if (login.cookiePath && !cookie) cookie = pickByPath(j, login.cookiePath) || '';
    } catch (e) { /* 非 JSON 响应则忽略 */ }
  }

  return { cookie, token };
}

module.exports = { getCredential, pickByPath };
