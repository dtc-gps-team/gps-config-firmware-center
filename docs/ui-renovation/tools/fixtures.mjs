// Test-only API fixtures for screenshot / animation checks (no backend needed).
// Never imported by the app. Shapes follow web/src/lib/*-api.ts.
const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();

const base = ["BB-200", "BB-200", "BB-310", "BB-310", "TK-50", "TK-50", "BB-200", "TK-50", "BB-310", "BB-200"];
// FLEET=N ขยายจำนวนอุปกรณ์จำลอง (ทดสอบกริด LED)
const fleetSize = Number(process.env.FLEET ?? base.length);
const models = Array.from({ length: fleetSize }, (_, i) => base[i % base.length]);
export const devices = models.map((m, i) => ({
  id: `dev-${i}`,
  deviceId: `${m}-${String(20481 + i * 7)}`,
  simNumber: `0812345${String(100 + i)}`,
  deviceModel: m,
  protocol: "mqtt",
  hardwareRevisionCode: "RevA",
  imei: `86012345678${String(1000 + i)}`,
  serialNumber: `SN${40000 + i}`,
  blackboxId: null,
  bootloader: null,
  status: "installed",
  registeredAt: iso(60 * 24 * 30),
  installedAt: iso(60 * 24 * 10),
  customer: null,
}));

export const central = {
  mode: "real",
  reachable: true,
  error: null,
  fetchedAt: iso(0),
  devices: devices.map((d, i) => ({
    deviceId: d.deviceId,
    hardwareModel: d.deviceModel,
    online: i % 4 !== 3 && i % 17 !== 5,
    lastSeenAt: i === 3 ? iso(60 * 50) : i === 7 ? iso(60 * 30) : iso(i * 3),
    reportedFirmwareVersion: i % 3 === 0 ? "2.3.8" : "2.4.1",
    reportedConfigVersion: i === 2 || i === 5 || i % 23 === 7 ? 6 : 7,
    reportedSchemaVersion: 1,
    desiredConfigVersion: 7,
    registered: true,
    lastCommand: null,
  })),
};

export const configs = [
  { id: "c1", name: "ค่ามาตรฐานรถบรรทุก", status: "testing" },
  { id: "c2", name: "โหมดประหยัดพลังงาน", status: "approved" },
  { id: "c3", name: "ติดตามความถี่สูง", status: "draft" },
  { id: "c4", name: "ปรับความถี่ตอนจอดรถ", status: "testing" },
  { id: "c5", name: "โหมดเดินทางไกล", status: "testing" },
].map((c, i) => ({
  ...c,
  deviceModel: "BB-200",
  protocol: "mqtt",
  version: i + 1,
  parameters: {},
  description: i === 0 ? "ค่าตั้งต้นสำหรับรถบรรทุกทางไกล" : null,
  fields: { SERVER_HOST: "gps.example.net", SERVER_PORT: 8080 + i, REPORT_INTERVAL: 30 + i * 10, COMMAND_PASSWORD: "s3cr3t" },
  approvedBy: null,
  suggestedApproverId: null,
  clonedFromId: null,
  createdBy: i === 2 ? "u1" : "u2",
  createdAt: iso(300 + i),
  updatedAt: iso(120 + i),
}));

