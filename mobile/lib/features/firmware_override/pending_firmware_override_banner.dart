import 'package:flutter/material.dart';

import '../../core/api/models.dart';
import '../../core/theme/app_theme.dart';

/// บอกว่าอุปกรณ์เครื่องนี้มีคำขอ Firmware Override ที่ยังรอ Operation ตัดสินใจ
/// (`pendingFirmwareOverride` จาก `GET /devices/{deviceId}/status`, PR #257) —
/// mirror `_PendingOverrideBanner` ของ Config Override · เครื่องหนึ่งมีคำขอ
/// pending พร้อมกันได้แค่ 1 รายการ ใช้ทั้งใน Device Detail และหน้า
/// Firmware Override
class PendingFirmwareOverrideBanner extends StatelessWidget {
  const PendingFirmwareOverrideBanner({super.key, required this.pending});

  final DeviceFirmwareOverride pending;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('firmware_override_pending_banner'),
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
                  'มีคำขอ Firmware Override รอ Operation อนุมัติอยู่',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.mockAccent,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'เหตุผล: ${pending.reason}',
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
