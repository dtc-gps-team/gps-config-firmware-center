import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/app_config.dart';
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
    await tester.pumpWidget(const ProviderScope(child: GpsMobileApp()));
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
