import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';

/// แถบปุ่มหลักติดล่างของหน้าลูกตามภาพ r4 (R4-05 เป็นต้นไป) — ปุ่มอยู่ที่เดิมเสมอ
/// ไม่ต้องเลื่อนหาท้ายฟอร์ม · เว้น safe area ล่างเอง · [children] เรียงบนลงล่าง
/// (เช่น ข้อความ error แล้วปุ่ม) และยืดเต็มความกว้าง
class AppBottomActionBar extends StatelessWidget {
  const AppBottomActionBar({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      key: const Key('app_bottom_action_bar'),
      decoration: const BoxDecoration(
        color: AppColors.background,
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: children,
          ),
        ),
      ),
    );
  }
}

/// ปุ่มหลักของแถบล่าง — ระหว่างส่งขึ้น "กำลังส่ง…" บนพื้นเข้มเดิม (ภาพ r4 แบบ
/// `submitting`) แต่กดไม่ได้ กันส่งซ้ำ · [onPressed] `null` = กดไม่ได้ (พื้นเทา) ·
/// [buttonKey] ติดที่ [FilledButton] ข้างใน ให้เทสต์อ่าน `onPressed` ได้ตรงๆ
class AppSubmitButton extends StatelessWidget {
  const AppSubmitButton({
    super.key,
    this.buttonKey,
    required this.label,
    required this.onPressed,
    this.submitting = false,
  });

  final Key? buttonKey;
  final String label;
  final VoidCallback? onPressed;
  final bool submitting;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      key: buttonKey,
      onPressed: submitting ? null : onPressed,
      style: submitting
          ? FilledButton.styleFrom(
              disabledBackgroundColor: AppColors.primary,
              disabledForegroundColor: AppColors.primaryForeground,
            )
          : null,
      child: Text(submitting ? 'กำลังส่ง…' : label),
    );
  }
}
