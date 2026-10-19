import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/theme/app_tokens.dart';
import 'package:mobile/core/ui/app_card.dart';

Widget _wrap(Widget child) => MaterialApp(
  home: Scaffold(
    body: Padding(padding: const EdgeInsets.all(16), child: child),
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

void main() {
  group('การ์ดข้อมูลธรรมดา (ไม่มี onTap)', () {
    testWidgets('พื้น card ขอบบาง foreground 20% ไม่มีเงา มุม 10', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap(const AppCard(child: Text('ข้อมูล'))));

      final surface = _surface(tester);
      expect(surface.color, AppColors.card);
      expect(surface.elevation, 0);
      final shape = surface.shape! as RoundedRectangleBorder;
      expect(shape.borderRadius, BorderRadius.circular(AppRadius.lg));
      expect(shape.side.width, 1);
      expect(shape.side.color, AppColors.foreground.withValues(alpha: 0.2));
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
      'ระหว่างกดค้าง ขอบเข้มขึ้นเป็น 40% (แทน hover ของ Web) ปล่อยแล้วกลับ 20%',
      (tester) async {
        await tester.pumpWidget(
          _wrap(AppCard(onTap: () {}, child: const Text('งาน A'))),
        );
        expect(
          _side(tester).color,
          AppColors.foreground.withValues(alpha: 0.2),
        );

        final gesture = await tester.startGesture(
          tester.getCenter(find.text('งาน A')),
        );
        await tester.pump(const Duration(milliseconds: 200));
        expect(
          _side(tester).color,
          AppColors.foreground.withValues(alpha: 0.4),
        );

        await gesture.up();
        await tester.pumpAndSettle();
        expect(
          _side(tester).color,
          AppColors.foreground.withValues(alpha: 0.2),
        );
      },
    );

    testWidgets('ยังไม่มีเงาแม้กดได้ และ screen reader รู้ว่าเป็นปุ่ม', (
      tester,
    ) async {
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
