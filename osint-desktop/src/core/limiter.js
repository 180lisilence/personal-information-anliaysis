'use strict';

// 速率控制：令牌桶实现，按 config.json 的 rateLimit.maxPerMinute 限流
const config = require('./config');

class RateLimiter {
  constructor(maxPerMinute) {
    this.max = maxPerMinute && maxPerMinute > 0 ? maxPerMinute : 30;
    this.tokens = this.max;
    this.last = Date.now();
    this.queue = [];
  }

  acquire() {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this._drain();
    });
  }

  _drain() {
    const now = Date.now();
    const elapsed = now - this.last;
    if (elapsed >= 1000) {
      // 每秒重置令牌
      this.tokens = this.max;
      this.last = now;
    }
    while (this.queue.length > 0 && this.tokens > 0) {
      this.tokens -= 1;
      const resolve = this.queue.shift();
      resolve();
    }
    if (this.queue.length > 0) {
      const wait = Math.max(10, 1000 - (Date.now() - this.last));
      setTimeout(() => this._drain(), wait);
    }
  }
}

const limiter = new RateLimiter(config.rateLimit && config.rateLimit.maxPerMinute);

module.exports = { RateLimiter, limiter };
