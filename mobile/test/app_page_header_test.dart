import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/core/theme/app_tokens.dart';
import 'package:mobile/core/ui/app_badge.dart';
import 'package:mobile/core/ui/app_page_header.dart';

Widget _wrap(Widget child) => MaterialApp(
  theme: AppTheme.v2(),
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

void main() {
  testWidgets('title เป็นหัวข้อ (header) ตัว 2xl semibold', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(_wrap(const AppPageHeader(title: 'Incidents')));

    final title = tester.widget<Text>(find.text('Incidents'));
    expect(title.style!.fontSize, AppTypography.xxl);
    expect(title.style!.fontWeight, FontWeight.w600);
    expect(
      tester.getSemantics(find.text('Incidents')),
      isSemantics(isHeader: true),
    );
    handle.dispose();
  });

  testWidgets('status (Badge) อยู่แถวเดียวกับ title ต่อท้ายชื่อ', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        const AppPageHeader(
          title: 'รายละเอียด Incident',
          status: AppBadge(label: 'Open', tone: AppBadgeTone.danger, dot: true),
        ),
      ),
    );
    expect(find.byType(AppBadge), findsOneWidget);
    final title = tester.getRect(find.text('รายละเอียด Incident'));
    final badge = tester.getRect(find.byType(AppBadge));
    expect(badge.left, greaterThan(title.left));
    expect(badge.center.dy, closeTo(title.center.dy, title.height));
  });

  testWidgets('description ใต้ชื่อ สี mutedForeground ขนาด sm', (tester) async {
    await tester.pumpWidget(
      _wrap(
        const AppPageHeader(
          title: 'Device Search',
          description: 'ค้นหาอุปกรณ์ด้วยเลขเครื่องหรือ IMEI',
        ),
      ),
    );
    final desc = tester.widget<Text>(
      find.text('ค้นหาอุปกรณ์ด้วยเลขเครื่องหรือ IMEI'),
    );
    expect(desc.style!.color, AppColors.mutedForeground);
    expect(desc.style!.fontSize, AppTypography.sm);
    expect(
      tester.getTopLeft(find.text('ค้นหาอุปกรณ์ด้วยเลขเครื่องหรือ IMEI')).dy,
      greaterThan(tester.getBottomLeft(find.text('Device Search')).dy - 1),
    );
  });

  testWidgets('meta: label สีเทา + value ตัวหนา ครบทุกคู่', (tester) async {
    await tester.pumpWidget(
      _wrap(
        const AppPageHeader(
          title: 'รายละเอียดอุปกรณ์',
          meta: [
            AppPageHeaderMeta(label: 'รุ่น', value: 'GT-500'),
            AppPageHeaderMeta(label: 'Firmware', value: '2.4.1'),
          ],
        ),
      ),
    );
    for (final (label, value) in [('รุ่น', 'GT-500'), ('Firmware', '2.4.1')]) {
      final l = tester.widget<Text>(find.text(label));
      final v = tester.widget<Text>(find.text(value));
      expect(l.style!.color, AppColors.mutedForeground);
      expect(v.style!.fontWeight, FontWeight.w500);
      expect(v.style!.color, AppColors.foreground);
    }
  });

  testWidgets(
    'actions: ปุ่มหลักเป็น FilledButton ปุ่มรองเป็น OutlinedButton กดได้',
    (tester) async {
      final pressed = <String>[];
      await tester.pumpWidget(
        _wrap(
          AppPageHeader(
            title: 'Incidents',
            actions: [
              AppPageHeaderAction(
                label: 'รีเฟรช',
                onPressed: () => pressed.add('รีเฟรช'),
              ),
              AppPageHeaderAction(
                label: 'Field Report',
                icon: Icons.add,
                primary: true,
                onPressed: () => pressed.add('Field Report'),
              ),
            ],
          ),
        ),
      );
      expect(
        find.ancestor(
          of: find.text('รีเฟรช'),
          matching: find.byType(OutlinedButton),
        ),
        findsOneWidget,
      );
      expect(
        find.ancestor(
          of: find.text('Field Report'),
          matching: find.byType(FilledButton),
        ),
        findsOneWidget,
      );
      expect(find.byIcon(Icons.add), findsOneWidget);
      // ปุ่มหลักวางท้ายสุดตามลำดับที่ส่งมา
      expect(
        tester.getCenter(find.text('Field Report')).dx,
        greaterThan(tester.getCenter(find.text('รีเฟรช')).dx),
      );

      await tester.tap(find.text('รีเฟรช'));
      await tester.tap(find.text('Field Report'));
      expect(pressed, ['รีเฟรช', 'Field Report']);
    },
  );

  testWidgets('ปุ่มที่ role ทำไม่ได้เลย (visible: false) ซ่อน ไม่ render', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        AppPageHeader(
          title: 'รายละเอียดอุปกรณ์',
          actions: [
            AppPageHeaderAction(
              label: 'Config Override',
              visible: false,
              onPressed: () {},
            ),
            AppPageHeaderAction(label: 'Field Report', onPressed: () {}),
          ],
        ),
      ),
    );
    expect(find.text('Config Override'), findsNothing);
    expect(find.text('Field Report'), findsOneWidget);
  });

  testWidgets('ไม่มีปุ่มที่มองเห็นเลย ไม่เหลือแถว actions ว่าง', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        AppPageHeader(
          title: 'Incidents',
          actions: [
            AppPageHeaderAction(label: 'X', visible: false, onPressed: () {}),
          ],
        ),
      ),
    );
    expect(find.byKey(const Key('app_page_header_actions')), findsNothing);
  });

  group('ปุ่มที่ติดเงื่อนไขชั่วคราว (disabledReason)', () {
    Widget header({VoidCallback? onPressed}) => _wrap(
      AppPageHeader(
        title: 'รายละเอียดงาน',
        actions: [
          AppPageHeaderAction(
            label: 'ส่ง Config เข้าเครื่อง',
            primary: true,
            onPressed: onPressed,
            disabledReason: 'ต้องเปลี่ยนสถานะงานเป็น กำลังทำ ก่อน',
          ),
        ],
      ),
    );

    testWidgets('แสดงปุ่มแต่ disable ไม่ซ่อน และกดแล้วไม่เรียก onPressed', (
      tester,
    ) async {
      var calls = 0;
      await tester.pumpWidget(header(onPressed: () => calls++));

      final button = tester.widget<FilledButton>(
        find.ancestor(
          of: find.text('ส่ง Config เข้าเครื่อง'),
          matching: find.byType(FilledButton),
        ),
      );
      expect(button.onPressed, isNull);
      await tester.tap(find.text('ส่ง Config เข้าเครื่อง'));
      await tester.pump();
      expect(calls, 0);
    });

    testWidgets('แตะปุ่มแล้วเห็นเหตุผล (มือถือไม่มี hover)', (tester) async {
      await tester.pumpWidget(header(onPressed: () {}));
      expect(
        find.byTooltip('ต้องเปลี่ยนสถานะงานเป็น กำลังทำ ก่อน'),
        findsOneWidget,
      );

      await tester.tap(find.text('ส่ง Config เข้าเครื่อง'));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('ต้องเปลี่ยนสถานะงานเป็น กำลังทำ ก่อน'), findsOneWidget);
      await tester.pumpAndSettle(const Duration(seconds: 3));
    });

    testWidgets('screen reader อ่านเหตุผลได้ (ไม่พึ่ง tooltip อย่างเดียว)', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(header(onPressed: () {}));
      expect(
        tester.getSemantics(find.text('ส่ง Config เข้าเครื่อง')),
        isSemantics(hint: 'ต้องเปลี่ยนสถานะงานเป็น กำลังทำ ก่อน'),
      );
      handle.dispose();
    });
  });

  test(
    'ปุ่มที่ไม่มีทั้ง onPressed และ disabledReason = ผิดกติกา (disable เฉยๆ)',
    () {
      expect(
        () => AppPageHeaderAction(label: 'บันทึก'),
        throwsA(isA<AssertionError>()),
      );
    },
  );

  testWidgets('หน้าลูก: ปุ่มย้อนกลับอยู่แถวเดียวกับ title ซ้ายสุด', (
    tester,
  ) async {
    var backs = 0;
    await tester.pumpWidget(
      _wrap(AppPageHeader(title: 'รายละเอียดงาน', onBack: () => backs++)),
    );
    final back = find.byTooltip('ย้อนกลับ');
    expect(back, findsOneWidget);
    expect(
      tester.getCenter(back).dx,
      lessThan(tester.getCenter(find.text('รายละเอียดงาน')).dx),
    );
    await tester.tap(back);
    expect(backs, 1);
  });

  testWidgets('หน้าระดับแท็บ (ไม่มี onBack) ไม่มีปุ่มย้อนกลับ', (tester) async {
    await tester.pumpWidget(_wrap(const AppPageHeader(title: 'Incidents')));
    expect(find.byTooltip('ย้อนกลับ'), findsNothing);
  });

  testWidgets('ชื่อยาว + หลายปุ่ม บนจอแคบไม่ล้น', (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      _wrap(
        AppPageHeader(
          title: 'รายละเอียดอุปกรณ์ GPS รุ่นใหม่ที่มีชื่อยาวมาก',
          onBack: () {},
          status: const AppBadge(
            label: 'Decommissioned',
            tone: AppBadgeTone.danger,
            dot: true,
          ),
          actions: [
            AppPageHeaderAction(label: 'Config Override', onPressed: () {}),
            AppPageHeaderAction(label: 'Firmware Override', onPressed: () {}),
            AppPageHeaderAction(
              label: 'Field Report',
              primary: true,
              onPressed: () {},
            ),
          ],
        ),
      ),
    );
    expect(tester.takeException(), isNull);
  });
}
