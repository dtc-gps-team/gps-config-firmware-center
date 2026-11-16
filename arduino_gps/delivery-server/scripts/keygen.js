// สร้างคู่กุญแจ ECDSA P-256 สำหรับเซ็น firmware
// - private key: เก็บไว้ที่เครื่องที่ใช้เซ็น (ห้ามขึ้น server / ห้าม commit)
// - public key : ให้ delivery-server ใช้ตรวจตอนอัปโหลด และฝังไว้ใน firmware ESP32
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = path.join(__dirname, '..', 'keys');
const privFile = path.join(dir, 'firmware-signing-private.pem');
const pubFile = path.join(dir, 'firmware-signing-public.pem');

if (fs.existsSync(privFile) && !process.argv.includes('--force')) {
  console.error(`มีกุญแจอยู่แล้ว: ${privFile}\nถ้าต้องการสร้างใหม่จริง ๆ ใช้ --force (firmware ที่เซ็นด้วยกุญแจเดิมจะตรวจไม่ผ่าน)`);
  process.exit(1);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(privFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(pubFile, publicKey.export({ type: 'spki', format: 'pem' }));

console.log(`สร้างแล้ว:\n  ${privFile}\n  ${pubFile}\n`);
console.log('Public key (ฝังใน firmware ESP32):\n');
console.log(fs.readFileSync(pubFile, 'utf8'));
