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
  if (find.byKey(const Key('home_logout')).evaluate().isNotEmpty) {
    await tester.tap(find.byKey(const Key('home_logout')));
    await tester.pumpAndSettle(const Duration(seconds: 2));
  }
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('ST: bell badge -> list -> mark read', (tester) async {
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

    // --- Home: bell shows a real unread count ---
    expect(find.byType(Badge), findsOneWidget);
    await binding.takeScreenshot('01-home-bell-badge');

    // --- notification list from GET /notifications ---
    await tester.tap(find.byKey(const Key('home_notifications')));
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
