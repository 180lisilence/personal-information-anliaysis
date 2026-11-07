'use strict';

// Telegram MTProto 客户端封装（GramJS）。
// 用途：以账号身份向社工库机器人/群组发送查询（手机号、身份证号、姓名），
// 并读取机器人返回的查询结果。Bot API 无法做到这一点，必须用 MTProto。
//
// 额外能力：
//   startLogin()    —— 发送验证码（两步登录第一步），无需命令行
//   completeLogin() —— 用验证码（必要时云密码）完成登录并产出 sessionString
//   discover()      —— 用关键词在 Telegram 全站搜机器人/群组/频道（找源）
//   myDialogs()     —— 列出当前账号已加入的会话（找源）
//   probe()         —— 向某个机器人试发一条查询，原样返回回复（调正则用）

const config = require('./config');

let GramJS = null;
try {
  GramJS = require('telegram');
} catch (e) {
  GramJS = null;
}

function getApi() {
  // eslint-disable-next-line global-require
  return require('telegram/tl').Api;
}

function isAvailable() {
  return !!GramJS;
}

function normalizeApiId(v) {
  const n = parseInt(v, 10);
  if (!n) throw new Error('apiId 必须是数字（在 my.telegram.org 创建应用获得）');
  return n;
}

async function newClient(tg) {
  if (!GramJS) throw new Error('未安装 telegram(GramJS) 依赖');
  if (!tg.apiId || !tg.apiHash) throw new Error('缺少 apiId / apiHash');
  // eslint-disable-next-line global-require
  const { StringSession } = require('telegram/sessions');
  const params = { connectionRetries: 5 };
  // MTProxy：Telegram 专用代理协议（GramJS 只支持这一种，SOCKS5/HTTP 代理需靠系统级 VPN/TUN）
  const mp = tg.mtproxy;
  if (mp && mp.ip && mp.port) {
    params.proxy = {
      MTProxy: true,
      ip: String(mp.ip),
      port: parseInt(mp.port, 10),
      secret: mp.secret ? Buffer.from(String(mp.secret).replace(/^dd/i, ''), 'hex') : Buffer.alloc(16),
    };
  }
  const client = new GramJS.TelegramClient(
    new StringSession(tg.sessionString ? String(tg.sessionString) : ''),
    normalizeApiId(tg.apiId),
    String(tg.apiHash),
    params
  );
  await client.connect();
  return client;
}

async function createClient() {
  const tg = config.telegram || {};
  if (!tg.enabled) throw new Error('telegram.enabled=false');
  if (!tg.sessionString) throw new Error('缺少 sessionString，请在「Telegram 接入」里完成登录');
  const client = await newClient(tg);
  const ok = await client.checkAuthorization();
  if (!ok) throw new Error('sessionString 已失效，请重新登录');
  return client;
}

// ---------- 登录流程（供 UI 两步调用） ----------
let pending = null; // { client, apiId, apiHash, phoneNumber, phoneCodeHash, isCodeViaApp }

async function startLogin(opts) {
  const apiId = normalizeApiId(opts.apiId);
  const apiHash = String(opts.apiHash || '');
  const phoneNumber = String(opts.phoneNumber || '').trim();
  if (!apiHash) throw new Error('缺少 apiHash');
  if (!phoneNumber) throw new Error('缺少手机号（需带国际区号，例如 +8613800138000）');

  if (pending && pending.client) {
    try { await pending.client.disconnect(); } catch (e) { /* ignore */ }
  }
  const client = await newClient({ apiId, apiHash, sessionString: '' });
  try {
    const res = await client.sendCode({ apiId, apiHash }, phoneNumber);
    pending = {
      client,
      apiId,
      apiHash,
      phoneNumber,
      phoneCodeHash: res.phoneCodeHash,
      isCodeViaApp: !!res.isCodeViaApp,
    };
    return { phoneCodeHash: res.phoneCodeHash, isCodeViaApp: !!res.isCodeViaApp };
  } catch (e) {
    try { await client.disconnect(); } catch (err) { /* ignore */ }
    throw e;
  }
}

async function completeLogin(opts) {
  if (!pending) throw new Error('请先请求验证码');
  const { client, apiId, apiHash, phoneNumber, phoneCodeHash } = pending;
  const code = String(opts.code || '').trim();
  if (!code) throw new Error('缺少验证码');

  const Api = getApi();
  try {
    await client.invoke(new Api.auth.SignIn({ phoneNumber, phoneCodeHash, phoneCode: code }));
  } catch (e) {
    if (e && e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      const password = String(opts.password || (config.telegram && config.telegram.password) || '');
      if (!password) throw new Error('该账号开启了两步验证，请输入云密码');
      await client.signInWithPassword({ apiId, apiHash }, { password: async () => password });
    } else {
      throw e;
    }
  }

  const sessionString = client.session.save();
  const me = await client.getMe();
  // 写回配置并持久化
  config.__update({
    telegram: {
      enabled: true,
      apiId: String(apiId),
      apiHash,
      sessionString: String(sessionString),
    },
  });
  try { await client.disconnect(); } catch (e) { /* ignore */ }
  pending = null;
  return {
    sessionString: String(sessionString),
    user: me ? { id: String(me.id), username: me.username || '', firstName: me.firstName || '', phone: me.phone || '' } : null,
  };
}

