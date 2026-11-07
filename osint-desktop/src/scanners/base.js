'use strict';

// Scanner 基类：所有数据源插件统一实现 canHandle + scan。
class Scanner {
  constructor(name) {
    this.name = name;
  }

  // 返回 true 表示本插件能处理该输入
  canHandle(/* input */) {
    return false;
  }

  // 返回结构: { source: string, valid?: boolean, data: object, meta?: object }
  async scan(/* input */) {
    return { source: this.name, data: null };
  }
}

module.exports = Scanner;
