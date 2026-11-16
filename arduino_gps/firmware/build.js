// Build firmware ทั้ง 3 เวอร์ชัน + เซ็นลายเซ็น -> firmware/dist/ (นำเข้าได้จากหน้า /admin หรือ Postman ข้อ 3.2)
// ใช้: node firmware/build.js            (build ทุกเวอร์ชัน)
//      node firmware/build.js 1.1.0      (build เฉพาะเวอร์ชันที่ระบุ)
// ต้องมี arduino-cli (มากับ Arduino IDE 2) และ private key จาก delivery-server (npm run keygen)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const VERSIONS = {
  '1.0.0': { major: 1, minor: 0, patch: 0 },
  '1.1.0': { major: 1, minor: 1, patch: 0 },
  '1.1.1': { major: 1, minor: 1, patch: 1 },
  '1.2.0': { major: 1, minor: 2, patch: 0 },
  '1.2.1': { major: 1, minor: 2, patch: 1 },
};
const FQBN = 'esp32:esp32:esp32:PartitionScheme=min_spiffs';

const root = path.join(__dirname, '..');
const sketch = path.join(__dirname, 'esp32_gps_box');
const dist = path.join(__dirname, 'dist');
const privateKeyFile = path.join(root, 'delivery-server', 'keys', 'firmware-signing-private.pem');

function findCli() {
  const candidates = [
    process.env.ARDUINO_CLI,
    'C:/Program Files/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe'),
    '/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || 'arduino-cli';
}

const wanted = process.argv.slice(2);
const versions = Object.keys(VERSIONS).filter((v) => !wanted.length || wanted.includes(v));
if (!versions.length) {
  console.error(`ไม่รู้จักเวอร์ชัน: ${wanted.join(', ')} (มี ${Object.keys(VERSIONS).join(', ')})`);
  process.exit(1);
}
if (!fs.existsSync(privateKeyFile)) {
  console.error(`ไม่พบ private key: ${privateKeyFile}\nรัน: cd delivery-server && npm run keygen`);
  process.exit(1);
}

const cli = findCli();
const privateKey = fs.readFileSync(privateKeyFile);
fs.mkdirSync(dist, { recursive: true });
const manifestFile = path.join(dist, 'releases.json');
const releases = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};

for (const version of versions) {
  const { major, minor, patch } = VERSIONS[version];
  const schemaVersion = minor + 1;
  const out = path.join(dist, 'build', version);
  console.log(`\n=== build v${version} (schema ${schemaVersion}) ===`);
  execFileSync(
    cli,
    // ใช้ build-path แยก ไม่ชนกับ Arduino IDE ที่อาจคอมไพล์ sketch เดียวกันอยู่
    ['compile', '-b', FQBN, '--build-property', `compiler.cpp.extra_flags=-DFW_MAJOR=${major} -DFW_MINOR=${minor} -DFW_PATCH=${patch}`,
     '--build-path', path.join(dist, 'build', `.cache-${version}`), '--output-dir', out, sketch],
    { stdio: 'inherit' }
  );

  const bin = fs.readFileSync(path.join(out, 'esp32_gps_box.ino.bin'));
  const file = path.join(dist, `esp32_gps_box-${version}.bin`);
  fs.writeFileSync(file, bin);
  // แฟลชผ่าน USB ครั้งแรกใช้ไฟล์ merged (bootloader + partition table + app)
  const merged = path.join(out, 'esp32_gps_box.ino.merged.bin');
  if (fs.existsSync(merged)) fs.copyFileSync(merged, path.join(dist, `esp32_gps_box-${version}.merged.bin`));

  const signature = crypto.sign('sha256', bin, { key: privateKey, dsaEncoding: 'der' }).toString('base64');
  releases[version] = {
    file: path.basename(file),
    schema_version: schemaVersion,
    size_bytes: bin.length,
    sha256: crypto.createHash('sha256').update(bin).digest('hex'),
    signature,
  };
  console.log(`-> ${file} (${bin.length} bytes)`);
}

fs.writeFileSync(manifestFile, JSON.stringify(releases, null, 2));

console.log(`\nเสร็จ: ${manifestFile}`);
for (const [v, r] of Object.entries(releases)) console.log(`  v${v}  ${r.file}  ${r.size_bytes} bytes  sha256=${r.sha256.slice(0, 16)}...`);
