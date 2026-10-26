import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';

/// ค่อยๆ ปรากฏ (จางเข้า + เลื่อนขึ้น [offset] px) ครั้งเดียวตอนสร้าง — ใช้ครอบ
/// เนื้อหาที่เพิ่งโหลดเสร็จแทนการโผล่มาทันทีจาก skeleton ให้แอปรู้สึกลื่นขึ้น
///
/// - เล่นครั้งเดียวต่อการสร้าง widget: rebuild (เช่น refresh ข้อมูลแล้วยังอยู่ใน
///   `data:` เดิม) ไม่เล่นซ้ำ · ครอบทั้งรายการ ไม่ใช่ทีละแถว (แถวใน ListView ถูก
///   สร้างใหม่ตอนเลื่อน จะกะพริบซ้ำ)
/// - ตั้งลดการเคลื่อนไหวในเครื่อง (`disableAnimations`) = แสดงทันที
/// - ไม่บังการกด (Opacity / Transform ไม่ตัด hit test)
class AppFadeIn extends StatefulWidget {
  const AppFadeIn({
    super.key,
    required this.child,
    this.duration = AppMotion.base,
    this.offset = 8,
  });

  final Widget child;
  final Duration duration;

  /// ระยะที่เลื่อนขึ้นมา (px) — 0 = จางเข้าอย่างเดียว
  final double offset;

  @override
  State<AppFadeIn> createState() => _AppFadeInState();
}

class _AppFadeInState extends State<AppFadeIn>
    with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(
    vsync: this,
    duration: widget.duration,
  );
  late final _curve = CurvedAnimation(
    parent: _controller,
    curve: AppMotion.curve,
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.of(context).disableAnimations) {
      _controller.value = 1;
    } else if (_controller.status == AnimationStatus.dismissed) {
      _controller.forward();
    }
  }

  @override
  void dispose() {
    _curve.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _curve,
      child: AnimatedBuilder(
        animation: _curve,
        builder: (context, child) => Transform.translate(
          offset: Offset(0, widget.offset * (1 - _curve.value)),
          child: child,
        ),
        child: widget.child,
      ),
    );
  }
}
