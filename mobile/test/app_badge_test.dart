import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/theme/app_tokens.dart';
import 'package:mobile/core/ui/app_badge.dart';

Widget _wrap(Widget child) => MaterialApp(
  home: Scaffold(body: Center(child: child)),
);

/// พื้นของป้าย = DecoratedBox ตัวนอกสุดใต้ AppBadge
BoxDecoration _pill(WidgetTester tester) =>
    tester
            .widget<DecoratedBox>(
              find
                  .descendant(
                    of: find.byType(AppBadge),
                    matching: find.byType(DecoratedBox),
                  )
                  .first,
            )
            .decoration
        as BoxDecoration;

void main() {
  // docs/22 §5.1 — ค่าของแต่ละ tone ตาม web/src/components/ui/badge.tsx
  final expected = <AppBadgeTone, (Color, Color, Color)>{
    AppBadgeTone.neutral: (
      AppColors.secondary,
      AppColors.secondaryForeground.withValues(alpha: 0.8),
      AppColors.mutedForeground.withValues(alpha: 0.6),
    ),
    AppBadgeTone.success: (
      AppColors.successSubtle,
      AppColors.successForeground,
      AppColors.success,
    ),
    AppBadgeTone.warning: (
      AppColors.warningSubtle,
      AppColors.warningForeground,
      AppColors.warning,
    ),
    AppBadgeTone.danger: (
      AppColors.dangerSubtle,
      AppColors.dangerForeground,
      AppColors.destructive,
    ),
    AppBadgeTone.info: (
      AppColors.infoSubtle,
      AppColors.infoForeground,
      AppColors.info,
    ),
  };

  for (final MapEntry(key: tone, value: (bg, fg, dot)) in expected.entries) {
    group('tone ${tone.name}', () {
      testWidgets('สีพื้น ตัวอักษร ทรง rounded-full', (tester) async {
        await tester.pumpWidget(_wrap(AppBadge(label: 'Open', tone: tone)));

        final pill = _pill(tester);
        expect(pill.color, bg);
        expect(pill.borderRadius, BorderRadius.circular(AppRadius.full));

        final text = tester.widget<Text>(find.text('Open'));
        expect(text.style!.color, fg);
        expect(text.style!.fontSize, AppTypography.xs);
        expect(text.style!.fontWeight, FontWeight.w500);
      });

      testWidgets('มี dot: จุดสีของ tone ขนาด 6 อยู่หน้าข้อความ', (
        tester,
      ) async {
        await tester.pumpWidget(
          _wrap(AppBadge(label: 'Open', tone: tone, dot: true)),
        );

        final dotFinder = find.byKey(const Key('app_badge_dot'));
        expect(dotFinder, findsOneWidget);
        final dotBox = tester.widget<Container>(dotFinder);
        final deco = dotBox.decoration! as BoxDecoration;
        expect(deco.color, dot);
        expect(deco.shape, BoxShape.circle);
        expect(tester.getSize(dotFinder), const Size(6, 6));
        expect(
          tester.getCenter(dotFinder).dx,
          lessThan(tester.getCenter(find.text('Open')).dx),
        );
      });

      testWidgets('ไม่มี dot: ไม่มีจุด', (tester) async {
        await tester.pumpWidget(_wrap(AppBadge(label: 'Open', tone: tone)));
        expect(find.byKey(const Key('app_badge_dot')), findsNothing);
      });
    });
  }

  testWidgets('tone เริ่มต้นเป็น neutral และไม่มี dot (เหมือน Web)', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(const AppBadge(label: 'Config')));
    expect(_pill(tester).color, AppColors.secondary);
    expect(find.byKey(const Key('app_badge_dot')), findsNothing);
  });

  testWidgets('จุดเป็นของตกแต่ง screen reader อ่านแค่ข้อความ', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(
      _wrap(
        const AppBadge(
          label: 'Resolved',
          tone: AppBadgeTone.success,
          dot: true,
        ),
      ),
    );
    expect(find.bySemanticsLabel('Resolved'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(ExcludeSemantics),
        matching: find.byKey(const Key('app_badge_dot')),
      ),
      findsOneWidget,
    );
    handle.dispose();
  });

  testWidgets('ข้อความยาวในที่แคบไม่ล้น (ตัดด้วย … บรรทัดเดียว)', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        const SizedBox(
          width: 80,
          child: Align(
            alignment: Alignment.centerLeft,
            child: AppBadge(
              label: 'ยังไม่เคยอยู่ใน Rollout ยาวมากๆ',
              dot: true,
            ),
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    final text = tester.widget<Text>(
      find.text('ยังไม่เคยอยู่ใน Rollout ยาวมากๆ'),
    );
    expect(text.maxLines, 1);
    expect(text.overflow, TextOverflow.ellipsis);
  });
}
