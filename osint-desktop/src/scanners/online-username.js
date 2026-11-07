'use strict';

const Scanner = require('./base');
const config = require('../core/config');
const { limiter } = require('../core/limiter');

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(t));
  });
}

async function searchDork(query, engine) {
  let url;
  if (engine === 'baidu') {
    url = 'https://www.baidu.com/s?wd=' + encodeURIComponent(query);
  } else {
    url = 'https://www.bing.com/search?q=' + encodeURIComponent(query);
  }
  const resp = await fetch(url, {
    headers: { 'User-Agent': config.userAgent || 'Mozilla/5.0' },
    redirect: 'follow',
  });
  const html = await resp.text();
  const results = [];
  const re = /<li class="b_algo">[\s\S]*?<h2>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && results.length < 12) {
    results.push({
      url: m[1],
      title: m[2].replace(/<[^>]+>/g, '').trim(),
    });
  }
  return results;
}

class OnlineUsernameScanner extends Scanner {
  constructor() {
    super('online-username');
  }

  canHandle(input) {
    const v = (input || '').trim();
    // 邮箱，或以字母开头的用户名；纯数字交给 phone/idcard 处理
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return true;
    if (/^[a-zA-Z][a-zA-Z0-9._-]{1,39}$/.test(v)) return true;
    return false;
  }

  async scan(input) {
    const q = (input || '').trim();
    const query = '"' + q + '"';
    const engines = ['bing', 'baidu'];
    const out = { query: q, engineResults: {} };
    let anyErr = null;
    for (const eng of engines) {
      try {
        await limiter.acquire(); // 速率控制
        const hits = await withTimeout(searchDork(query, eng), 9000);
        out.engineResults[eng] = { count: hits.length, hits };
      } catch (e) {
        out.engineResults[eng] = { error: e.message };
        anyErr = anyErr || e.message;
      }
    }
    return { source: 'online-username', data: out, error: anyErr };
  }
}

module.exports = OnlineUsernameScanner;
