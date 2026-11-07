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

// 搜索引擎 dork：在公开搜索结果里查找该号码被提及的网页
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
  // Bing 结果块：<li class="b_algo"> ... <h2><a href="URL">TITLE</a>
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

class OnlinePhoneScanner extends Scanner {
  constructor() {
    super('online-phone');
  }

  canHandle(input) {
    return /^1[3-9]\d{9}$/.test((input || '').trim());
  }

  async scan(input) {
    const phone = input.trim();
    const query = '"' + phone + '"';
    const engines = ['bing', 'baidu'];
    const out = { phone, engineResults: {} };
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
    return { source: 'online-phone', data: out, error: anyErr };
  }
}

module.exports = OnlinePhoneScanner;
