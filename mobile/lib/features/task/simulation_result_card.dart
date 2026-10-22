import 'package:flutter/material.dart';

import '../../core/api/models.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_notice.dart';

/// ผลจาก `POST /devices/{deviceId}/simulate-config` — หัวข้อรวม (`result.passed`)
/// แล้วแยกแสดง 3 ส่วน (Config / ความเข้ากันได้ / สัญญาณอุปกรณ์) พร้อม
/// pass-fail + details ของแต่ละส่วน.
///
/// design system ใหม่ (docs/22 Batch 5): อยู่ในการ์ด "ส่ง Config เข้าเครื่อง" ของ
/// Task Detail จึงเป็น `AppNotice` (ผ่าน = success, ไม่ผ่าน = danger) แทนการ์ดซ้อนการ์ด
class SimulationResultCard extends StatelessWidget {
  const SimulationResultCard({super.key, required this.result});

  final DeviceSimulateConfigResult result;

  @override
  Widget build(BuildContext context) {
    final conn = result.connectionCheck;
    return AppNotice(
      tone: result.passed ? AppBadgeTone.success : AppBadgeTone.danger,
      icon: result.passed ? Icons.check_circle : Icons.cancel,
      title: result.passed ? 'พร้อมติดตั้ง' : 'ยังไม่พร้อมติดตั้ง',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 4),
          _CheckBlock(
            label: 'Config',
            passed: result.configCheck.passed,
            details: result.configCheck.details,
          ),
          const SizedBox(height: 8),
          _CheckBlock(
            label: 'ความเข้ากันได้กับอุปกรณ์',
            passed: result.compatibilityCheck.passed,
            details: result.compatibilityCheck.details,
          ),
          const SizedBox(height: 8),
          _CheckBlock(
            label: 'สัญญาณอุปกรณ์',
            passed: conn.passed,
            details: ['แรงสัญญาณ: ${conn.signalStrength} dBm', ...conn.details],
          ),
        ],
      ),
    );
  }
}

/// หนึ่งส่วนย่อยของ [SimulationResultCard] — label + pass/fail ของตัวเอง + bullet details.
class _CheckBlock extends StatelessWidget {
  const _CheckBlock({
    required this.label,
    required this.passed,
    required this.details,
  });

  final String label;
  final bool passed;
  final List<String> details;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 3),
              child: ExcludeSemantics(
                child: Icon(
                  passed ? Icons.check_circle_outline : Icons.cancel_outlined,
                  size: 16,
                  color: passed
                      ? AppColors.successForeground
                      : AppColors.dangerForeground,
                ),
              ),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                '$label — ${passed ? 'ผ่าน' : 'ไม่ผ่าน'}',
                style: const TextStyle(
                  fontWeight: FontWeight.w600,
                  color: AppColors.foreground,
                ),
              ),
            ),
          ],
        ),
        for (final line in details)
          Padding(
            padding: const EdgeInsets.only(left: 22, top: 2),
            child: Text(
              '• $line',
              style: const TextStyle(color: AppColors.foreground),
            ),
          ),
      ],
    );
  }
}
