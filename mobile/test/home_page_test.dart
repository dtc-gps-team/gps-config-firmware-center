import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/home/home_page.dart';

class _FakeAuthController extends AuthController {
  _FakeAuthController(this._role);

  final UserRole? _role;

  @override
  AuthState build() => AuthState(
    status: AuthStatus.authenticated,
    role: _role,
    username: 'somchai.t',
  );
}

/// Plain pump — no router. Fine for visibility / snackbar assertions.
Future<void> _pumpHome(WidgetTester tester, UserRole? role) {
  return tester.pumpWidget(
    ProviderScope(
      overrides: [
        authControllerProvider.overrideWith(() => _FakeAuthController(role)),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
      ],
      child: const MaterialApp(home: HomePage()),
    ),
  );
}

/// Router-backed pump with stub destinations, so `context.push(...)` from the
/// shortcut tiles can be asserted.
Future<void> _pumpHomeRouted(WidgetTester tester, UserRole? role) {
  final router = GoRouter(
    initialLocation: '/home',
    routes: [
      GoRoute(path: '/home', builder: (_, _) => const HomePage()),
      GoRoute(
        path: AppRoutes.simulator,
        builder: (_, _) => const Scaffold(body: Text('SIMULATOR_PAGE_STUB')),
      ),
      GoRoute(
        path: AppRoutes.deviceConnectionTest,
        builder: (_, _) => const Scaffold(body: Text('DEVICE_TEST_PAGE_STUB')),
      ),
    ],
  );
  return tester.pumpWidget(
    ProviderScope(
      overrides: [
        authControllerProvider.overrideWith(() => _FakeAuthController(role)),
      ],
      child: MaterialApp.router(routerConfig: router),
    ),
  );
}

void main() {
  final deviceTestTile = find.byKey(const Key('shortcut_device_test'));

  group('RBAC — ปุ่ม "ทดสอบสัญญาณ" ในกริดทางลัด', () {
    testWidgets('ST เห็นทางลัด "ทดสอบสัญญาณ"', (tester) async {
      await _pumpHome(tester, UserRole.st);
      expect(deviceTestTile, findsOneWidget);
    });

    testWidgets('OT เห็นทางลัด "ทดสอบสัญญาณ"', (tester) async {
      await _pumpHome(tester, UserRole.ot);
      expect(deviceTestTile, findsOneWidget);
    });

    testWidgets('SW ไม่เห็นทางลัด "ทดสอบสัญญาณ"', (tester) async {
      await _pumpHome(tester, UserRole.sw);
      expect(deviceTestTile, findsNothing);
    });

    testWidgets('role ว่าง ไม่เห็นทางลัด "ทดสอบสัญญาณ"', (tester) async {
      await _pumpHome(tester, null);
      expect(deviceTestTile, findsNothing);
    });
  });

  group('การ navigate ของทางลัดของจริง (ต้องทำงานเหมือนเดิม)', () {
    testWidgets('แตะ "ทดสอบการตั้งค่า" -> ไปหน้า Config Simulator', (
      tester,
    ) async {
      await _pumpHomeRouted(tester, UserRole.sw);
      await tester.tap(find.byKey(const Key('shortcut_simulator')));
      await tester.pumpAndSettle();
      expect(find.text('SIMULATOR_PAGE_STUB'), findsOneWidget);
    });

    testWidgets('ST แตะ "ทดสอบสัญญาณ" -> ไปหน้าทดสอบสัญญาณ', (tester) async {
      await _pumpHomeRouted(tester, UserRole.st);
      await tester.tap(find.byKey(const Key('shortcut_device_test')));
      await tester.pumpAndSettle();
      expect(find.text('DEVICE_TEST_PAGE_STUB'), findsOneWidget);
    });
  });

  group('ส่วน mock -> snackbar "เร็ว ๆ นี้" (ไม่เงียบ ไม่ crash)', () {
    testWidgets('แตะทางลัด mock "ค้นหาอุปกรณ์"', (tester) async {
      await _pumpHome(tester, UserRole.st);
      final tile = find.byKey(const Key('shortcut_find_device'));
      await tester.ensureVisible(tile);
      await tester.pumpAndSettle();
      await tester.tap(tile);
      await tester.pump();
      expect(find.textContaining('เร็ว'), findsOneWidget);
    });

    testWidgets('แตะการ์ดงาน mock ใบแรก', (tester) async {
      await _pumpHome(tester, UserRole.st);
      await tester.tap(find.byKey(const Key('task_card_0')));
      await tester.pump();
      expect(find.textContaining('เร็ว'), findsOneWidget);
    });

    testWidgets('แตะไอคอนกระดิ่งแจ้งเตือน mock', (tester) async {
      await _pumpHome(tester, UserRole.st);
      await tester.tap(find.byKey(const Key('home_notifications')));
      await tester.pump();
      expect(find.textContaining('เร็ว'), findsOneWidget);
    });
  });

  testWidgets('ปุ่ม logout เรียก logout ของ controller', (tester) async {
    final container = ProviderContainer(
      overrides: [
        authControllerProvider.overrideWith(
          () => _FakeAuthController(UserRole.st),
        ),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
      ],
    );
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(home: HomePage()),
      ),
    );

    await tester.tap(find.byKey(const Key('home_logout')));
    await tester.pumpAndSettle();

    expect(
      container.read(authControllerProvider).status,
      AuthStatus.unauthenticated,
    );
  });
}
