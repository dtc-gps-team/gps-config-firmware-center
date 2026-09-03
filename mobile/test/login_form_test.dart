import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/auth_repository.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/features/auth/login_page.dart';

class _FakeAuthRepository implements AuthRepository {
  _FakeAuthRepository({this.response, this.error});

  final LoginResponse? response;
  final Object? error;

  @override
  Future<LoginResponse> login(String username, String password) async {
    if (error != null) throw error!;
    return response!;
  }
}

ProviderContainer _container(AuthRepository repository) {
  final container = ProviderContainer(
    overrides: [
      authRepositoryProvider.overrideWithValue(repository),
      tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

Future<void> _pumpLogin(WidgetTester tester, ProviderContainer container) {
  return tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(home: LoginPage()),
    ),
  );
}

void main() {
  testWidgets('renders username, password and submit', (tester) async {
    await _pumpLogin(tester, _container(_FakeAuthRepository()));

    expect(find.byKey(const Key('login_username')), findsOneWidget);
    expect(find.byKey(const Key('login_password')), findsOneWidget);
    expect(find.byKey(const Key('login_submit')), findsOneWidget);
  });

  testWidgets('shows validation errors on empty submit', (tester) async {
    final container = _container(_FakeAuthRepository());
    await _pumpLogin(tester, container);

    await tester.tap(find.byKey(const Key('login_submit')));
    await tester.pump();

    expect(find.text('กรุณากรอก Username'), findsOneWidget);
    expect(find.text('กรุณากรอก Password'), findsOneWidget);
    expect(container.read(authControllerProvider).isAuthenticated, isFalse);
  });

  testWidgets('valid credentials authenticate via the repository', (
    tester,
  ) async {
    final container = _container(
      _FakeAuthRepository(
        response: const LoginResponse(
          accessToken: 'token-123',
          role: UserRole.operation,
        ),
      ),
    );
    await _pumpLogin(tester, container);

    await tester.enterText(find.byKey(const Key('login_username')), 'op.demo');
    await tester.enterText(find.byKey(const Key('login_password')), 'secret');
    await tester.tap(find.byKey(const Key('login_submit')));
    await tester.pumpAndSettle();

    final state = container.read(authControllerProvider);
    expect(state.isAuthenticated, isTrue);
    expect(state.role, UserRole.operation);
  });

  testWidgets('password show/hide toggle flips obscureText', (tester) async {
    await _pumpLogin(tester, _container(_FakeAuthRepository()));

    TextField passwordField() => tester.widget<TextField>(
      find.descendant(
        of: find.byKey(const Key('login_password')),
        matching: find.byType(TextField),
      ),
    );

    expect(passwordField().obscureText, isTrue);

    await tester.tap(find.byKey(const Key('login_password_toggle')));
    await tester.pump();
    expect(passwordField().obscureText, isFalse);

    await tester.tap(find.byKey(const Key('login_password_toggle')));
    await tester.pump();
    expect(passwordField().obscureText, isTrue);
  });

  testWidgets('surfaces the API error message on failure', (tester) async {
    final container = _container(
      _FakeAuthRepository(
        error: ApiException('Username/Password ไม่ถูกต้อง', statusCode: 401),
      ),
    );
    await _pumpLogin(tester, container);

    await tester.enterText(find.byKey(const Key('login_username')), 'op.demo');
    await tester.enterText(find.byKey(const Key('login_password')), 'wrong');
    await tester.tap(find.byKey(const Key('login_submit')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('login_error')), findsOneWidget);
    expect(find.text('Username/Password ไม่ถูกต้อง'), findsOneWidget);
    expect(container.read(authControllerProvider).isAuthenticated, isFalse);
  });
}
