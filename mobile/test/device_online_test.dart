import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/device_search/device_online.dart';

/// issue #386 ข้อ 5 — เลือกแหล่งสถานะออนไลน์ของหน้ากล่อง
void main() {
  DeviceStatus status({bool online = false, DateTime? lastSeenAt}) =>
      DeviceStatus(
        deviceId: 'BOX-0001',
        configStatus: DevicePayloadStatus.unknown,
        firmwareStatus: DevicePayloadStatus.unknown,
        online: online,
        lastSeenAt: lastSeenAt,
      );
  final seen = DateTime.utc(2026, 10, 26, 10);

  test('Server กลางรู้จักกล่อง -> ใช้ค่าจาก Server กลาง', () {
    final r = DeviceOnline.resolve(
      status(),
      DeviceCentral(
        reachable: true,
        device: CentralDeviceInfo(online: true, lastSeenAt: seen),
      ),
    );
    expect(r.online, isTrue);
    expect(r.lastSeenAt, seen);
    expect(r.fromCentral, isTrue);
    expect(r.label, 'ออนไลน์');
  });

  test('Server กลางไม่รู้จัก / ติดต่อไม่ได้ / ยังไม่โหลด -> ใช้ /status', () {
    for (final central in [
      const DeviceCentral(reachable: true),
      DeviceCentral(
        reachable: false,
        device: CentralDeviceInfo(online: true, lastSeenAt: seen),
      ),
      null,
    ]) {
      final r = DeviceOnline.resolve(
        status(online: false, lastSeenAt: seen),
        central,
      );
      expect(r.online, isFalse);
      expect(r.fromCentral, isFalse);
      expect(r.label, 'ออฟไลน์');
    }
  });

  test('/status ไม่เคยติดต่อ -> online null "ยังไม่เคยติดต่อ"', () {
    final r = DeviceOnline.resolve(status(), null);
    expect(r.online, isNull);
    expect(r.lastSeenAt, isNull);
    expect(r.label, 'ยังไม่เคยติดต่อ');
  });
}
