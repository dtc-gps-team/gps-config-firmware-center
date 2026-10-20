import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile/main.dart' as app;

/// End-to-end run of the real Task integration against a live backend.
///
/// Run with:
/// ```
/// flutter drive \
///   --driver=test_driver/integration_test.dart \
///   --target=integration_test/task_flow_test.dart \
///   -d <device> \
///   --dart-define=API_BASE_URL=http://10.0.2.2:3001/api/v1
/// ```
/// Needs seeded `st.test` / `operation.test` (`password123`) users; `st.test`
/// with a few assigned tasks (`backend/scripts/seed-ci-fixtures.ts`: no
/// `dueDate`, newest = `pending`).
Future<void> _ensureLoggedOut(WidgetTester tester) async {
  // A previous run can leave a persisted session (reinstalling the APK keeps
  // secure storage). If we land on a tab page, log out first.
  if (find.byKey(const Key('app_tab_bar')).evaluate().isNotEmpty) {
    await _logout(tester);
  }
}

Future<void> _login(WidgetTester tester, String username) async {
  await _ensureLoggedOut(tester);
  await tester.enterText(find.byKey(const Key('login_username')), username);
  await tester.enterText(
    find.byKey(const Key('login_password')),
    'password123',
  );
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('login_submit')));
  await tester.pumpAndSettle(const Duration(seconds: 4));
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('ST vs Operation: task list gated to field staff', (
    tester,
  ) async {
    app.main();
    await tester.pumpAndSettle();
    await binding.convertFlutterSurfaceToImage();

    // === ST: sees own tasks, can open + change status ===
    await _login(tester, 'st.test');

    // หน้าแรกของ ST/OT รวมรายการงานจากหน้า "งานของฉัน" เดิมไว้แล้ว (docs/22
    // §7.2): ส่วน "ต้องทำ" + "ประวัติงานล่าสุด" บนหน้าเดียว · fixtures มีงาน
    // `pending` อย่างน้อยหนึ่งงาน จึงมีการ์ดในส่วนต้องทำเสมอ
    expect(find.byKey(const Key('home_open_section')), findsOneWidget);
    expect(find.byKey(const Key('my_task_card_0')), findsOneWidget);
    await binding.takeScreenshot('01-home-st');

    await tester.tap(find.byKey(const Key('my_task_card_0')));
    await tester.pumpAndSettle(const Duration(seconds: 3));
    expect(find.text('รายละเอียดงาน'), findsOneWidget);
    expect(find.byKey(const Key('task_status_save')), findsOneWidget);
    // ST/OT may only set in_progress / completed — not pending, not cancelled.
    expect(find.byKey(const Key('status_choice_in_progress')), findsOneWidget);
    expect(find.byKey(const Key('status_choice_completed')), findsOneWidget);
    expect(find.byKey(const Key('status_choice_pending')), findsNothing);
    expect(find.byKey(const Key('status_choice_cancelled')), findsNothing);
    await binding.takeScreenshot('02-task-detail-st');

    await tester.tap(find.byKey(const Key('status_choice_in_progress')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('task_status_save')));
    await tester.pumpAndSettle(const Duration(seconds: 4));
    await binding.takeScreenshot('03-task-detail-updated-st');

    // === switch to Operation: งานของช่างต้องไม่โผล่ ===
    // task detail -> หน้าแรก
    await tester.pageBack();
    await tester.pumpAndSettle();
    await _logout(tester);

    // Operation แทน SW เดิม (role ถูกแยกตั้งแต่ #174 และ role ใหม่อย่าง
    // ConfigEngineer ยัง login เข้า Mobile ไม่ได้ — UserRole ฝั่ง Mobile ไม่มี)
    await _login(tester, 'operation.test');

    // Operation ไม่มีแท็บงาน — เปิดมาที่ Device Search (docs/22 §7.2)
    expect(find.byKey(const Key('app_tab_bar')), findsOneWidget);
    expect(find.byKey(const Key('tab_home')), findsNothing);
    expect(find.byKey(const Key('tab_devices')), findsOneWidget);
    expect(find.byKey(const Key('home_open_section')), findsNothing);
    await binding.takeScreenshot('04-operation-no-task-tab');
  });
}

/// Logout อยู่ในแผ่นบัญชีผู้ใช้ (ปุ่ม avatar บนหัวหน้าระดับแท็บ docs/22 §7.2) +
/// ยืนยันใน dialog (ไม่มีคิวค้าง = `logout_confirm`, มีคิวค้าง =
/// `logout_unsynced_confirm`) · หน้า Device Search (แท็บแรกของ Operation) ยังไม่
/// ย้าย design (Batch 4) จึงยังไม่มี avatar — สลับไปแท็บแจ้งเตือนก่อน
Future<void> _logout(WidgetTester tester) async {
  final account = find.byKey(const Key('account_button'));
  if (account.evaluate().isEmpty) {
    await tester.tap(find.byKey(const Key('tab_notifications')));
    await tester.pumpAndSettle(const Duration(seconds: 2));
  }
  await tester.tap(account);
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('account_logout')));
  await tester.pumpAndSettle();
  final plain = find.byKey(const Key('logout_confirm'));
  await tester.tap(
    plain.evaluate().isNotEmpty
        ? plain
        : find.byKey(const Key('logout_unsynced_confirm')),
  );
  await tester.pumpAndSettle(const Duration(seconds: 2));
}
