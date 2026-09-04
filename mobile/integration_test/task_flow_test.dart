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
/// Needs a seeded `st.test` / `password123` user with a few assigned tasks.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('ST: task list -> detail -> change status', (tester) async {
    app.main();
    await tester.pumpAndSettle();
    await binding.convertFlutterSurfaceToImage();

    // --- login as ST ---
    await tester.enterText(find.byKey(const Key('login_username')), 'st.test');
    await tester.enterText(
      find.byKey(const Key('login_password')),
      'password123',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('login_submit')));
    await tester.pumpAndSettle(const Duration(seconds: 4));

    // --- Home: real task list from GET /tasks ---
    expect(find.text('งานวันนี้'), findsOneWidget);
    expect(find.byKey(const Key('task_card_0')), findsOneWidget);
    await binding.takeScreenshot('01-home-task-list');

    // --- Task detail from GET /tasks/{id} ---
    await tester.tap(find.byKey(const Key('task_card_0')));
    await tester.pumpAndSettle(const Duration(seconds: 3));
    expect(find.text('รายละเอียดงาน'), findsOneWidget);
    expect(find.byKey(const Key('task_status_save')), findsOneWidget);
    await binding.takeScreenshot('02-task-detail');

    // --- change status via PATCH /tasks/{id} ---
    await tester.tap(find.byKey(const Key('status_choice_in_progress')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('task_status_save')));
    await tester.pumpAndSettle(const Duration(seconds: 4));
    await binding.takeScreenshot('03-task-detail-updated');
  });
}
