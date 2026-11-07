'use strict';

// 运行时配置中心。
// 打包后 config.json 在 app.asar 内（只读），所以用户改动统一写到 userData/config.json，
// 启动时与内置默认配置深合并。所有模块 require 本模块拿到的都是同一个对象引用，
// update() 会就地替换字段，因此改配置后无需重启进程。

const fs = require('fs');
const path = require('path');

const defaults = require('../../config.json');

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  if (!isObj(patch)) return patch === undefined ? base : patch;
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    if (isObj(pv) && isObj(out[k])) out[k] = deepMerge(out[k], pv);
    else out[k] = pv;
  }
  return out;
}

// userData 目录：Electron 主进程可拿到；纯 node 运行时退到项目根下的 .userdata
function resolveUserDir() {
  try {
    const e = require('electron');
    if (e && typeof e === 'object' && e.app && typeof e.app.getPath === 'function') {
      return e.app.getPath('userData');
    }
  } catch (err) { /* 非 Electron 环境 */ }
  return path.join(__dirname, '..', '..', '.userdata');
}

const USER_DIR = resolveUserDir();
const USER_FILE = path.join(USER_DIR, 'config.json');

function loadOverride() {
  try {
    if (fs.existsSync(USER_FILE)) return JSON.parse(fs.readFileSync(USER_FILE, 'utf8'));
  } catch (e) {
    console.error('[config] 读取用户配置失败:', e.message);
  }
  return {};
}

const config = JSON.parse(JSON.stringify(deepMerge(defaults, loadOverride())));

function save() {
  try {
    fs.mkdirSync(USER_DIR, { recursive: true });
    fs.writeFileSync(USER_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[config] 保存失败:', e.message);
    return false;
  }
}

function update(patch) {
  const merged = deepMerge(JSON.parse(JSON.stringify(config)), patch || {});
  // 就地替换，保证各模块 const config = require(...) 持有的引用同步生效
  for (const k of Object.keys(config)) delete config[k];
  Object.assign(config, merged);
  return save();
}

function reset() {
  const fresh = JSON.parse(JSON.stringify(defaults));
  for (const k of Object.keys(config)) delete config[k];
  Object.assign(config, fresh);
  try { if (fs.existsSync(USER_FILE)) fs.unlinkSync(USER_FILE); } catch (e) { /* ignore */ }
  return true;
}

Object.defineProperties(config, {
  __save: { value: save, enumerable: false },
  __update: { value: update, enumerable: false },
  __reset: { value: reset, enumerable: false },
  __userFile: { value: USER_FILE, enumerable: false },
  __userDir: { value: USER_DIR, enumerable: false },
});

module.exports = config;
