export interface NavItem {
  label: string;
  href: string;
  /**
   * อ้างอิงชื่อหน้าจอใน docs/architecture/RBAC_Matrix.md Section 2 — เก็บไว้ตอน
   * ต่อ role-based visibility ทีหลัง (ยังไม่ทำใน #27 เพราะ Web ยังไม่มี auth
   * context จริง)
   */
  screenName: string;
}

/**
 * รายการหน้าจอ Phase 1 เท่านั้น (ดู RBAC_Matrix.md Section 2 สำหรับหน้าจอ
 * ทั้งหมด ~19 หน้า — ที่เหลือ เช่น Campaign/Task/Incident/Audit Log/User
 * Management ยังไม่มี backend module รองรับ ยังไม่ scaffold route ให้)
 *
 * ยังไม่กรองตาม role ผู้ใช้ — รอ Web auth context (fetch client เก็บ JWT +
 * decode role) ซึ่งไม่ใช่ scope ของ #27
 */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/', screenName: 'Dashboard / Main' },
  {
    label: 'Device Search',
    href: '/devices',
    screenName: 'Device Search / Device Detail',
  },
  { label: 'Config Editor', href: '/config', screenName: 'Config Editor' },
  {
    label: 'Config Import',
    href: '/config/import',
    screenName: 'Config Import จากไฟล์ (JSON)',
  },
  {
    label: 'Approval Center',
    href: '/approvals',
    screenName: 'Approval Center',
  },
  {
    label: 'Firmware Repository',
    href: '/firmware',
    screenName: 'Firmware Repository',
  },
];
