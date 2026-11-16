const express = require('express');
const { deviceAuth } = require('../auth');

module.exports = function deviceRoutes({ store, commands, autoRegister }) {
  const r = express.Router();
  r.use(deviceAuth(store, autoRegister));

  // กู้คำสั่งที่ค้างหลัง offline/reconnect (ทางเลือกแทนการรอรับผ่าน WebSocket)
  r.get('/pending-commands', (req, res) => {
    const list = commands.activeFor(req.device.device_id);
    for (const cmd of list) commands.markDelivered(cmd);
    store.save();
    res.json(list.map((c) => commands.message(c)));
  });

  return r;
};
