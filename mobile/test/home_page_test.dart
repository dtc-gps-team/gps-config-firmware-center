import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/features/home/home_page.dart';

class _FakeAuthController extends AuthController {
  _FakeAuthController(this._role);

  final UserRole? _role;

  @override
  AuthState build() => AuthState(status: AuthStatus.authenticated, role: _role);
}

Future<void> _pumpHome(WidgetTester tester, UserRole? role) {
  return tester.pumpWidget(
    ProviderScope(
      overrides: [
        authControllerProvider.overrideWith(() => _FakeAuthController(role)),
      ],
      child: const MaterialApp(home: HomePage()),
    ),
  );
}

void main() {
  final testConnectionButton = find.widgetWithText(FilledButton, 'ทดสอบสัญญาณ');

  testWidgets('ST เห็นปุ่ม "ทดสอบสัญญาณ"', (tester) async {
    await _pumpHome(tester, UserRole.st);
    expect(testConnectionButton, findsOneWidget);
  });

  testWidgets('OT เห็นปุ่ม "ทดสอบสัญญาณ"', (tester) async {
    await _pumpHome(tester, UserRole.ot);
    expect(testConnectionButton, findsOneWidget);
  });

  testWidgets('SW ไม่เห็นปุ่ม "ทดสอบสัญญาณ"', (tester) async {
    await _pumpHome(tester, UserRole.sw);
    expect(testConnectionButton, findsNothing);
  });

  testWidgets('role ว่าง ไม่เห็นปุ่ม "ทดสอบสัญญาณ"', (tester) async {
    await _pumpHome(tester, null);
    expect(testConnectionButton, findsNothing);
  });
}
