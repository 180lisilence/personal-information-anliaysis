'use strict';

const PhoneScanner = require('./src/scanners/phone');
const IDCardScanner = require('./src/scanners/idcard');

(async () => {
  const p = new PhoneScanner();
  console.log('=== phone canHandle(13800138000):', p.canHandle('13800138000'));
  console.log('=== phone scan 13800138000 ===');
  console.log(JSON.stringify(await p.scan('13800138000'), null, 2));

  const id = new IDCardScanner();
  const samples = ['11010519491231002X', '440524188001010014', '50010319900307657X'];
  for (const s of samples) {
    console.log('=== idcard scan', s, '===');
    console.log(JSON.stringify(await id.scan(s), null, 2));
  }
})();