export const incidents = [
  {
    id: "i1",
    title: "Rollout หยุดอัตโนมัติ: ปรับค่ารถบรรทุกภาคเหนือ",
    severity: "high",
    status: "open",
    source: "rollout-failure",
    description: "ระบบหยุด Rollout เพราะอัตราล้มเหลวเกินเกณฑ์",
    metadata: { kind: "auto-pause", failureCount: 6, targetCount: 25, skippedCount: 2, failedDeviceIds: ["BB-200-20481", "BB-200-20488", "BB-310-20495", "BB-310-20502", "TK-50-20509", "BB-200-20544"], sampleErrors: ["อุปกรณ์ตอบกลับไม่ทันเวลา", "Checksum ไม่ตรง"], campaignId: "camp1", rolloutId: "r2" },
  },
  ...[1, 2, 3, 4].map((n) => ({
    id: `i1d${n}`,
    title: "Rollout จบแต่มีเครื่องที่ไม่สำเร็จ: ทดสอบอุปกรณ์ BOX-0001 รอบ3",
    severity: "high",
    status: "open",
    source: "rollout-failure",
    createdAt: iso(300 + n * 90),
    metadata: { kind: "completed-with-failures", failureCount: 1, targetCount: 1, failedDeviceIds: ["BOX-0001"], campaignId: "camp1", rolloutId: "r9" },
  })),
  { id: "i2", title: "เขียน Config ไม่สำเร็จ", severity: "medium", status: "investigating", source: "config-sync-writer", description: null, metadata: { attempts: 3, lastError: "connection timeout" } },
  { id: "i3", title: "แจ้งจากช่างหน้างาน", severity: "low", status: "resolved", source: "field-report", description: "อุปกรณ์ไม่ส่งตำแหน่งหลังเปลี่ยนซิม", deviceId: "BB-200-20481", reportedBy: "u2", reviewedBy: "u1", reviewedAt: iso(120), reviewNote: "ตรวจสอบแล้ว ซิมใช้งานได้ปกติ", metadata: null },
].map((x) => ({
  description: null,
  relatedConfigId: null,
  relatedFirmwareId: null,
  deviceId: null,
  reportedBy: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  createdAt: iso(200),
  updatedAt: iso(100),
  ...x,
}));

export const rollouts = [
  { id: "r1", status: "active", targetCount: 40, successCount: 31, failureCount: 4 },
  { id: "r2", status: "paused", targetCount: 25, successCount: 10, failureCount: 6 },
  { id: "r3", status: "completed", targetCount: 12, successCount: 12, failureCount: 0 },
  { id: "r4", status: "approved", targetCount: 18, successCount: 0, failureCount: 0 },
].map((r) => ({
  ...r,
  campaignId: "camp1",
  payloadType: "config",
  configId: "c2",
  firmwareId: null,
  createdBy: "u1",
  approvedBy: "u2",
  approvedAt: iso(r.status === "approved" ? 60 * 20 : 500),
  isRollback: false,
  createdAt: iso(600),
  updatedAt: iso(30),
}));

export const firmware = [
  { id: "f1", version: "2.5.0", approvalStatus: "pending_review", uploadedAt: iso(60 * 6) },
  { id: "f2", version: "2.4.2", approvalStatus: "rejected", uploadedAt: iso(60 * 30) },
  { id: "f3", version: "2.4.1", approvalStatus: "approved", uploadedAt: iso(60 * 90) },
].map((f) => ({
  ...f,
  deviceModelCompatibility: ["BB-200", "BB-310"],
  uploadStatus: "stored",
  deviceUpdateStatus: "unknown",
  objectKey: "k",
  originalFilename: "fw.bin",
  fileSizeBytes: 1024,
  checksumSha256: "9f2c4a7e1b6d3085a4c9e27f10bb83d65e0a71c4d29f8b3647a05c1de8f2b390",
  uploadedBy: "u1",
  approvedBy: null,
}));

export const configDefinitions = [
  ["SERVER_HOST", "string", "Server", "ที่อยู่ Server ที่กล่องส่งข้อมูลไป", true, false, false, null, []],
  ["SERVER_PORT", "integer", "Server", "พอร์ตของ Server", true, false, true, "8080", []],
  ["REPORT_INTERVAL", "integer", "Tracking", "ช่วงเวลารายงานตำแหน่ง", false, false, false, "30", []],
  ["COMMAND_PASSWORD", "string", "Security", "รหัสผ่านสำหรับคำสั่งผ่าน SMS", false, true, false, null, []],
  ["NETWORK_MODE", "string", "Network", "โหมดเครือข่าย", false, false, false, "auto", ["auto", "2g", "4g"]],
].map(([fieldName, dataType, category, description, required, sensitive, restartRequired, defaultValue, allowedValues], i) => ({
  id: `def${i}`,
  fieldName,
  dataType,
  category,
  description,
  required,
  sensitive,
  restartRequired,
  defaultValue,
  allowedValues,
  unknownSpec: false,
  unit: fieldName === "REPORT_INTERVAL" ? "วินาที" : null,
  stOverridable: i % 2 === 0,
  supportedModels: [{ deviceModel: "BB-200", protocol: "mqtt" }],
  createdAt: iso(5000),
  updatedAt: iso(4000),
}));

