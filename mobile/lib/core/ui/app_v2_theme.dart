import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/app_theme.dart';

/// ครอบหน้าที่ย้ายไป design system ใหม่แล้ว (docs/22 §9 — Batch 2–5 ครอบ theme
/// ใหม่ทีละหน้า สลับทั้งแอปใน Batch 6) ทำ 3 อย่าง:
/// - ใส่ [AppTheme.v2] ให้ทั้งหน้า
/// - ไอคอน status bar สีเข้ม — หน้าใหม่ไม่มี AppBar สีกรมท่าแล้ว พื้นบนสุดเป็นสีอ่อน
/// - เป็นตัวบอก widget กลางที่หน้าเก่าก็ใช้ (เช่น `AppErrorView`) ว่าอยู่ในหน้า v2
///   ให้ใช้สีจาก token แทนสีเดิม ผ่าน [AppV2Theme.isActive] — หน้าที่ยังไม่ย้าย
///   หน้าตาไม่เปลี่ยน
class AppV2Theme extends StatelessWidget {
  const AppV2Theme({super.key, required this.child});

  final Widget child;

  /// อยู่ใต้ [AppV2Theme] หรือไม่
  static bool isActive(BuildContext context) =>
      context.getInheritedWidgetOfExactType<_AppV2Marker>() != null;

  @override
  Widget build(BuildContext context) {
    return _AppV2Marker(
      child: Theme(
        data: AppTheme.v2(),
        child: AnnotatedRegion<SystemUiOverlayStyle>(
          value: SystemUiOverlayStyle.dark,
          child: child,
        ),
      ),
    );
  }
}

class _AppV2Marker extends InheritedWidget {
  const _AppV2Marker({required super.child});

  @override
  bool updateShouldNotify(_AppV2Marker oldWidget) => false;
}
