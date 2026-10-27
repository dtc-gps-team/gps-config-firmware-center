import '../../core/api/models.dart';

/// สถานะออนไลน์ที่หน้ากล่องแสดง — รวม 2 แหล่งที่ backend มี (issue #386 ข้อ 5):
///
/// 1. Server กลาง (`GET /devices/{id}/central`) เมื่อติดต่อได้และรู้จักกล่องนี้ —
///    กล่องโหมด central ต่อผ่าน ws-gateway ไม่เคยเรียก `/device-sync/*`
///    `/status` จึงบอกออฟไลน์เสมอทั้งที่กล่องออนไลน์อยู่
/// 2. ไม่งั้นใช้ `GET /devices/{id}/status` (`lastSeenAt` จาก `/device-sync/*`)
///
/// [online] `null` = ไม่เคยติดต่อเลย — ไม่บอกว่า "ออฟไลน์" เพราะไม่มีข้อมูล
class DeviceOnline {
  const DeviceOnline({this.online, this.lastSeenAt, this.fromCentral = false});

  final bool? online;
  final DateTime? lastSeenAt;
  final bool fromCentral;

  factory DeviceOnline.resolve(DeviceStatus status, DeviceCentral? central) {
    final device = central?.device;
    if (central != null && central.reachable && device != null) {
      return DeviceOnline(
        online: device.online,
        lastSeenAt: device.lastSeenAt,
        fromCentral: true,
      );
    }
    if (status.lastSeenAt == null) return const DeviceOnline();
    return DeviceOnline(online: status.online, lastSeenAt: status.lastSeenAt);
  }

  String get label => switch (online) {
    true => 'ออนไลน์',
    false => 'ออฟไลน์',
    null => 'ยังไม่เคยติดต่อ',
  };
}
