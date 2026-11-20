// Meitrack TA255 (อ้างอิง TA255 GPRS Protocol V1.0, 2022-09-21) — แยก frame, checksum, สร้างคำสั่ง, แปลงแพ็กเก็ต CCE
'use strict';

// Checksum: sum of every byte from "@@"/"$$" up to and including "*", low byte, 2 uppercase hex chars
function checksum(buf) {
  let sum = 0;
  for (const b of buf) sum = (sum + b) & 0xff;
  return sum.toString(16).toUpperCase().padStart(2, '0');
}

// Build server -> tracker command: @@<id><len>,<IMEI>,<cmd>[,<content>]*<CS>\r\n
// len = bytes from the first "," to "\r\n" inclusive
function buildCommand(identifier, imei, command) {
  const tail = `,${imei},${command}*`;
  const len = Buffer.byteLength(tail) + 2 /* CS */ + 2; /* \r\n */
  const head = `@@${identifier}${len}`;
  const cs = checksum(Buffer.from(head + tail, 'latin1'));
  return Buffer.from(`${head}${tail}${cs}\r\n`, 'latin1');
}

// Pull complete frames out of a TCP stream buffer. Frames are delimited by the length field,
// NOT by \r\n, because CCE packets are binary and may contain 0x0D 0x0A inside.
function extractFrames(buffer) {
  const frames = [];
  const junk = [];
  let pos = 0;
  while (true) {
    const start = buffer.indexOf('$$', pos, 'latin1');
    if (start < 0) {
      if (buffer.length - pos > 1) junk.push(buffer.subarray(pos, buffer.length - 1));
      pos = Math.max(pos, buffer.length - 1);
      break;
    }
    if (start > pos) junk.push(buffer.subarray(pos, start));
    // $$ + identifier + decimal length + ","
    let i = start + 3;
    let digits = '';
    while (i < buffer.length && buffer[i] >= 0x30 && buffer[i] <= 0x39 && digits.length < 6) {
      digits += String.fromCharCode(buffer[i]);
      i++;
    }
    if (i >= buffer.length) { pos = start; break; } // need more data
    if (!digits || buffer[i] !== 0x2c) { pos = start + 2; continue; } // not a real header, resync
    const total = i - start + Number(digits);
    if (buffer.length < start + total) { pos = start; break; } // incomplete frame
    frames.push(buffer.subarray(start, start + total));
    pos = start + total;
  }
  return { frames, junk, rest: buffer.subarray(pos) };
}

// Parse one $$ frame (header + checksum check). CCE body is parsed separately.
function parseFrame(frame) {
  const s = frame.toString('latin1');
  const identifier = s[2];
  const c1 = s.indexOf(',');
  const c2 = s.indexOf(',', c1 + 1);
  const c3 = s.indexOf(',', c2 + 1);
  const imei = s.slice(c1 + 1, c2);
  const type = s.slice(c2 + 1, c3 < 0 ? undefined : c3);
  const star = frame.lastIndexOf(0x2a); // '*'
  const csGot = s.slice(star + 1, star + 3);
  const csWant = checksum(frame.subarray(0, star + 1));
  const endsOk = frame[frame.length - 2] === 0x0d && frame[frame.length - 1] === 0x0a;
  const body = c3 < 0 ? Buffer.alloc(0) : frame.subarray(c3 + 1, star);
  return {
    identifier, imei, type, body,
    checksumOk: csGot.toUpperCase() === csWant && endsOk,
    checksumGot: csGot, checksumWant: csWant,
  };
}

