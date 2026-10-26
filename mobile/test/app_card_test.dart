import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/theme/app_tokens.dart';
import 'package:mobile/core/ui/app_card.dart';

Widget _wrap(Widget child, {bool disableAnimations = false}) => MaterialApp(
  home: MediaQuery(
    data: MediaQueryData(disableAnimations: disableAnimations),
    child: Scaffold(
      body: Padding(padding: const EdgeInsets.all(16), child: child),
    ),
  ),
);

/// กรอบของการ์ด = Material ตัวแรกใต้ AppCard
Material _surface(WidgetTester tester) => tester.widget<Material>(
  find
      .descendant(of: find.byType(AppCard), matching: find.byType(Material))
      .first,
);

BorderSide _side(WidgetTester tester) =>
    (_surface(tester).shape! as RoundedRectangleBorder).side;

/// เงาของการ์ด = กล่อง (AnimatedContainer) ที่ครอบ Material
List<BoxShadow>? _shadow(WidgetTester tester) {
  final box = tester.widget<Container>(
    find
        .descendant(of: find.byType(AppCard), matching: find.byType(Container))
        .first,
  );
  return (box.decoration! as BoxDecoration).boxShadow;
}

double _scale(WidgetTester tester) => tester
    .widget<AnimatedScale>(
      find.descendant(
        of: find.byType(AppCard),
        matching: find.byType(AnimatedScale),
      ),
    )
    .scale;

void main() {
  // docs/22 §4.6 — การ์ดแยกจากพื้นด้วยเงานุ่ม + ขอบจาง (ต่างจาก Web ที่ขอบบาง
  // foreground 20% ไม่มีเงา)
  group('การ์ดข้อมูลธรรมดา (ไม่มี onTap)', () {
    testWidgets('พื้น card ขอบจาง (border) เงานุ่ม AppShadows.card มุม xl', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap(const AppCard(child: Text('ข้อมูล'))));

      final surface = _surface(tester);
      expect(surface.color, AppColors.card);
      // เงาวาดที่กล่องครอบ ไม่ใช่ elevation ของ Material (ไม่มีเงาซ้อนสองชั้น)
      expect(surface.elevation, 0);
      final shape = surface.shape! as RoundedRectangleBorder;
      expect(shape.borderRadius, BorderRadius.circular(AppRadius.xl));
      expect(shape.side.width, 1);
      expect(shape.side.color, AppColors.border);
      expect(_shadow(tester), AppShadows.card);
    });

    testWidgets('padding 16 (ขนาดปกติ) และ 12 (ขนาดเล็ก)', (tester) async {
      await tester.pumpWidget(
        _wrap(const AppCard(child: SizedBox(key: Key('c'), height: 10))),
      );
      final outer = tester.getRect(find.byType(AppCard));
      final inner = tester.getRect(find.byKey(const Key('c')));
      expect(inner.left - outer.left, 16);
      expect(inner.top - outer.top, 16);

      await tester.pumpWidget(
        _wrap(
          const AppCard(
            size: AppCardSize.small,
            child: SizedBox(key: Key('c'), height: 10),
          ),
        ),
      );
      final outerSm = tester.getRect(find.byType(AppCard));
      final innerSm = tester.getRect(find.byKey(const Key('c')));
      expect(innerSm.left - outerSm.left, 12);
      expect(innerSm.top - outerSm.top, 12);
    });

    testWidgets('ไม่มี InkWell และไม่ถูกประกาศเป็นปุ่ม', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_wrap(const AppCard(child: Text('ข้อมูล'))));
      expect(
        find.descendant(
          of: find.byType(AppCard),
          matching: find.byType(InkWell),
        ),
        findsNothing,
      );
      expect(
        tester.getSemantics(find.text('ข้อมูล')),
        isNot(isSemantics(isButton: true)),
      );
      handle.dispose();
    });
  });

  group('การ์ดกดได้ (มี onTap)', () {
    testWidgets('กดแล้วเรียก onTap', (tester) async {
      var taps = 0;
      await tester.pumpWidget(
        _wrap(AppCard(onTap: () => taps++, child: const Text('งาน A'))),
      );
      await tester.tap(find.text('งาน A'));
      expect(taps, 1);
    });

    testWidgets(
      'ระหว่างกดค้าง เงาลอยขึ้น ขอบสี primary การ์ดยุบลงนิด ปล่อยแล้วกลับเหมือนเดิม',
      (tester) async {
        await tester.pumpWidget(
          _wrap(AppCard(onTap: () {}, child: const Text('งาน A'))),
        );
        expect(_side(tester).color, AppColors.border);
        expect(_shadow(tester), AppShadows.card);
        expect(_scale(tester), 1);

        final gesture = await tester.startGesture(
          tester.getCenter(find.text('งาน A')),
        );
        await tester.pump(const Duration(milliseconds: 200));
        await tester.pump(AppMotion.base);
        expect(_side(tester).color, AppCard.pressedBorder);
        expect(_shadow(tester), AppShadows.raised);
        expect(_scale(tester), AppCard.pressedScale);

        await gesture.up();
        await tester.pumpAndSettle();
        expect(_side(tester).color, AppColors.border);
        expect(_shadow(tester), AppShadows.card);
        expect(_scale(tester), 1);
      },
    );

    testWidgets(
      'ตั้งลดการเคลื่อนไหว -> กดค้างแล้วการ์ดไม่ยุบ (ขอบ/เงายังเปลี่ยน)',
      (tester) async {
        await tester.pumpWidget(
          _wrap(
            AppCard(onTap: () {}, child: const Text('งาน A')),
            disableAnimations: true,
          ),
        );
        final gesture = await tester.startGesture(
          tester.getCenter(find.text('งาน A')),
        );
        await tester.pump(const Duration(milliseconds: 200));
        await tester.pump(AppMotion.base);
        expect(_scale(tester), 1);
        expect(_side(tester).color, AppCard.pressedBorder);
        await gesture.up();
        await tester.pumpAndSettle();
      },
    );

    testWidgets('screen reader รู้ว่าเป็นปุ่ม', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(
        _wrap(AppCard(onTap: () {}, child: const Text('งาน A'))),
      );
      expect(_surface(tester).elevation, 0);
      expect(
        tester.getSemantics(find.byType(InkWell)),
        isSemantics(isButton: true, hasTapAction: true),
      );
      handle.dispose();
    });
  });
}
