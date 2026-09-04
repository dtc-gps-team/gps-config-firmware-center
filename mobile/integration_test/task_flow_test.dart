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
/// Needs seeded `st.test` / `sw.test` (`password123`) users; `st.test` with a
/// few assigned tasks.
Future<void> _login(WidgetTester tester, String username) async {
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

  testWidgets('ST vs SW: task list gated to field staff', (tester) async {
    app.main();
    await tester.pumpAndSettle();
    await binding.convertFlutterSurfaceToImage();

    // === ST: sees own tasks, can open + change status ===
    await _login(tester, 'st.test');

    expect(find.text('งานวันนี้'), findsOneWidget);
    expect(find.byKey(const Key('task_card_0')), findsOneWidget);
    await binding.takeScreenshot('01-home-task-list-st');

    await tester.tap(find.byKey(const Key('task_card_0')));
    await tester.pumpAndSettle(const Duration(seconds: 3));
    expect(find.text('รายละเอียดงาน'), findsOneWidget);
    expect(find.byKey(const Key('task_status_save')), findsOneWidget);
    await binding.takeScreenshot('02-task-detail-st');

    await tester.tap(find.byKey(const Key('status_choice_in_progress')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('task_status_save')));
    await tester.pumpAndSettle(const Duration(seconds: 4));
    await binding.takeScreenshot('03-task-detail-updated-st');

    // === switch to SW: "งานวันนี้" section must be gone ===
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('home_logout')));
    await tester.pumpAndSettle(const Duration(seconds: 2));

    await _login(tester, 'sw.test');

    expect(find.text('ทางลัด'), findsOneWidget); // Home did render
    expect(find.text('งานวันนี้'), findsNothing);
    expect(find.byKey(const Key('task_card_0')), findsNothing);
    expect(find.textContaining('งานที่ได้รับมอบหมาย'), findsNothing);
    await binding.takeScreenshot('04-home-sw-no-tasks');
  });
}