export const deviceModels = [
  { id: "m1", name: "BB-200", manufacturer: "Blackbox", supportedProtocols: ["mqtt"], status: "active", warrantyMonths: 24, endOfSupportDate: null, notes: null, createdAt: iso(9000), updatedAt: iso(9000) },
  { id: "m2", name: "BB-310", manufacturer: "Blackbox", supportedProtocols: ["mqtt", "tcp"], status: "active", warrantyMonths: 12, endOfSupportDate: null, notes: null, createdAt: iso(9000), updatedAt: iso(9000) },
];

export const campaigns = [
  { id: "camp1", name: "ปรับค่ารถบรรทุกภาคเหนือ", description: "กลุ่มรถบรรทุกที่วิ่งเส้นเหนือ", createdBy: "u1", createdAt: iso(900), updatedAt: iso(800) },
  { id: "camp2", name: "อัปเดต Firmware รุ่น BB-310", description: null, createdBy: "u1", createdAt: iso(3000), updatedAt: iso(2900) },
];

const auditActions = [
  ["config", "approve"], ["campaign", "create"], ["firmware", "approve"], ["device", "apply-config"], ["config", "update"],
  ["campaign", "release"], ["config-deletion", "decide"], ["device", "create"],
];
export const auditLogs = {
  items: Array.from({ length: 20 }, (_, i) => ({
    id: `a${i}`,
    userId: i % 3 === 0 ? "u2" : "u1",
    auditModule: auditActions[i % auditActions.length][0],
    action: auditActions[i % auditActions.length][1],
    ipAddress: i % 4 === 3 ? null : `10.0.0.${2 + (i % 5)}`,
    metadata: auditActions[i % auditActions.length][1] === "apply-config" ? { deviceId: "BB-200-20481", configId: "c2", fieldNames: ["SERVER_PORT", "REPORT_INTERVAL"] } : null,
    createdAt: iso(12 + i * 47),
  })),
  total: 46,
  page: 1,
  pageSize: 20,
};

export const campaignTargets = ["BB-200-20481", "BB-200-20488", "BB-310-20495", "BB-310-20502"].map((deviceId, i) => ({ id: `ct${i}`, campaignId: "camp1", deviceId, createdAt: iso(800 - i) }));
export const rolloutTargets = [
  ["BB-200-20481", "success", null], ["BB-200-20488", "success", null], ["BB-310-20495", "failed", "อุปกรณ์ตอบกลับไม่ทันเวลา"],
  ["BB-310-20502", "skipped", "ออฟไลน์"], ["TK-50-20509", "pending", null],
].map(([deviceId, status, resultDetail], i) => ({ id: `rt${i}`, rolloutId: "r2", deviceId, status, resultDetail, createdAt: iso(600), updatedAt: iso(20 + i) }));

export const managedUsers = [
  { id: "u3", username: "somchai.k", fullName: "สมชาย ใจดี", role: "Operation", isActive: true },
  { id: "u4", username: "wipa.r", fullName: "วิภา รักงาน", role: "ConfigEngineer", isActive: true },
  { id: "u5", username: "anan.s", fullName: "อนันต์ สุขใจ", role: "ST", isActive: false },
];

