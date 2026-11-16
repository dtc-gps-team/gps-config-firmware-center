const { WebSocketServer } = require('ws');
const { bearer, deviceIdHeader, findDevice } = require('./auth');

const WS_PATH = '/ws/device';
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function reject(socket, code, text) {
  socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function checkHello(m) {
  const errors = [];
  if (typeof m.hardware_model !== 'string' || !m.hardware_model) errors.push('hardware_model');
  if (!SEMVER_RE.test(m.firmware_version || '')) errors.push('firmware_version');
  if (!Number.isInteger(m.schema_version) || m.schema_version < 1) errors.push('schema_version');
  if (!Number.isInteger(m.config_version) || m.config_version < 0) errors.push('config_version');
  if (typeof m.boot_id !== 'string' || !m.boot_id || m.boot_id.length > 64) errors.push('boot_id');
  return errors;
}

function attachWebSocket(server, { store, commands, connections, cfg, autoRegister }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: cfg.maxMessageBytes });

  // ตรวจ token ตั้งแต่ตอน upgrade — ไม่มี token ถูกต้อง = ไม่ได้เปิด socket
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname !== WS_PATH) return reject(socket, 404, 'Not Found');
    const device = findDevice(store, bearer(req), deviceIdHeader(req), autoRegister);
    if (!device) return reject(socket, 401, 'Unauthorized');
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, device, req));
  });

  function send(ws, obj) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }

  function touch(device) {
    device.last_seen_at = new Date().toISOString();
  }

  function onConnection(ws, device, req) {
    const id = device.device_id;
    const old = connections.get(id);
    if (old) old.close(4000, 'replaced by new connection');
    connections.set(id, ws);

    ws.isAlive = true;
    ws.helloDone = false;
    ws.hello = null;
    touch(device);
    store.save();
    console.log(`[ws] ${id} connected from ${req.socket.remoteAddress}`);

    ws.on('pong', () => {
      ws.isAlive = true;
      touch(device);
    });

    ws.on('message', (raw, isBinary) => {
      ws.isAlive = true;
      touch(device);
      let msg;
      try {
        if (isBinary) throw new Error('binary');
        msg = JSON.parse(raw.toString('utf8'));
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new Error('not object');
      } catch {
        return send(ws, { type: 'ERROR', error: 'INVALID_JSON' });
      }

      // device_id ใน message ต้องตรงกับ identity ที่ authenticate แล้ว
      if (msg.device_id !== undefined && msg.device_id !== id) {
        return send(ws, { type: 'ERROR', error: 'DEVICE_ID_MISMATCH' });
      }

      if (msg.type === 'HELLO') return onHello(ws, device, msg);
      if (!ws.helloDone) return send(ws, { type: 'ERROR', error: 'HELLO_REQUIRED' });

      switch (msg.type) {
        case 'HEARTBEAT':
          device.last_status = msg.status && typeof msg.status === 'object' ? msg.status : null;
          store.save();
          return send(ws, { type: 'HEARTBEAT_ACK', server_time: new Date().toISOString() });

        case 'COMMAND_STATUS': {
          const result = commands.applyStatus(id, msg, ws.hello);
          if (result.error) {
            return send(ws, { type: 'ERROR', error: result.error, message: result.message, command_id: msg.command_id ?? null });
          }
          console.log(`[ws] ${id} ${result.cmd.command_id} -> ${result.cmd.status}${result.duplicate ? ' (duplicate)' : ''}`);
          return send(ws, { type: 'STATUS_ACK', command_id: result.cmd.command_id, status: result.cmd.status, duplicate: !!result.duplicate });
        }

        default:
          return send(ws, { type: 'ERROR', error: 'UNKNOWN_TYPE' });
      }
    });

    ws.on('close', (code) => {
      // ถูกแทนด้วย connection ใหม่ (4000) จะไม่ใช่ตัวปัจจุบันแล้ว -> ไม่นับว่าหลุด
      if (connections.get(id) === ws) {
        connections.delete(id);
        device.disconnected_at = new Date().toISOString();
      }
      touch(device);
      store.save();
      console.log(`[ws] ${id} disconnected (${code})`);
    });

    ws.on('error', (err) => console.warn(`[ws] ${id} error: ${err.message}`));
  }

  function onHello(ws, device, msg) {
    const errors = checkHello(msg);
    if (errors.length) return send(ws, { type: 'ERROR', error: 'INVALID_HELLO', fields: errors });

    ws.hello = {
      hardware_model: msg.hardware_model,
      firmware_version: msg.firmware_version,
      schema_version: msg.schema_version,
      config_version: msg.config_version,
      boot_id: msg.boot_id,
    };
    ws.helloDone = true;
    ws.helloAt = Date.now();
    Object.assign(device, {
      hardware_model: msg.hardware_model,
      firmware_version_reported: msg.firmware_version,
      schema_version_reported: msg.schema_version,
      config_version_reported: msg.config_version,
      boot_id: msg.boot_id,
    });
    delete device.disconnected_at;
    store.save();

    const pending = commands.activeFor(device.device_id);
    send(ws, {
      type: 'WELCOME',
      device_id: device.device_id,
      server_time: new Date().toISOString(),
      heartbeat_interval_sec: cfg.heartbeatIntervalSec,
      pending_commands: pending.length,
    });
    // ส่งคำสั่งที่ค้าง (offline reconciliation)
    commands.deliverPending(device.device_id);
  }

  // ws ping เพื่อตัด connection ที่ตายแล้ว
  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, cfg.heartbeatIntervalSec * 1000);
  wss.on('close', () => clearInterval(pingTimer));

  return wss;
}

module.exports = { attachWebSocket, WS_PATH };
