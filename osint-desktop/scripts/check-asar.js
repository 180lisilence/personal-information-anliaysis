const asar = require('../node_modules/@electron/asar');
const files = asar.listPackage(require('path').join(__dirname, '../dist/win-unpacked/resources/app.asar'));
const norm = files.map(f => f.replace(/^\\/, '').replace(/\\/g, '/'));
const core = [
  'src/core/telegram.js',
  'src/core/mytelegram.js',
  'src/core/net.js',
  'src/core/breach.js',
  'src/core/recon.js',
  'src/core/dict.js',
  'src/core/autopwn.js',
  'src/core/connect.js',
  'src/core/discover.js',
  'src/core/config.js',
  'src/scanners/tg-lookup.js',
  'src/scanners/people-lookup.js',
  'src/scanners/custom-auth.js',
  'src/scanners/online-phone.js',
  'src/core/profile.js',
  'src/core/session.js',
  'src/scanners/phone.js',
  'src/scanners/idcard.js',
  'config.json',
  'data/phone.dat',
  'package.json',
  'server/index.js',
  'electron/main.js',
  'renderer/index.html'
];
core.forEach(c => console.log((norm.includes(c) ? 'OK  ' : 'MISS') + '  ' + c));
console.log('---- 总文件数:', files.length);