export function makeToken(role = "Operation") {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ sub: "u1", role, exp: Math.floor(now / 1000) + 3600 * 6 })}.x`;
}

export function apiResponse(url) {
  const p = url.replace(/^.*\/api\/v1/, "").split("?")[0];
  const query = new URLSearchParams(url.split("?")[1] ?? "");
  if (p === "/devices") return devices;
  const dev = p.match(/^\/devices\/([^/]+)(?:\/(central|status|history))?$/);
  if (dev) {
    const d = devices.find((x) => x.deviceId === decodeURIComponent(dev[1])) ?? devices[0];
    if (dev[2] === "central") {
      return { mode: "real", reachable: true, error: null, fetchedAt: iso(0), device: central.devices.find((c) => c.deviceId === d.deviceId) ?? null };
    }
    if (dev[2] === "status") {
      return { deviceId: d.deviceId, configStatus: "pending", firmwareStatus: "up_to_date", configRolloutId: null, firmwareRolloutId: null, lastCheckInMessage: null, pendingFirmwareOverride: null };
    }
    if (dev[2] === "history") {
      return {
        summary: { currentConfig: { id: "c2", name: "โหมดประหยัดพลังงาน" }, currentFirmware: { id: "f3", version: "2.4.1" } },
        items: [
          { id: "rollout:1", type: "rollout", occurredAt: iso(90), status: "success", title: "ปรับค่ารถบรรทุกภาคเหนือ", detail: null, actorId: "u2", payloadType: "Config", isRollback: false, severity: null, config: { id: "c2", name: "โหมดประหยัดพลังงาน", versionNumber: 2 }, firmware: null, decision: null, refs: { campaignId: "camp1", rolloutId: "r3", taskId: null, incidentId: null, overrideId: null } },
          { id: "life:1", type: "lifecycle", occurredAt: iso(60 * 24 * 10), status: "installed", title: "ติดตั้งแล้ว", detail: null, actorId: "u1", payloadType: null, isRollback: null, severity: null, config: null, firmware: null, decision: null, refs: { campaignId: null, rolloutId: null, taskId: null, incidentId: null, overrideId: null } },
        ],
        nextCursor: null,
      };
    }
    return d;
  }
  if (p === "/central/devices") return central;
  if (p === "/config") {
    const status = query.get("status");
    return status ? configs.filter((c) => c.status === status) : configs;
  }
  const cfg = p.match(/^\/config\/([^/]+)(?:\/(versions))?$/);
  if (cfg) {
    const c = configs.find((x) => x.id === cfg[1]) ?? configs[0];
    if (cfg[2] === "versions") {
      return [{ id: "v1", configId: c.id, versionNumber: 1, deviceModel: c.deviceModel, protocol: c.protocol, fields: { ...c.fields, SERVER_PORT: 1883, REPORT_INTERVAL: 60, COMMAND_PASSWORD: "old-secret" }, approvedBy: "u2", approvedAt: iso(9000) }];
    }
    return c;
  }
  if (p === "/config-definitions") return configDefinitions;
  if (p === "/device-models") return deviceModels;
  const inc = p.match(/^\/incidents\/([^/]+)$/);
  if (inc) return incidents.find((x) => x.id === inc[1]) ?? incidents[0];
  if (p === "/incidents") return incidents;
  const fw = p.match(/^\/firmware\/([^/]+)$/);
  if (fw) return firmware.find((f) => f.id === fw[1]) ?? firmware[0];
  if (p === "/firmware") return firmware;
  if (p === "/customers") return [{ id: "cu1", companyName: "บริษัท ขนส่งภาคเหนือ จำกัด" }];
  if (p === "/campaigns") return campaigns;
  const camp = p.match(/^\/campaigns\/([^/]+)(?:\/(targets|rollouts)(?:\/([^/]+)(?:\/(targets))?)?)?$/);
  if (camp && camp[1] !== "rollouts") {
    if (camp[4] === "targets") return rolloutTargets;
    if (camp[3]) return rollouts.find((r) => r.id === camp[3]) ?? rollouts[1];
    if (camp[2] === "targets") return campaignTargets;
    if (camp[2] === "rollouts") return rollouts;
    return campaigns[0];
  }
  if (p === "/campaigns/rollouts") return query.get("status") === "pending_approval" ? [] : rollouts;
  if (p === "/audit-logs") return auditLogs;
  if (p === "/notifications") return [];
  if (p === "/users/managed") return managedUsers;
  if (p === "/users") return [{ id: "u1", fullName: "สมชาย ใจดี", role: "Operation" }, { id: "u2", fullName: "วิภา รักงาน", role: "ConfigEngineer" }];
  return [];
}
