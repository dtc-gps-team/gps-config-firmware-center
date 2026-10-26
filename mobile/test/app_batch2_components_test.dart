import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/core/theme/app_tokens.dart';
import 'package:mobile/core/ui/app_card.dart';
import 'package:mobile/core/ui/app_empty_state.dart';
import 'package:mobile/core/ui/app_info_row.dart';
import 'package:mobile/core/ui/app_skeleton.dart';
import 'package:mobile/core/ui/app_v2_theme.dart';
import 'package:mobile/core/ui/labels.dart';
import 'package:mobile/core/widgets/app_error_view.dart';

// docs/22 Batch 2 — component กลางที่สร้างเพิ่ม (§7.1) + ตัวครอบ theme v2

Widget _wrap(Widget child, {bool v2 = true}) => MaterialApp(
  home: Scaffold(
    body: v2 ? AppV2Theme(child: Center(child: child)) : Center(child: child),
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
  group('AppV2Theme', () {
    testWidgets('ใส่ theme v2 + status bar ไอคอนเข้ม + isActive', (
      tester,
    ) async {
      late BuildContext inner;
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light(),
          home: AppV2Theme(
            child: Builder(
              builder: (context) {
                inner = context;
                return const SizedBox();
              },
            ),
          ),
        ),
      );
      expect(Theme.of(inner).colorScheme.primary, AppColors.primary);
      expect(Theme.of(inner).scaffoldBackgroundColor, AppColors.background);
      expect(AppV2Theme.isActive(inner), isTrue);
      final region = tester.widget<AnnotatedRegion<SystemUiOverlayStyle>>(
        find.byType(AnnotatedRegion<SystemUiOverlayStyle>),
      );
      expect(region.value, SystemUiOverlayStyle.dark);
    });

    testWidgets('นอก AppV2Theme -> isActive false', (tester) async {
      late BuildContext ctx;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              ctx = context;
              return const SizedBox();
            },
          ),
        ),
      );
      expect(AppV2Theme.isActive(ctx), isFalse);
    });
  });

  group('AppErrorView ปรับสีตามหน้า', () {
    Color iconColor(WidgetTester tester) =>
        tester.widget<Icon>(find.byIcon(Icons.error_outline)).color!;

    testWidgets('ในหน้า v2 -> สีจาก token', (tester) async {
      await tester.pumpWidget(
        _wrap(AppErrorView(message: 'โหลดไม่สำเร็จ', onRetry: () {})),
      );
      expect(iconColor(tester), AppColors.destructive.withValues(alpha: 0.7));
      expect(
        tester.widget<Text>(find.text('โหลดไม่สำเร็จ')).style!.color,
        AppColors.mutedForeground,
      );
    });

    testWidgets('หน้าที่ยังไม่ย้าย -> สีเดิมทุกอย่าง', (tester) async {
      await tester.pumpWidget(
        _wrap(
          AppErrorView(message: 'โหลดไม่สำเร็จ', onRetry: () {}),
          v2: false,
        ),
      );
      expect(iconColor(tester), AppTheme.error.withValues(alpha: 0.7));
      expect(
        tester.widget<Text>(find.text('โหลดไม่สำเร็จ')).style!.color,
        AppTheme.textSecondary,
      );
    });

    testWidgets('กดลองอีกครั้งได้ทั้งสองแบบ', (tester) async {
      var retries = 0;
      await tester.pumpWidget(
        _wrap(AppErrorView(message: 'x', onRetry: () => retries++)),
      );
      await tester.tap(find.text('ลองอีกครั้ง'));
      expect(retries, 1);
    });
  });

  group('AppCard.highlighted (แถวที่ยังไม่อ่าน)', () {
    Color surfaceColor(WidgetTester tester) => tester
        .widget<Material>(
          find
              .descendant(
                of: find.byType(AppCard),
                matching: find.byType(Material),
              )
              .first,
        )
        .color!;

    testWidgets('highlighted -> พื้น accent', (tester) async {
      await tester.pumpWidget(
        _wrap(const AppCard(highlighted: true, child: Text('x'))),
      );
      expect(surfaceColor(tester), AppColors.accent);
    });

    testWidgets('ค่าเริ่มต้น -> พื้น card', (tester) async {
      await tester.pumpWidget(_wrap(const AppCard(child: Text('x'))));
      expect(surfaceColor(tester), AppColors.card);
    });

    test('ข้อความหลักบนพื้น accent ยังผ่าน 4.5:1', () {
      expect(
        _contrast(AppColors.foreground, AppColors.accent),
        greaterThanOrEqualTo(4.5),
      );
      expect(
        _contrast(AppColors.mutedForeground, AppColors.accent),
        greaterThanOrEqualTo(4.5),
      );
    });
  });

  group('AppEmptyState', () {
    testWidgets('icon + ข้อความสี mutedForeground', (tester) async {
      await tester.pumpWidget(
        _wrap(
          const AppEmptyState(
            icon: Icons.inbox_outlined,
            message: 'ยังไม่มีข้อมูล',
            messageKey: Key('empty_msg'),
          ),
        ),
      );
      final icon = tester.widget<Icon>(find.byIcon(Icons.inbox_outlined));
      expect(icon.size, 32);
      expect(icon.color, AppColors.mutedForeground.withValues(alpha: 0.4));
      final text = tester.widget<Text>(find.byKey(const Key('empty_msg')));
      expect(text.data, 'ยังไม่มีข้อมูล');
      expect(text.style!.color, AppColors.mutedForeground);
      expect(text.style!.fontSize, AppTypography.sm);
    });

    testWidgets('มีปุ่ม action -> แสดงใต้ข้อความ กดได้', (tester) async {
      var taps = 0;
      await tester.pumpWidget(
        _wrap(
          AppEmptyState(
            icon: Icons.inbox_outlined,
            message: 'ยังไม่มีข้อมูล',
            action: OutlinedButton(
              onPressed: () => taps++,
              child: const Text('รีเฟรช'),
            ),
          ),
        ),
      );
      expect(
        tester.getTopLeft(find.text('รีเฟรช')).dy,
        greaterThan(tester.getBottomLeft(find.text('ยังไม่มีข้อมูล')).dy),
      );
      await tester.tap(find.text('รีเฟรช'));
      expect(taps, 1);
    });

    testWidgets('ไม่มี action -> ไม่มีปุ่ม', (tester) async {
      await tester.pumpWidget(
        _wrap(const AppEmptyState(icon: Icons.inbox_outlined, message: 'x')),
      );
      expect(find.byType(ButtonStyleButton), findsNothing);
    });
  });

  group('AppInfoRow', () {
    testWidgets('label สีเทาซ้าย ค่าสีเข้มชิดขวา', (tester) async {
      await tester.pumpWidget(
        _wrap(
          const SizedBox(
            width: 320,
            child: AppInfoRow(
              label: 'ผู้แจ้ง',
              value: 'st.demo',
              valueKey: Key('v'),
            ),
          ),
        ),
      );
      final label = tester.widget<Text>(find.text('ผู้แจ้ง'));
      expect(label.style!.color, AppColors.mutedForeground);
      final value = tester.widget<Text>(find.byKey(const Key('v')));
      expect(value.style!.color, AppColors.foreground);
      // อยู่บรรทัดเดียวกับ label ชิดขวา (เว้น caretInset ให้ตรงกับค่าที่เลือกได้)
      expect(
        tester.getTopRight(find.byKey(const Key('v'))).dx,
        closeTo(
          tester.getTopRight(find.byType(AppInfoRow)).dx -
              AppInfoRow.caretInset,
          0.5,
        ),
      );
      expect(
        tester.getTopLeft(find.byKey(const Key('v'))).dy,
        closeTo(tester.getTopLeft(find.text('ผู้แจ้ง')).dy, 0.5),
      );
    });

    testWidgets('ค่า null / ว่าง -> "-"', (tester) async {
      await tester.pumpWidget(
        _wrap(
          const Column(
            children: [
              AppInfoRow(label: 'a', value: null),
              AppInfoRow(label: 'b', value: ''),
            ],
          ),
        ),
      );
      expect(find.text('-'), findsNWidgets(2));
    });

    testWidgets('selectable -> SelectableText', (tester) async {
      await tester.pumpWidget(
        _wrap(
          const SizedBox(
            width: 320,
            child: AppInfoRow(label: 'id', value: 'cfg-1', selectable: true),
          ),
        ),
      );
      expect(find.byType(SelectableText), findsOneWidget);
    });

    testWidgets('child เป็น widget เอง (เช่นลิงก์) + icon หน้า label', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(
          const SizedBox(
            width: 320,
            child: AppInfoRow(
              label: 'อุปกรณ์',
              icon: Icons.memory,
              child: Text('DEV-1', key: Key('link')),
            ),
          ),
        ),
      );
      expect(find.byKey(const Key('link')), findsOneWidget);
      expect(find.byIcon(Icons.memory), findsOneWidget);
    });

    test('ส่งทั้ง value และ child -> assert', () {
      expect(
        () => AppInfoRow(label: 'x', value: 'a', child: const Text('b')),
        throwsA(isA<AssertionError>()),
      );
    });

    testWidgets('label ยาว + ค่าสั้น -> label บรรทัดเดียว ไม่ถูกบีบ', (
      tester,
    ) async {
      // font ทดสอบกว้างตัวละ fontSize: label 330 + ค่า "-" พอดีใน 400 แต่ 2/5 ของ
      // 400 (แบบเดิม) ไม่พอ
      await tester.pumpWidget(
        _wrap(
          const SizedBox(
            width: 400,
            child: Column(
              children: [
                AppInfoRow(label: 'ID', value: '-'),
                AppInfoRow(
                  label: 'Firmware ที่เกี่ยวข้อง',
                  value: '-',
                  valueKey: Key('fw'),
                ),
              ],
            ),
          ),
        ),
      );
      final oneLine = tester.getSize(find.text('ID')).height;
      expect(
        tester.getSize(find.text('Firmware ที่เกี่ยวข้อง')).height,
        oneLine,
      );
      // ค่ายังอยู่บรรทัดเดียวกับ label
      expect(
        tester.getTopLeft(find.byKey(const Key('fw'))).dy,
        closeTo(tester.getTopLeft(find.text('Firmware ที่เกี่ยวข้อง')).dy, 0.5),
      );
    });

    testWidgets('ค่าไม่พอที่ข้าง label -> ขึ้นบรรทัดใหม่ใต้ label', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(
          const SizedBox(
            width: 400,
            child: AppInfoRow(
              label: 'Firmware ที่เกี่ยวข้อง',
              value: 'GT06N-v2.4.1-build-20261019-hotfix',
              valueKey: Key('fw'),
            ),
          ),
        ),
      );
      final label = tester.getRect(find.text('Firmware ที่เกี่ยวข้อง'));
      final value = tester.getRect(find.byKey(const Key('fw')));
      expect(value.top, greaterThanOrEqualTo(label.bottom));
      expect(tester.takeException(), isNull);
    });

    testWidgets('ค่าที่เลือกได้กับค่าธรรมดา ขอบขวาของตัวอักษรตรงกัน', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(
          const SizedBox(
            width: 400,
            child: Column(
              children: [
                AppInfoRow(label: 'id', value: 'cfg-1', selectable: true),
                AppInfoRow(
                  label: 'ผู้แจ้ง',
                  value: 'st.demo',
                  valueKey: Key('v'),
                ),
              ],
            ),
          ),
        ),
      );
      // ปลายตัวอักษรตัวสุดท้ายของ SelectableText (ไม่รวมที่กันไว้ให้ cursor)
      final editable = tester.allRenderObjects
          .whereType<RenderEditable>()
          .single;
      final boxes = editable.getBoxesForSelection(
        const TextSelection(baseOffset: 0, extentOffset: 'cfg-1'.length),
      );
      final selectableEnd = editable
          .localToGlobal(Offset(boxes.last.right, 0))
          .dx;
      final plainEnd = tester.getTopRight(find.byKey(const Key('v'))).dx;
      expect(selectableEnd, closeTo(plainEnd, 0.5));
    });

    testWidgets('ค่ายาวบนจอแคบตัดบรรทัด ไม่ล้น', (tester) async {
      await tester.pumpWidget(
        _wrap(
          const SizedBox(
            width: 200,
            child: AppInfoRow(
              label: 'Firmware ที่เกี่ยวข้อง',
              value: 'fw-0123456789abcdef-0123456789abcdef',
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
    });
  });

  group('skeleton', () {
    testWidgets('AppListSkeleton: การ์ด count ใบ แต่ละใบ 3 แถบ', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap(const AppListSkeleton(count: 2)));
      expect(find.byType(AppCard), findsNWidgets(2));
      expect(find.byType(AppSkeletonBox), findsNWidgets(6));
    });

    testWidgets('AppDetailSkeleton: หัวข้อ + lines บรรทัด', (tester) async {
      await tester.pumpWidget(_wrap(const AppDetailSkeleton(lines: 3)));
      expect(find.byType(AppSkeletonBox), findsNWidgets(4));
    });

    // docs/22 §4.6 — shimmer แทนการกะพริบ: พื้น muted มีแถบ shimmerHighlight วิ่งผ่าน
    testWidgets('กล่อง muted มุม md มีแถบ shimmer วิ่งจากซ้ายไปขวา', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(const SizedBox(width: 200, child: AppSkeletonBox(height: 16))),
      );
      BoxDecoration deco() =>
          tester
                  .widget<Container>(
                    find.descendant(
                      of: find.byType(AppSkeletonBox),
                      matching: find.byType(Container),
                    ),
                  )
                  .decoration!
              as BoxDecoration;

      expect(deco().borderRadius, BorderRadius.circular(AppRadius.md));
      final gradient = deco().gradient! as LinearGradient;
      expect(gradient.colors, [
        AppColors.muted,
        AppColors.shimmerHighlight,
        AppColors.muted,
      ]);
      Matrix4 shift() => (deco().gradient! as LinearGradient).transform!
          .transform(const Rect.fromLTWH(0, 0, 200, 16))!;
      final start = shift().getTranslation().x;
      await tester.pump(AppMotion.shimmer ~/ 2);
      expect(shift().getTranslation().x, greaterThan(start));
      expect(tester.hasRunningAnimations, isTrue);
    });

    testWidgets('screen reader อ่านว่า "กำลังโหลด" ไม่อ่านกล่องทีละอัน', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_wrap(const AppListSkeleton()));
      expect(find.bySemanticsLabel('กำลังโหลด'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('ตั้งลดการเคลื่อนไหว -> กล่องนิ่งสี muted ไม่มี shimmer', (
      tester,
    ) async {
      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: _wrap(
            const SizedBox(width: 200, child: AppSkeletonBox(height: 16)),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 500));
      final box = tester.widget<Container>(
        find.descendant(
          of: find.byType(AppSkeletonBox),
          matching: find.byType(Container),
        ),
      );
      final deco = box.decoration! as BoxDecoration;
      expect(deco.color, AppColors.muted);
      expect(deco.gradient, isNull);
      expect(tester.hasRunningAnimations, isFalse);
    });
  });

  group('labels (docs/22 §6.1)', () {
    test('Incident status ครบทุกค่า ไม่ว่าง ไม่ซ้ำ', () {
      final labels = IncidentStatus.values.map(incidentStatusLabel).toList();
      expect(labels.every((l) => l.trim().isNotEmpty), isTrue);
      expect(labels.toSet(), hasLength(IncidentStatus.values.length));
      expect(incidentStatusLabel(IncidentStatus.open), 'Open');
      expect(incidentStatusLabel(IncidentStatus.dismissed), 'ไม่ต้องดำเนินการ');
    });

    test('Incident severity ครบทุกค่า ตัวแรกพิมพ์ใหญ่', () {
      for (final s in IncidentSeverity.values) {
        final l = incidentSeverityLabel(s);
        expect(l[0], l[0].toUpperCase(), reason: '$s');
      }
    });
  });
}
