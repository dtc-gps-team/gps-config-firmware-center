import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';

/// หัวช่องกรอกในฟอร์ม แบบ `Label` ของ Web (`web/src/components/ui/label.tsx`:
/// `text-sm font-medium`) — ใช้แทน `Text(..., style: TextStyle(fontWeight: w600))`
/// ที่แต่ละหน้าฟอร์มเขียนเอง · [hint] ส่วนท้ายสีเทา เช่น "(บังคับ)" / "(ไม่บังคับ)"
/// แบบ `<span className="text-muted-foreground">` ของ Web
class AppFieldLabel extends StatelessWidget {
  const AppFieldLabel(this.text, {super.key, this.hint});

  final String text;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    const base = TextStyle(
      fontSize: AppTypography.sm,
      height: AppTypography.smHeight,
      fontWeight: FontWeight.w500,
      color: AppColors.foreground,
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text.rich(
        TextSpan(
          text: text,
          children: [
            if (hint != null)
              TextSpan(
                text: ' $hint',
                style: const TextStyle(
                  fontWeight: FontWeight.w400,
                  color: AppColors.mutedForeground,
                ),
              ),
          ],
        ),
        style: base,
      ),
    );
  }
}
