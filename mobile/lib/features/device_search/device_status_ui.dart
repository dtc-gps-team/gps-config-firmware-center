import 'package:flutter/material.dart';

import '../../core/api/models.dart';

/// Shared labels + palette for [DeviceLifecycleStatus], so the search list and
/// the detail screen render status the same way. Same navy design-system
/// palette used across Login / Home / Task.
class DeviceStatusStyle {
  const DeviceStatusStyle._();

  static String label(DeviceLifecycleStatus status) => switch (status) {
    DeviceLifecycleStatus.registered => 'ลงทะเบียนแล้ว',
    DeviceLifecycleStatus.installed => 'ติดตั้งแล้ว',
    DeviceLifecycleStatus.decommissioned => 'ปลดระวาง',
  };

  /// `(background, foreground)` for the status pill.
  static (Color, Color) colors(
    DeviceLifecycleStatus status,
  ) => switch (status) {
    DeviceLifecycleStatus.registered => (Color(0xFFECEFF1), Color(0xFF5F6E79)),
    DeviceLifecycleStatus.installed => (Color(0xFFE6F4EA), Color(0xFF1E7E34)),
    DeviceLifecycleStatus.decommissioned => (
      Color(0xFFFCE8E6),
      Color(0xFFC0392B),
    ),
  };
}

/// Rounded status pill. Same shape/typography as [TaskStatusPill].
class DeviceStatusPill extends StatelessWidget {
  const DeviceStatusPill({super.key, required this.status});

  final DeviceLifecycleStatus status;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = DeviceStatusStyle.colors(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        DeviceStatusStyle.label(status),
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg),
      ),
    );
  }
}

/// Thai labels for [DevicePayloadStatus] (`configStatus` / `firmwareStatus`
/// from `GET /devices/{deviceId}/status`).
class DevicePayloadStatusStyle {
  const DevicePayloadStatusStyle._();

  static String label(DevicePayloadStatus status) => switch (status) {
    DevicePayloadStatus.upToDate => 'อัปเดตล่าสุด',
    DevicePayloadStatus.failed => 'ล้มเหลว',
    DevicePayloadStatus.pending => 'รออัปเดต',
    DevicePayloadStatus.unknown => 'ไม่ทราบ',
  };
}
