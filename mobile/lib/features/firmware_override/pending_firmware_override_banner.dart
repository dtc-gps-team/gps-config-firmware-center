import 'package:flutter/material.dart';

import '../../core/api/models.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_notice.dart';

/// บอกว่าอุปกรณ์เครื่องนี้มีคำขอ Firmware Override ที่ยังรอ Operation ตัดสินใจ
/// (`pendingFirmwareOverride` จาก `GET /devices/{deviceId}/status`, PR #257) —
/// mirror `_PendingOverrideBanner` ของ Config Override · เครื่องหนึ่งมีคำขอ
/// pending พร้อมกันได้แค่ 1 รายการ ใช้ทั้งใน Device Detail และหน้า
/// Firmware Override
///
/// design system ใหม่ (docs/22 Batch 4): `AppNotice` tone warning (รอดำเนินการ =
/// warning ตาม §5.2) แทนกล่องสี `mockAccentSoft` เดิม
class PendingFirmwareOverrideBanner extends StatelessWidget {
  const PendingFirmwareOverrideBanner({super.key, required this.pending});

  final DeviceFirmwareOverride pending;

  @override
  Widget build(BuildContext context) {
    return AppNotice(
      key: const Key('firmware_override_pending_banner'),
      tone: AppBadgeTone.warning,
      icon: Icons.hourglass_top,
      title: 'มีคำขอ Firmware Override รอ Operation อนุมัติอยู่',
      child: Text('เหตุผล: ${pending.reason}'),
    );
  }
}
