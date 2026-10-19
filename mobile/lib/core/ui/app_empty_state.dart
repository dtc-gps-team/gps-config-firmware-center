import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';

/// สถานะ "ไม่มีข้อมูล" ของหน้า list แบบ `EmptyState` ของ Web
/// (`web/src/components/empty-state.tsx`, docs/22 §7.1) — icon + ข้อความ +
/// ปุ่ม action ชวนทำขั้นต่อไป (ถ้ามี) แทนข้อความลอยๆ
///
/// icon สี `mutedForeground` 40% ขนาด 32 · ข้อความ `sm` สี `mutedForeground`
/// · ระยะบนล่าง 32 (`py-8`) ช่องว่างระหว่างส่วน 12 (`gap-3`)
class AppEmptyState extends StatelessWidget {
  const AppEmptyState({
    super.key,
    required this.icon,
    required this.message,
    this.action,
    this.messageKey,
  });

  final IconData icon;
  final String message;

  /// ปุ่มชวนทำขั้นต่อไป เช่น "รีเฟรช" — ไม่ใส่ถ้าไม่มีอะไรให้ทำ
  final Widget? action;

  /// ให้หน้าที่ใช้คง `Key` เดิมที่เทสอ้างถึงได้ (แบบเดียวกับ `AppErrorView`)
  final Key? messageKey;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ExcludeSemantics(
            child: Icon(
              icon,
              size: 32,
              color: AppColors.mutedForeground.withValues(alpha: 0.4),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            message,
            key: messageKey,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: AppTypography.sm,
              height: AppTypography.smHeight,
              color: AppColors.mutedForeground,
            ),
          ),
          if (action != null) ...[const SizedBox(height: 12), action!],
        ],
      ),
    );
  }
}
