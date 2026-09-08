import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/config/app_config.dart';
import 'package:mobile/features/activity_log/activity_log_repository.dart';
import 'package:mobile/features/auth/login_page.dart';
import 'package:mobile/main.dart';

/// Run with: `flutter test --dart-define=API_MOCK_MODE=true`
///
/// Proves the app boots straight to a working login screen with no backend —
/// so the team can build UI before `[A]` ships the real auth service.
void main() {
  testWidgets('boots to the login screen without a backend in mock mode', (
    tester,
  ) async {
    // Override the real (`Secure*`) stores even in "real mode" here — this
    // test isn't about token persistence, and `SecureTokenStore`'s real
    // `flutter_secure_storage` plugin call has been observed to hang
    // indefinitely under `flutter_tester`'s single-threaded harness on
    // Windows (a platform-channel deadlock, not a Dart-catchable error —
    // `Future.timeout()` can't preempt it either), which would otherwise
    // strand `AuthController` at `AuthStatus.unknown` forever and hang this
    // test's `pumpAndSettle()` on the splash spinner. Every other test in
    // this suite already avoids the real stores the same way.
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
          sessionProfileStoreProvider.overrideWithValue(
            InMemorySessionProfileStore(),
          ),
          activityLogRepositoryProvider.overrideWithValue(
            DefaultActivityLogRepository(InMemoryActivityLogStore()),
          ),
        ],
        child: const GpsMobileApp(),
      ),
    );
    await tester.pumpAndSettle();

    if (AppConfig.apiMockMode) {
      expect(find.byType(LoginPage), findsOneWidget);
      expect(find.byKey(const Key('login_submit')), findsOneWidget);
      // The mock-mode helper banner is shown.
      expect(find.textContaining('API_MOCK_MODE'), findsOneWidget);
    } else {
      // Default (real) mode: still renders the login screen, no exception.
      expect(find.byType(LoginPage), findsOneWidget);
    }
    expect(tester.takeException(), isNull);
  });
}
