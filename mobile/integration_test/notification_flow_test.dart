import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile/main.dart' as app;

/// End-to-end run of the real Notification integration against a live backend.
///
/// Run with:
/// ```
/// flutter drive \
///   --driver=test_driver/integration_test.dart \
///   --target=integration_test/notification_flow_test.dart \
///   -d <device> \
///   --dart-define=API_BASE_URL=http://10.0.2.2:3001/api/v1
/// ```
/// Needs a seeded `st.test` / `password123` user with a few notifications
/// (some unread).
Future<void> _ensureLoggedOut(WidgetTester tester) async {
  if (find.byKey(const Key('app_tab_bar')).evaluate().isNotEmpty) {
    await _logout(tester);
  }
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('ST: tab badge -> list -> mark read', (tester) async {
    app.main();
    await tester.pumpAndSettle();
    await binding.convertFlutterSurfaceToImage();

    await _ensureLoggedOut(tester);
    await tester.enterText(find.byKey(const Key('login_username')), 'st.test');
    await tester.enterText(
      find.byKey(const Key('login_password')),
      'password123',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('login_submit')));
    await tester.pumpAndSettle(const Duration(seconds: 4));

    // --- แท็บแจ้งเตือนมีตัวเลขยังไม่อ่านจริง (แทนกระดิ่งเดิม docs/22 §7.2) ---
    expect(find.byKey(const Key('tab_notifications_badge')), findsOneWidget);
    await binding.takeScreenshot('01-home-tab-badge');

    // --- notification list from GET /notifications ---
    await tester.tap(find.byKey(const Key('tab_notifications')));
    await tester.pumpAndSettle(const Duration(seconds: 3));
    expect(find.text('รายการแจ้งเตือน'), findsOneWidget);
    expect(find.byKey(const Key('notification_tile_0')), findsOneWidget);
    await binding.takeScreenshot('02-notification-list');

    // --- mark the first (unread) one read via PATCH /notifications/{id}/read ---
    expect(find.byKey(const Key('unread_dot')), findsWidgets);
    final dotsBefore = find.byKey(const Key('unread_dot')).evaluate().length;
    await tester.tap(find.byKey(const Key('notification_tile_0')));
    await tester.pumpAndSettle(const Duration(seconds: 3));
    expect(
      find.byKey(const Key('unread_dot')).evaluate().length,
      lessThan(dotsBefore),
    );
    await binding.takeScreenshot('03-notification-after-read');
  });
}

/// Logout อยู่ในแผ่นบัญชีผู้ใช้ (ปุ่ม avatar บนหัวหน้าระดับแท็บ docs/22 §7.2) +
/// ยืนยันใน dialog (ไม่มีคิวค้าง = `logout_confirm`, มีคิวค้าง =
/// `logout_unsynced_confirm`) · ทุกหน้าระดับแท็บมี avatar แล้ว (Device Search ย้าย
/// design ใน Batch 4) — ถ้าหน้าปัจจุบันไม่มีปุ่ม (เช่นอยู่หน้าลูก) สลับไปแท็บแจ้งเตือนก่อน
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
