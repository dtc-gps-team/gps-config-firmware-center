import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/theme/app_tokens.dart';
import 'package:mobile/core/ui/app_fade_in.dart';

Widget _wrap(Widget child, {bool disableAnimations = false}) => MaterialApp(
  home: MediaQuery(
    data: MediaQueryData(disableAnimations: disableAnimations),
    child: Scaffold(body: child),
  ),
);

double _opacity(WidgetTester tester) => tester
    .widget<FadeTransition>(
      find.descendant(
        of: find.byType(AppFadeIn),
        matching: find.byType(FadeTransition),
      ),
    )
    .opacity
    .value;

void main() {
  // docs/22 §4.6 — เนื้อหาที่เพิ่งโหลดเสร็จค่อยๆ ปรากฏแทนการโผล่ทันที
  testWidgets('เริ่มโปร่งใส แล้วทึบเต็มเมื่อครบเวลา', (tester) async {
    await tester.pumpWidget(_wrap(const AppFadeIn(child: Text('ข้อมูล'))));
    expect(_opacity(tester), 0);

    await tester.pump(AppMotion.base ~/ 2);
    expect(_opacity(tester), inExclusiveRange(0, 1));

    await tester.pumpAndSettle();
    expect(_opacity(tester), 1);
  });

  testWidgets('rebuild แล้วไม่เล่นซ้ำ (refresh ข้อมูลไม่กะพริบ)', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(const AppFadeIn(child: Text('รอบ 1'))));
    await tester.pumpAndSettle();

    await tester.pumpWidget(_wrap(const AppFadeIn(child: Text('รอบ 2'))));
    expect(_opacity(tester), 1);
    expect(tester.hasRunningAnimations, isFalse);
  });

  testWidgets('ตั้งลดการเคลื่อนไหว -> แสดงทันที ไม่มี animation', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(const AppFadeIn(child: Text('ข้อมูล')), disableAnimations: true),
    );
    expect(_opacity(tester), 1);
    expect(tester.hasRunningAnimations, isFalse);
  });

  testWidgets('กดเนื้อหาได้ตั้งแต่ยังจางอยู่', (tester) async {
    var taps = 0;
    await tester.pumpWidget(
      _wrap(
        AppFadeIn(
          child: Center(
            child: TextButton(onPressed: () => taps++, child: const Text('กด')),
          ),
        ),
      ),
    );
    await tester.tap(find.text('กด'));
    expect(taps, 1);
    await tester.pumpAndSettle();
  });
}
