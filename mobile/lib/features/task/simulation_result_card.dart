import 'package:flutter/material.dart';

import '../../core/api/models.dart';

/// ผลจาก `POST /devices/{deviceId}/simulate-config` — หัวข้อรวม (`result.passed`)
/// แล้วแยกแสดง 3 ส่วน (Config / ความเข้ากันได้ / สัญญาณอุปกรณ์) พร้อม
/// pass-fail + details ของแต่ละส่วน.
class SimulationResultCard extends StatelessWidget {
  const SimulationResultCard({super.key, required this.result});

  final DeviceSimulateConfigResult result;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final conn = result.connectionCheck;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  result.passed ? Icons.check_circle : Icons.cancel,
                  color: result.passed ? Colors.green : scheme.error,
                ),
                const SizedBox(width: 8),
                Text(
                  result.passed ? 'พร้อมติดตั้ง' : 'ยังไม่พร้อมติดตั้ง',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
            const Divider(height: 24),
            _CheckBlock(
              label: 'Config',
              passed: result.configCheck.passed,
              details: result.configCheck.details,
            ),
            const SizedBox(height: 12),
            _CheckBlock(
              label: 'ความเข้ากันได้กับอุปกรณ์',
              passed: result.compatibilityCheck.passed,
              details: result.compatibilityCheck.details,
            ),
            const SizedBox(height: 12),
            _CheckBlock(
              label: 'สัญญาณอุปกรณ์',
              passed: conn.passed,
              details: [
                'แรงสัญญาณ: ${conn.signalStrength} dBm',
                ...conn.details,
              ],
            ),
          ],
        ),
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
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(
              passed ? Icons.check_circle_outline : Icons.cancel_outlined,
              size: 18,
              color: passed ? Colors.green : scheme.error,
            ),
            const SizedBox(width: 6),
            Text(
              '$label — ${passed ? 'ผ่าน' : 'ไม่ผ่าน'}',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ],
        ),
        for (final line in details)
          Padding(
            padding: const EdgeInsets.only(left: 24, top: 4),
            child: Text('• $line'),
          ),
      ],
    );
  }
}
