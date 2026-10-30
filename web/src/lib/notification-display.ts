/**
 * แปลง `Notification` เป็นสิ่งที่แสดงบนหน้าเว็บ — ฟังก์ชัน pure แยกจาก UI ให้
 * เทสง่าย · ข้อความหัวข้อตรงกับ Mobile (`NotificationTypeStyle.label`) เพื่อให้
 * ผู้ใช้ที่ใช้ทั้งสองแอปเห็นคำเดียวกัน
 *
 * หลักการลิงก์: ปลายทางต้องรู้แน่นอนจาก payload เท่านั้น ถ้าไม่มี id ที่ใช้
 * ได้ คืน `href: null` (กดแล้วแค่ทำเป็นอ่านแล้ว) ไม่เดาหน้าให้
 */
export type NotificationView = {
  title: string;
  /** บรรทัดรอง (ข้อมูลจาก payload) ว่างได้ */
  details: string[];
  href: string | null;
  /** ต้องมีคนลงมือ — แสดงป้ายข้อความ "ด่วน" (ไม่พึ่งสีอย่างเดียว) */
  urgent: boolean;
};

type Input = { type: string; payload: Record<string, unknown> };

/** role ของผู้เปิดดูแจ้งเตือน — ใช้แค่จุดเดียว (`config_apply_succeeded`/
 * `config_apply_failed`) ที่ backend ส่งให้ทั้งช่างผู้ขอ "และ" Operation
 * ผู้อนุมัติ (`config-apply-request.service.ts` `onRolloutResult`) ข้อความ
 * default เขียนจากมุมช่าง ("ที่คุณขอส่ง") ตรงกับ Mobile ที่เห็น type นี้แค่
 * ฝั่งช่าง — ไม่ส่ง role หรือไม่ใช่ Operation = ใช้ข้อความเดิมเป๊ะ */
type ViewerRole = string | null | undefined;

