import 'package:flutter/material.dart';

import '../../core/api/models.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_notice.dart';

/// เตือนตั้งแต่เปิดหน้าว่า Config มีค่าที่ firmware บนกล่องไม่รองรับ (`boxSchema`,
/// v3.76) — ตอนส่งเข้ากล่อง backend ตรวจกับ schema เดียวกันและปฏิเสธ**ทั้งชุด**
/// ช่างจึงไม่ควรรอการอนุมัติที่ยังไงก็ส่งไม่ผ่าน · ไม่มีค่าที่ไม่รองรับ = ไม่แสดงอะไร
class UnsupportedFirmwareNotice extends StatelessWidget {
  const UnsupportedFirmwareNotice({
    super.key,
    required this.schema,
    required this.unsupportedKeys,
  });

  final BoxSchema schema;
  final List<String> unsupportedKeys;

  @override
  Widget build(BuildContext context) {
    if (unsupportedKeys.isEmpty) return const SizedBox.shrink();
    return AppNotice(
      key: const Key('unsupported_firmware_notice'),
      tone: AppBadgeTone.danger,
      icon: Icons.block,
      title: 'ส่ง Config นี้เข้ากล่องไม่สำเร็จแน่นอน',
      child: Text(
        '${schema.unsupportedLabel} ${unsupportedKeys.length} ค่า: '
        '${unsupportedKeys.join(', ')} · ต้องอัปเดต Firmware ของกล่อง หรือใช้ '
        'Config ที่ไม่มีค่าเหล่านี้',
      ),
    );
  }
}