function cancelLogin() {
  if (pending && pending.client) {
    try { pending.client.disconnect(); } catch (e) { /* ignore */ }
  }
  pending = null;
}

// ---------- 找源 ----------
function peerToItem(p) {
  const cls = p && p.className ? p.className : '';
  const isBot = !!p.bot;
  const title = p.title || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.username || '';
  let kind = 'user';
  if (isBot) kind = 'bot';
  else if (p.broadcast) kind = 'channel';
  else if (p.megagroup) kind = 'group';
  else if (cls.indexOf('Channel') >= 0) kind = 'channel';
  else if (cls.indexOf('Chat') >= 0) kind = 'group';
  return {
    id: p.id ? String(p.id) : '',
    username: p.username ? '@' + p.username : '',
    title: String(title || ''),
    kind,
    bot: isBot,
    participants: (p.participantsCount !== undefined && p.participantsCount !== null) ? p.participantsCount : undefined,
  };
}

// 全站搜索机器人 / 群组 / 频道
async function discover(opts) {
  const client = await createClient();
  try {
    const Api = getApi();
    const q = String(opts.keyword || '').trim();
    const limit = parseInt(opts.limit || 30, 10);
    if (!q) throw new Error('缺少关键词');
    const res = await client.invoke(new Api.contacts.Search({ q, limit }));
    const items = [];
    for (const u of (res && res.users) || []) items.push(peerToItem(u));
    for (const c of (res && res.chats) || []) items.push(peerToItem(c));
    return items;
  } finally {
    try { await client.disconnect(); } catch (e) { /* ignore */ }
  }
}

// 列出当前账号已加入的会话（群组/频道/机器人）
async function myDialogs(opts) {
  const client = await createClient();
  try {
    const limit = parseInt(opts.limit || 60, 10);
    const dialogs = await client.getDialogs({ limit });
    const items = [];
    for (const d of dialogs || []) {
      const e = d.entity;
      if (!e) continue;
      const it = peerToItem(e);
      if (d.isChannel) it.kind = e.megagroup ? 'group' : 'channel';
      else if (d.isGroup) it.kind = 'group';
      else it.kind = e.bot ? 'bot' : 'user';
      items.push(it);
    }
    return items;
  } finally {
    try { await client.disconnect(); } catch (e) { /* ignore */ }
  }
}

// 试发一条查询，原样返回机器人回复（用于调正则）
async function probe(opts) {
  const target = String(opts.target || '').trim();
  const text = String(opts.text || opts.input || '').trim();
  if (!target) throw new Error('缺少 target（机器人用户名，如 @xxxbot）');
  if (!text) throw new Error('缺少查询内容');
  const wait = parseInt(opts.waitMs || (config.telegram && config.telegram.waitMs) || 8000, 10);
  const reply = await sendQuery(target, text, wait);
  return { target, query: text, reply };
}

// 向指定目标（机器人用户名 / 群组）发送查询文本，等待并取回最新回复
async function sendQuery(target, text, waitMs) {
  const client = await createClient();
  try {
    await client.sendMessage(target, { message: text });
    const wait = waitMs || (config.telegram && config.telegram.waitMs) || 8000;
    await new Promise((r) => setTimeout(r, wait));
    const messages = await client.getMessages(target, { limit: 5 });
    // 取最新一条非自己发送的消息作为机器人回复
    const me = await client.getMe();
    const myId = me && me.id ? String(me.id) : null;
    for (const m of messages || []) {
      const senderId = m.senderId ? String(m.senderId) : null;
      if (senderId && myId && senderId === myId) continue;
      if (m.message) return String(m.message);
    }
    return null;
  } finally {
    try { await client.disconnect(); } catch (e) { /* ignore */ }
  }
}

// 导出登录所需（供 scripts/tg-login.js 使用）
function getGramJS() {
  if (!GramJS) throw new Error('未安装 telegram(GramJS) 依赖');
  return GramJS;
}

module.exports = {
  isAvailable,
  createClient,
  sendQuery,
  getGramJS,
  startLogin,
  completeLogin,
  cancelLogin,
  discover,
  myDialogs,
  probe,
};