function text(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function line(label: string, value: string | null): string[] {
  return value ? [`${label}: ${value}`] : [];
}

function hrefTo(base: string, id: string | null): string | null {
  return id ? `${base}/${encodeURIComponent(id)}` : null;
}

export function describeNotification(
  n: Input,
  viewerRole?: ViewerRole,
): NotificationView {
  const p = n.payload ?? {};
  const deviceId = text(p, "deviceId");

  switch (n.type) {
    case "incident_report_pending":
      return {
        title: "มีรายงานปัญหาหน้างานรอตัดสินใจ",
        details: [...line("อุปกรณ์", deviceId), ...line("หัวข้อ", text(p, "title"))],
        href: hrefTo("/incidents", text(p, "incidentId")),
        urgent: true,
      };
    case "incident_report_resolved":
    case "incident_report_dismissed":
    case "incident_report_promoted": {
      const title =
        n.type === "incident_report_resolved"
          ? "รายงานปัญหาของคุณถูกปิดแล้ว (แก้ไขแล้ว)"
          : n.type === "incident_report_dismissed"
            ? "รายงานปัญหาของคุณไม่ถูกดำเนินการ"
            : "รายงานปัญหาของคุณถูกส่งต่อเป็น Campaign แก้ไข";
      return {
        title,
        details: [
          ...line("อุปกรณ์", deviceId),
          ...line("หมายเหตุ", text(p, "reviewNote")),
        ],
        href: hrefTo("/incidents", text(p, "incidentId")),
        urgent: false,
      };
    }
    case "incident_alert": {
      const model = text(p, "deviceModel");
      const protocol = text(p, "protocol");
      return {
        title: "แจ้งเตือนเหตุการณ์ (เขียน Config ไม่สำเร็จ)",
        details: [
          ...line(
            "โมเดล/โปรโตคอล",
            model && protocol ? `${model} / ${protocol}` : (model ?? protocol),
          ),
          ...line("ข้อผิดพลาด", text(p, "lastError")),
        ],
        href: hrefTo("/config", text(p, "configId")),
        urgent: true,
      };
    }
    case "config_override_pending":
      return {
        title: "มีคำขอ Override รออนุมัติ",
        details: line("อุปกรณ์", deviceId),
        href: "/approvals",
        urgent: false,
      };
    case "firmware_override_pending":
      return {
        title: "มีคำขอ Firmware Override รออนุมัติ",
        details: line("อุปกรณ์", deviceId),
        href: "/approvals",
        urgent: false,
      };
    case "config_override_approved":
    case "config_override_rejected":
    case "firmware_override_approved":
    case "firmware_override_rejected": {
      const isFirmware = n.type.startsWith("firmware");
      const approved = n.type.endsWith("approved");
      const what = isFirmware ? "คำขอ Firmware Override" : "คำขอ Override";
      return {
        title: `${what} ${approved ? "ได้รับการอนุมัติ" : "ถูกปฏิเสธ"}`,
        details: [
          ...line("อุปกรณ์", deviceId),
          ...(approved ? [] : line("เหตุผล", text(p, "rejectReason"))),
        ],
        href: hrefTo("/devices", deviceId),
        urgent: false,
      };
    }
    case "config_apply_pending": {
      const what = p.kind === "firmware" ? "Firmware" : "Config";
      return {
        title: `มีคำขอส่ง ${what} เข้าเครื่องรออนุมัติ`,
        details: line("อุปกรณ์", deviceId),
        href: "/approvals",
        urgent: false,
      };
    }
    case "config_apply_approved":
    case "config_apply_rejected":
    case "config_apply_expired": {
      const what = p.kind === "firmware" ? "Firmware" : "Config";
      const title = {
        config_apply_approved: `คำขอส่ง ${what} อนุมัติแล้ว — กดส่งเข้ากล่องได้`,
        config_apply_rejected: `คำขอส่ง ${what} ของคุณถูกปฏิเสธ`,
        config_apply_expired: `คำขอส่ง ${what} ของคุณหมดอายุ (ไม่มีใครตัดสิน หรือไม่ได้กดส่งใน 24 ชม.)`,
      }[n.type as string]!;
      return {
        title,
        // เว็บไม่มีหน้างาน (ตัดออกตามมติ เหมือน task_assigned) จึงไม่ลิงก์ —
        // type กลุ่มนี้ backend ส่งแค่ช่างผู้ขอเท่านั้น (ต่างจาก succeeded/
        // failed ด้านล่างที่ส่ง Operation ด้วย) ไม่ต้องสลับข้อความตาม role
        details: [
          ...line("อุปกรณ์", deviceId),
          ...(n.type === "config_apply_rejected"
            ? line("เหตุผล", text(p, "rejectReason"))
            : []),
        ],
        href: null,
        urgent: false,
      };
    }
    case "config_apply_succeeded":
    case "config_apply_failed": {
      // backend ส่งให้ทั้งช่างผู้ขอและ Operation ผู้อนุมัติ (ต่างจาก
      // approved/rejected/expired ด้านบนที่ส่งแค่ช่าง) ข้อความต้องไม่ผูกกับ
      // "คุณขอ" เมื่อผู้เปิดดูเป็น Operation — Operation มีหน้าอุปกรณ์ให้ไปดูได้
      // จริงจึงลิงก์ได้ด้วย ต่างจากช่างที่เว็บไม่มีหน้างาน
      const what = p.kind === "firmware" ? "Firmware" : "Config";
      const isOperation = viewerRole === "Operation";
      const title =
        n.type === "config_apply_succeeded"
          ? isOperation
            ? `กล่อง ${deviceId ?? ""} รับ ${what} ที่อนุมัติไว้แล้ว`.trim()
            : `กล่องรับ ${what} ที่คุณขอส่งแล้ว`
          : isOperation
            ? `ส่ง ${what} เข้ากล่อง ${deviceId ?? ""} ไม่สำเร็จ`.trim()
            : `ส่ง ${what} ที่คุณขอเข้าเครื่องไม่สำเร็จ`;
      return {
        title,
        details: [
          ...line("อุปกรณ์", deviceId),
          ...(n.type === "config_apply_failed"
            ? line("เหตุผล", text(p, "detail"))
            : []),
        ],
        href: isOperation ? hrefTo("/devices", deviceId) : null,
        urgent: false,
      };
    }
    case "config_deletion_pending":
      return {
        title: "มีคำขอลบ Config รออนุมัติ",
        details: line("Config", text(p, "configName")),
        href: hrefTo("/config", text(p, "configId")),
        urgent: false,
      };
    case "config_deletion_grace":
      return {
        title: "Config ของคุณถูกเสนอลบ",
        details: line("Config", text(p, "configName")),
        href: hrefTo("/config", text(p, "configId")),
        urgent: false,
      };
    case "task_assigned":
      // เว็บไม่มีหน้างาน (ตัดออกตามมติ) จึงไม่ลิงก์
      return {
        title: "มอบหมายงานใหม่",
        details: line("งาน", text(p, "title")),
        href: null,
        urgent: false,
      };
    case "config_approved":
      return { title: "อนุมัติ Config แล้ว", details: [], href: null, urgent: false };
    case "config_rejected":
      return { title: "Config ถูกปฏิเสธ", details: [], href: null, urgent: false };
    case "firmware_ready":
      return {
        title: "เฟิร์มแวร์พร้อมใช้งาน",
        details: [],
        href: null,
        urgent: false,
      };
    default:
      // ชนิดที่ backend เพิ่มภายหลัง — ไม่ error ไม่เดาปลายทาง
      return { title: "แจ้งเตือนใหม่", details: [], href: null, urgent: false };
  }
}
