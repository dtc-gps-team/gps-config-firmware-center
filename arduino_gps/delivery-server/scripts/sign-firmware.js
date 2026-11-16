// เซ็นไฟล์ firmware .bin -> พิมพ์ลายเซ็น base64 (ใส่ใน header X-Firmware-Signature ตอนอัปโหลด)
// ใช้: npm run sign -- path/to/firmware.bin [path/to/private.pem]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [binFile, keyFile = path.join(__dirname, '..', 'keys', 'firmware-signing-private.pem')] = process.argv.slice(2);
if (!binFile) {
  console.error('ใช้: npm run sign -- <firmware.bin> [private.pem]');
  process.exit(1);
}

const data = fs.readFileSync(binFile);
const signature = crypto.sign('sha256', data, { key: fs.readFileSync(keyFile), dsaEncoding: 'der' });

console.log(`file   : ${binFile}`);
console.log(`size   : ${data.length} bytes`);
console.log(`sha256 : ${crypto.createHash('sha256').update(data).digest('hex')}`);
console.log(`signature (base64):\n${signature.toString('base64')}`);
