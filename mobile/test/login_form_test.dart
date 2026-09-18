import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/auth_repository.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/features/auth/login_page.dart';
import 'package:package_info_plus/package_info_plus.dart';

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
      sessionProfileStoreProvider.overrideWithValue(
        InMemorySessionProfileStore(),
      ),
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
  setUpAll(() {
    PackageInfo.setMockInitialValues(
      appName: 'mobile',
      packageName: 'com.example.mobile',
      version: '1.2.3',
      buildNumber: '45',
      buildSignature: '',
    );
  });

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

  testWidgets('username/password fields show a leading (prefix) icon', (
    tester,
  ) async {
    await _pumpLogin(tester, _container(_FakeAuthRepository()));

    InputDecoration decorationOf(Key key) => tester
        .widget<TextField>(
          find.descendant(
            of: find.byKey(key),
            matching: find.byType(TextField),
          ),
        )
        .decoration!;

    expect(decorationOf(const Key('login_username')).prefixIcon, isNotNull);
    expect(decorationOf(const Key('login_password')).prefixIcon, isNotNull);
    // suffix (show/hide password) ของเดิมยังอยู่ ไม่ได้ถูกแทนที่
    expect(decorationOf(const Key('login_password')).suffixIcon, isNotNull);
  });

  testWidgets('shows the app version below the submit button', (tester) async {
    await _pumpLogin(tester, _container(_FakeAuthRepository()));
    await tester.pump(); // ให้ FutureProvider ของ PackageInfo settle

    expect(find.byKey(const Key('login_app_version')), findsOneWidget);
    expect(find.text('เวอร์ชัน 1.2.3 (build 45)'), findsOneWidget);
  });

  testWidgets('hides logo/subtitle/app-version while the keyboard is open, '
      'keeps the submit button reachable', (tester) async {
    await _pumpLogin(tester, _container(_FakeAuthRepository()));
    await tester.pump();

    expect(find.byKey(const Key('login_app_version')), findsOneWidget);

    // จำลองคีย์บอร์ดเปิด — ดัน bottom inset เข้าไปใน MediaQuery แบบเดียวกับ
    // ตอน soft keyboard แสดงจริงบนอุปกรณ์
    await tester.binding.setSurfaceSize(const Size(360, 640));
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    addTearDown(tester.view.resetViewInsets);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('login_app_version')), findsNothing);
    expect(find.text('ระบบบริการและตั้งค่าอุปกรณ์ภาคสนาม'), findsNothing);
    // ปุ่ม login ยังอยู่ใน widget tree เสมอ (Scrollable ทำให้เลื่อนไปหาได้)
    expect(find.byKey(const Key('login_submit')), findsOneWidget);
  });
}
