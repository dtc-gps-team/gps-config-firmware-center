import 'package:flutter/material.dart';

import '../../core/api/models.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_notice.dart';

/// บอกว่าอุปกรณ์เครื่องนี้มีคำขอ Config Override ที่ยังรอ Operation ตัดสินใจ
/// (`pendingOverride` จาก `GET /devices/{deviceId}/config`) ใช้ใน Device Detail
/// (UX audit #2: ส่งคำขอแล้วย้อนกลับมาต้องเห็นสถานะ) · mirror
/// [PendingFirmwareOverrideBanner] และบอกว่าขอแก้ field ไหนบ้าง เพราะช่างต้องรู้
/// ว่าค่าไหนยังไม่มีผลกับเครื่องจนกว่าจะอนุมัติ · แสดงแค่ชื่อ field ไม่แสดงค่า
/// เพราะหน้านี้ไม่ได้โหลด definition จึงไม่รู้ว่า field ไหน `sensitive` (หน้า
/// Override ซ่อนค่าพวกนั้นไว้หลังปุ่มรูปตา)
///
/// design system ใหม่ (docs/22 Batch 4): `AppNotice` tone warning แทนกล่องสี
/// `mockAccentSoft` เดิม
class PendingConfigOverrideBanner extends StatelessWidget {
  const PendingConfigOverrideBanner({super.key, required this.pending});

  final DeviceConfigOverride pending;

  @override
  Widget build(BuildContext context) {
    final requested = pending.fields.keys.join(', ');
    return AppNotice(
      key: const Key('device_detail_config_override_pending'),
      tone: AppBadgeTone.warning,
      icon: Icons.hourglass_top,
      title: 'มีคำขอ Config Override รอ Operation อนุมัติอยู่',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (requested.isNotEmpty) Text('ขอแก้: $requested'),
          Text('เหตุผล: ${pending.reason}'),
          const SizedBox(height: 2),
          const Text(
            'ยังไม่มีผลกับเครื่องจนกว่าจะอนุมัติและใส่ Config เข้าเครื่องอีกครั้ง',
          ),
        ],
      ),
    );
  }
}