// --- CCE binary data packets -------------------------------------------------
const Y2000 = Date.UTC(2000, 0, 1);
const NAMES = {
  0x05: 'gpsValid', 0x06: 'satellites', 0x07: 'gsmSignal', 0x14: 'outputs', 0x15: 'inputs',
  0x1b: 'geofenceNo', 0x27: 'tempSensorNo',
  0x08: 'speedKmh', 0x09: 'direction', 0x0a: 'hdop', 0x0b: 'altitudeM', 0x16: 'ad1V', 0x1a: 'externalPowerV',
  0x29: 'fuelPct', 0x40: 'eventCode',
  0x02: 'lat', 0x03: 'lng', 0x04: 'time', 0x0c: 'mileageM', 0x0d: 'runTimeSec', 0x1c: 'systemFlag', 0x25: 'iButtonId',
  0x0e: 'baseStation', 0x4b: 'network', 0xfea8: 'battery', 0xfea5: 'sensor',
};
const EVENTS = {
  1: 'Input 1 Active (Ignition On)', 9: 'Input 1 Inactive (Ignition Off)', 18: 'Low External Battery',
  19: 'Speeding', 20: 'Enter Geo-fence', 21: 'Exit Geo-fence', 22: 'External Battery On', 23: 'External Battery Cut',
  24: 'GPS Signal Lost', 25: 'GPS Signal Recovery', 26: 'Enter Sleep', 27: 'Exit Sleep', 29: 'Device Reboot',
  31: 'Heartbeat', 32: 'Cornering', 33: 'Track By Distance', 34: 'Reply Current (Passive)', 35: 'Track By Time Interval',
  36: 'Tow', 40: 'Power Off', 41: 'Stop Moving', 42: 'Start Moving', 78: 'Impact', 80: 'Install (ติดตั้งกลับ)',
  81: 'Drop Off (กล่องถูกถอด)', 129: 'Harsh Braking',
  130: 'Harsh Acceleration', 133: 'Idle Overtime', 134: 'Idle Recovery', 135: 'Fatigue Driving',
};

function readId(b, o) {
  // ids 0xFExx are 2 bytes (e.g. 0xFE70, 0xFEA8)
  if (b[o] === 0xfe) return { id: 0xfe00 | b[o + 1], o: o + 2 };
  return { id: b[o], o: o + 1 };
}

function convert(id, raw, size) {
  switch (id) {
    case 0x02: case 0x03: return raw.readInt32LE(0) / 1e6;
    case 0x04: return new Date(Y2000 + raw.readUInt32LE(0) * 1000).toISOString();
    case 0x0a: return raw.readUInt16LE(0) / 10;
    case 0x0b: return raw.readInt16LE(0);
    case 0x16: case 0x1a: return raw.readUInt16LE(0) / 100;
    case 0x29: return raw.readUInt16LE(0) / 100;
    case 0x0e: {
      if (raw.length < 12) return raw.toString('hex');
      return { mcc: raw.readUInt16LE(0), mnc: raw.readUInt16LE(2), lac: raw.readUInt16LE(4), cellId: raw.readUInt32LE(6), rxLevel: raw.readInt16LE(10) };
    }
    default:
      if (size === 1) return raw[0];
      if (size === 2) return raw.readUInt16LE(0);
      if (size === 4) return raw.readUInt32LE(0);
      return raw.toString('hex');
  }
}

function parseCCE(body) {
  let o = 0;
  const remainingCache = body.readUInt32LE(o); o += 4;
  const packetCount = body.readUInt16LE(o); o += 2;
  const packets = [];
  for (let p = 0; p < packetCount && o < body.length; p++) {
    const pktLen = body.readUInt16LE(o); o += 2;
    const end = o + pktLen;
    o += 2; // total number of ids
    const fields = {};
    for (const size of [1, 2, 4]) {
      const n = body[o]; o += 1;
      for (let k = 0; k < n; k++) {
        const r = readId(body, o); o = r.o;
        fields[NAMES[r.id] || `id_0x${r.id.toString(16)}`] = convert(r.id, body.subarray(o, o + size), size);
        o += size;
      }
    }
    const nv = body[o]; o += 1;
    for (let k = 0; k < nv && o < end; k++) {
      const r = readId(body, o); o = r.o;
      const len = body[o]; o += 1;
      fields[NAMES[r.id] || `id_0x${r.id.toString(16)}`] = convert(r.id, body.subarray(o, o + len), len);
      o += len;
    }
    if (fields.eventCode !== undefined) fields.event = EVENTS[fields.eventCode] || `event ${fields.eventCode}`;
    packets.push(fields);
    o = end;
  }
  return { remainingCache, packetCount, packets };
}

module.exports = { checksum, buildCommand, extractFrames, parseFrame, parseCCE, EVENTS };
