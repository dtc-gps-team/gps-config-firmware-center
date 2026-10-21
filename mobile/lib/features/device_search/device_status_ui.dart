import 'package:flutter/material.dart';

import '../../core/api/models.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/labels.dart';
import '../../core/ui/status_tones.dart';

/// ป้ายสถานะเครื่อง — ตัวครอบ [AppBadge] (label/tone ชุดเดียวกับ Web, docs/22 §5.2 /
/// §6.1) · หน้า Device Search / Device Detail ใช้ `AppBadge` ตรงแล้ว (Batch 4) ที่เหลือ
/// ใช้ตัวนี้คือหน้าเลือกอุปกรณ์ของ "ทดสอบสัญญาณ" ที่ #361 (Batch 3b) ลบทิ้ง — ลบไฟล์นี้
/// ได้เมื่อ #361 merge แล้ว
class DeviceStatusPill extends StatelessWidget {
  const DeviceStatusPill({super.key, required this.status});

  final DeviceLifecycleStatus status;

  @override
  Widget build(BuildContext context) {
    return AppBadge(
      label: deviceLifecycleLabel(status),
      tone: deviceLifecycleTone(status),
      dot: true,
    );
  }
}
