import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';

/// ค่าที่เปิดซ่อนได้ (`sensitive` ของ Config field) แบบ `SensitiveValue` ของ Web
/// (docs/22 §7.1) — **ซ่อนเป็นค่าเริ่มต้น** กดปุ่มรูปตาเพื่อแสดง · `sensitive` เป็นแค่
/// flag การแสดงผล ไม่ใช่การเข้ารหัส (ค่าจริงอยู่ในเครื่องแล้ว)
///
/// ใช้กับค่าที่อ่านอย่างเดียว · ช่องกรอกที่เป็นค่าลับใช้ `obscureText` + [AppRevealToggle]
/// เป็น `suffixIcon` แทน · สถานะเปิด/ปิดเก็บที่หน้า (หน้าเดิมเก็บรายช่องไว้แล้ว) widget
/// นี้ไม่ถือ state เอง
class AppSensitiveValue extends StatelessWidget {
  const AppSensitiveValue({
    super.key,
    required this.value,
    required this.revealed,
    required this.onToggle,
    this.style,
  });

  /// ค่าที่จะแสดงเมื่อเปิด
  final String value;
  final bool revealed;
  final VoidCallback onToggle;
  final TextStyle? style;

  /// ตัวแทนค่าที่ซ่อน — ความยาวคงที่ ไม่บอกความยาวของค่าจริง
  static const masked = '••••••';

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Flexible(
          child: Text(
            revealed ? value : masked,
            overflow: TextOverflow.ellipsis,
            style: style,
          ),
        ),
        AppRevealToggle(revealed: revealed, onPressed: onToggle),
      ],
    );
  }
}

/// ปุ่มรูปตาเปิด/ปิดค่าลับ — มี tooltip และ label ให้ screen reader ("แสดงค่า" /
/// "ซ่อนค่า") และพื้นที่กด 48 (ปิด docs/21 ข้อ #20 ที่ปุ่มเดิมไม่มี label และกดยาก)
class AppRevealToggle extends StatelessWidget {
  const AppRevealToggle({
    super.key,
    required this.revealed,
    required this.onPressed,
  });

  final bool revealed;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onPressed,
      tooltip: revealed ? 'ซ่อนค่า' : 'แสดงค่า',
      iconSize: 18,
      color: AppColors.mutedForeground,
      icon: Icon(
        revealed ? Icons.visibility_off_outlined : Icons.visibility_outlined,
      ),
    );
  }
}
