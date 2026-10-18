import 'package:flutter/material.dart';

import '../../core/api/models.dart';
import '../../core/theme/app_theme.dart';

/// บอกว่าอุปกรณ์เครื่องนี้มีคำขอ Config Override ที่ยังรอ Operation ตัดสินใจ
/// (`pendingOverride` จาก `GET /devices/{deviceId}/config`) ใช้ใน Device Detail
/// (UX audit #2: ส่งคำขอแล้วย้อนกลับมาต้องเห็นสถานะ) · mirror
/// [PendingFirmwareOverrideBanner] และบอกว่าขอแก้ field ไหนบ้าง เพราะช่างต้องรู้
/// ว่าค่าไหนยังไม่มีผลกับเครื่องจนกว่าจะอนุมัติ · แสดงแค่ชื่อ field ไม่แสดงค่า
/// เพราะหน้านี้ไม่ได้โหลด definition จึงไม่รู้ว่า field ไหน `sensitive` (หน้า
/// Override ซ่อนค่าพวกนั้นไว้หลังปุ่มรูปตา)
class PendingConfigOverrideBanner extends StatelessWidget {
  const PendingConfigOverrideBanner({super.key, required this.pending});

  final DeviceConfigOverride pending;

  @override
  Widget build(BuildContext context) {
    final requested = pending.fields.keys.join(', ');
    return Container(
      key: const Key('device_detail_config_override_pending'),
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.mockAccentSoft,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.hourglass_top, size: 16, color: AppTheme.mockAccent),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'มีคำขอ Config Override รอ Operation อนุมัติอยู่',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.mockAccent,
                  ),
                ),
                if (requested.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    'ขอแก้: $requested',
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                ],
                const SizedBox(height: 2),
                Text(
                  'เหตุผล: ${pending.reason}',
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppTheme.textSecondary,
                  ),
                ),
                const SizedBox(height: 2),
                const Text(
                  'ยังไม่มีผลกับเครื่องจนกว่าจะอนุมัติและใส่ Config เข้าเครื่องอีกครั้ง',
                  style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
