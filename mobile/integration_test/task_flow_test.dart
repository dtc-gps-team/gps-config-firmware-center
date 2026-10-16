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
  // secure storage). If we land on Home, log out first.
  if (find.byKey(const Key('home_logout')).evaluate().isNotEmpty) {
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

    // Home ของ ST/OT (ตั้งแต่ #191 ไม่มี section "งานวันนี้" แล้ว): ประวัติงาน
    // ล่าสุด + ทางลัด "งานของฉัน" ไปรายการงานเต็ม · "งานค้างวันนี้" โผล่เฉพาะงาน
    // ที่เลย/ใกล้กำหนดส่ง ซึ่ง CI fixtures ไม่มี จึงไม่ใช้เป็นตัวเช็ค
    expect(find.text('ประวัติงานล่าสุด'), findsOneWidget);
    await binding.takeScreenshot('01-home-st');

    final myTasks = find.byKey(const Key('shortcut_my_tasks'));
    await tester.scrollUntilVisible(
      myTasks,
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(myTasks);
    await tester.pumpAndSettle(const Duration(seconds: 3));
    expect(find.byKey(const Key('my_task_card_0')), findsOneWidget);
    await binding.takeScreenshot('01b-my-tasks-st');

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
    // task detail -> งานของฉัน -> Home
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();
    await _logout(tester);

    // Operation แทน SW เดิม (role ถูกแยกตั้งแต่ #174 และ role ใหม่อย่าง
    // ConfigEngineer ยัง login เข้า Mobile ไม่ได้ — UserRole ฝั่ง Mobile ไม่มี)
    await _login(tester, 'operation.test');

    expect(find.text('ทางลัด'), findsOneWidget); // Home did render
    expect(find.text('ประวัติงานล่าสุด'), findsNothing);
    expect(find.byKey(const Key('urgent_tasks_section')), findsNothing);
    expect(find.byKey(const Key('shortcut_my_tasks')), findsNothing);
    await binding.takeScreenshot('04-home-operation-no-tasks');
  });
}

/// Logout ต้องกดค้าง + ยืนยันใน dialog (ไม่มีคิวค้าง = `logout_confirm`,
/// มีคิวค้าง = `logout_unsynced_confirm`)
Future<void> _logout(WidgetTester tester) async {
  await tester.longPress(find.byKey(const Key('home_logout')));
  await tester.pumpAndSettle();
  final plain = find.byKey(const Key('logout_confirm'));
  await tester.tap(
    plain.evaluate().isNotEmpty
        ? plain
        : find.byKey(const Key('logout_unsynced_confirm')),
  );
  await tester.pumpAndSettle(const Duration(seconds: 2));
}
