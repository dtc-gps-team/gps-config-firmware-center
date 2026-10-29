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
    reportedFirmwareVersion: "2.4.1",
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
].map((c, i) => ({
  ...c,
  deviceModel: "BB-200",
  protocol: "mqtt",
  version: i + 1,
  parameters: {},
  createdBy: "u1",
  createdAt: iso(300 + i),
  updatedAt: iso(120 + i),
}));

export const incidents = [
  { id: "i1", title: "อุปกรณ์รายงานค่าผิดปกติหลังอัปเดต", severity: "high", status: "open" },
  { id: "i2", title: "ซิงก์ Config ล้มเหลว", severity: "medium", status: "investigating" },
  { id: "i3", title: "แจ้งจากช่างหน้างาน", severity: "low", status: "resolved" },
].map((x) => ({
  ...x,
  description: null,
  relatedConfigId: null,
  relatedFirmwareId: null,
  source: null,
  metadata: null,
  deviceId: null,
  reportedBy: null,
  createdAt: iso(200),
  updatedAt: iso(100),
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
  checksumSha256: null,
  uploadedBy: "u1",
  approvedBy: null,
}));

export const campaigns = [{ id: "camp1", name: "ปรับค่ารถบรรทุกภาคเหนือ", createdAt: iso(900) }];

export const auditLogs = {
  items: [
    { id: "a1", userId: "u1", auditModule: "config", action: "approve", ipAddress: "10.0.0.2", metadata: null, createdAt: iso(12) },
    { id: "a2", userId: "u1", auditModule: "campaign", action: "create", ipAddress: "10.0.0.2", metadata: null, createdAt: iso(55) },
  ],
  total: 2,
  page: 1,
  pageSize: 5,
};

export function makeToken(role = "Operation") {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ sub: "u1", role, exp: Math.floor(now / 1000) + 3600 * 6 })}.x`;
}

export function apiResponse(path) {
  const p = path.replace(/^.*\/api\/v1/, "").split("?")[0];
  if (p === "/devices") return devices;
  if (p === "/central/devices") return central;
  if (p === "/config") return configs;
  if (p === "/incidents") return incidents;
  if (p === "/firmware") return firmware;
  if (p === "/campaigns") return campaigns;
  if (p === "/campaigns/rollouts") return rollouts;
  if (p === "/audit-logs") return auditLogs;
  if (p === "/notifications") return [];
  if (p === "/users") return [{ id: "u1", name: "สมชาย ใจดี", email: "op@example.com", role: "Operation" }];
  return [];
}
