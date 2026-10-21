import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/theme/app_tokens.dart';
import 'package:mobile/core/ui/app_badge.dart';
import 'package:mobile/core/ui/app_field_label.dart';
import 'package:mobile/core/ui/app_notice.dart';
import 'package:mobile/core/ui/app_sensitive_value.dart';
import 'package:mobile/core/ui/app_v2_theme.dart';
import 'package:mobile/core/ui/labels.dart';

// docs/22 Batch 4 — component กลางที่สร้างเพิ่ม (§7.1) + label ของอุปกรณ์ (§6.1)

Widget _wrap(Widget child) => MaterialApp(
  home: Scaffold(
    body: AppV2Theme(child: Center(child: child)),
  ),
);

double _contrast(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final hi = la > lb ? la : lb;
  final lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

void main() {
  group('AppNotice', () {
    BoxDecoration decorationOf(WidgetTester tester) =>
        tester
                .widget<Container>(
                  find
                      .descendant(
                        of: find.byType(AppNotice),
                        matching: find.byType(Container),
                      )
                      .first,
                )
                .decoration!
            as BoxDecoration;

    for (final tone in AppBadgeTone.values) {
      testWidgets('tone $tone: พื้น subtle ของ tone + ตัวอักษรผ่าน 4.5:1', (
        tester,
      ) async {
        await tester.pumpWidget(
          _wrap(AppNotice(tone: tone, child: const Text('ข้อความ'))),
        );
        final bg = decorationOf(tester).color!;
        expect(bg, tone.style.background);
        final text = tester.widget<RichText>(
          find.descendant(
            of: find.text('ข้อความ'),
            matching: find.byType(RichText),
          ),
        );
        final fg = text.text.style!.color!;
        expect(_contrast(fg, bg), greaterThanOrEqualTo(4.5));
      });
    }

    testWidgets('title ตัวหนา + child ใต้ title', (tester) async {
      await tester.pumpWidget(
        _wrap(
          const AppNotice(
            tone: AppBadgeTone.warning,
            title: 'หัวข้อ',
            child: Text('รายละเอียด'),
          ),
        ),
      );
      expect(
        tester.getTopLeft(find.text('รายละเอียด')).dy,
        greaterThan(tester.getTopLeft(find.text('หัวข้อ')).dy),
      );
    });

    testWidgets('icon นำหน้า ไม่ถูกอ่านซ้ำโดย screen reader', (tester) async {
      await tester.pumpWidget(
        _wrap(const AppNotice(icon: Icons.hourglass_top, title: 'รออนุมัติ')),
      );
      expect(find.byIcon(Icons.hourglass_top), findsOneWidget);
      expect(
        find.ancestor(
          of: find.byIcon(Icons.hourglass_top),
          matching: find.byType(ExcludeSemantics),
        ),
        findsWidgets,
      );
    });

    test('ไม่มีทั้ง title และ child -> assert', () {
      expect(() => AppNotice(), throwsAssertionError);
    });

    testWidgets('AppErrorDetails: ข้อความหลัก + bullet ทุกข้อ', (tester) async {
      await tester.pumpWidget(
        _wrap(
          const AppNotice(
            tone: AppBadgeTone.danger,
            child: AppErrorDetails(
              message: 'ส่งไม่สำเร็จ',
              details: ['a', 'b'],
            ),
          ),
        ),
      );
      expect(find.text('ส่งไม่สำเร็จ'), findsOneWidget);
      expect(find.text('• a'), findsOneWidget);
      expect(find.text('• b'), findsOneWidget);
    });
  });

  group('AppFieldLabel', () {
    testWidgets('ข้อความหลัก + hint สีเทา อ่านเป็นข้อความเดียว', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(const AppFieldLabel('หัวข้อปัญหา', hint: '(บังคับ)')),
      );
      expect(find.text('หัวข้อปัญหา (บังคับ)'), findsOneWidget);
      final label = tester.widget<Text>(find.byType(Text));
      expect(label.style!.color, AppColors.foreground);
      final span = label.textSpan! as TextSpan;
      expect(
        (span.children!.single as TextSpan).style!.color,
        AppColors.mutedForeground,
      );
    });
  });

  group('AppSensitiveValue', () {
    testWidgets('ซ่อนเป็นค่าเริ่มต้น กดแล้วเรียก onToggle', (tester) async {
      var toggled = 0;
      await tester.pumpWidget(
        _wrap(
          AppSensitiveValue(
            value: '123456',
            revealed: false,
            onToggle: () => toggled++,
          ),
        ),
      );
      expect(find.text(AppSensitiveValue.masked), findsOneWidget);
      expect(find.text('123456'), findsNothing);
      await tester.tap(find.byType(IconButton));
      expect(toggled, 1);
    });

    testWidgets('revealed -> แสดงค่าจริง', (tester) async {
      await tester.pumpWidget(
        _wrap(
          AppSensitiveValue(value: '123456', revealed: true, onToggle: () {}),
        ),
      );
      expect(find.text('123456'), findsOneWidget);
    });

    testWidgets('ปุ่มรูปตามี tooltip และพื้นที่กด ≥ 48 (docs/21 #20)', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(AppRevealToggle(revealed: false, onPressed: () {})),
      );
      expect(find.byTooltip('แสดงค่า'), findsOneWidget);
      final size = tester.getSize(find.byType(IconButton));
      expect(size.width, greaterThanOrEqualTo(48));
      expect(size.height, greaterThanOrEqualTo(48));

      await tester.pumpWidget(
        _wrap(AppRevealToggle(revealed: true, onPressed: () {})),
      );
      expect(find.byTooltip('ซ่อนค่า'), findsOneWidget);
    });
  });

  group('labels ของอุปกรณ์ (docs/22 §6.1)', () {
    test('Device lifecycle: อังกฤษตัวแรกพิมพ์ใหญ่ตาม Web ครบทุกค่า', () {
      expect(
        {for (final s in DeviceLifecycleStatus.values) deviceLifecycleLabel(s)},
        {'Registered', 'Installed', 'Decommissioned'},
      );
    });

    test('payload status: ไทยตาม Web, pending แยกตามชนิด payload', () {
      expect(
        devicePayloadLabel(DevicePayloadStatus.upToDate, firmware: false),
        'เป็นปัจจุบัน',
      );
      expect(
        devicePayloadLabel(DevicePayloadStatus.pending, firmware: false),
        'รอรับ Config',
      );
      expect(
        devicePayloadLabel(DevicePayloadStatus.pending, firmware: true),
        'รอติดตั้ง Firmware',
      );
      expect(
        devicePayloadLabel(DevicePayloadStatus.failed, firmware: true),
        'ล้มเหลว',
      );
      expect(
        devicePayloadLabel(DevicePayloadStatus.unknown, firmware: false),
        'ยังไม่เคยอยู่ใน Rollout',
      );
    });
  });
}
