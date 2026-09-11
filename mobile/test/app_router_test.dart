import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/auth/login_page.dart';
import 'package:mobile/features/home/home_page.dart';
import 'package:mobile/features/notification/notification_repository.dart';
import 'package:mobile/features/task/task_repository.dart';

/// Frozen at `AuthStatus.unknown` forever — deliberately does **not** call
/// `super.build()`, so the base class's `Future.microtask(_restore)` never
/// gets scheduled. Simulates "session restore still in flight" for as long
/// as the test wants, without racing a real (fast but still async) restore.
class _FrozenUnknownAuthController extends AuthController {
  @override
  AuthState build() => const AuthState();
}

/// Fixed state from the very first build — no restore in flight at all.
/// Same pattern as `home_page_test.dart`'s `_FakeAuthController`.
class _FixedAuthController extends AuthController {
  _FixedAuthController(this._state);

  final AuthState _state;

  @override
  AuthState build() => _state;
}

/// `HomePage` needs these — same fakes as `home_page_test.dart`, trimmed to
/// just enough to render without throwing.
class _EmptyTaskRepository implements TaskRepository {
  @override
  Future<List<Task>> listTasks() async => const [];

  @override
  Future<Task> getTask(String id) async => throw UnimplementedError();

  @override
  Future<Task> updateStatus(String id, TaskStatus status) async =>
      throw UnimplementedError();
}

class _EmptyNotificationRepository implements NotificationRepository {
  @override
  Future<List<AppNotification>> list({bool? unread}) async => const [];

  @override
  Future<AppNotification> markRead(String id) async =>
      throw UnimplementedError();
}

Future<GoRouter> _pumpApp(
  WidgetTester tester,
  AuthController fakeController,
) async {
  final container = ProviderContainer(
    overrides: [
      authControllerProvider.overrideWith(() => fakeController),
      taskRepositoryProvider.overrideWithValue(_EmptyTaskRepository()),
      notificationRepositoryProvider.overrideWithValue(
        _EmptyNotificationRepository(),
      ),
    ],
  );
  addTearDown(container.dispose);

  final router = container.read(routerProvider);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(routerConfig: router),
    ),
  );

  return router;
}

void main() {
  testWidgets(
    'AuthStatus.unknown -> stays at splash, never renders LoginPage/HomePage '
    '(regression: used to start at /login and "no redirect" meant the login '
    'form rendered for real during session restore)',
    (tester) async {
      final router = await _pumpApp(tester, _FrozenUnknownAuthController());

      // Not pumpAndSettle(): the splash's CircularProgressIndicator animates
      // indefinitely while status stays unknown, so settling would time out.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.byType(LoginPage), findsNothing);
      expect(find.byType(HomePage), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(
        router.routerDelegate.currentConfiguration.uri.path,
        AppRoutes.splash,
      );
    },
  );

  testWidgets(
    'authenticated from the very first build -> lands on /home directly, '
    'LoginPage never appears at any point',
    (tester) async {
      final router = await _pumpApp(
        tester,
        _FixedAuthController(
          const AuthState(status: AuthStatus.authenticated, role: UserRole.st),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.byType(LoginPage), findsNothing);
      expect(find.byType(HomePage), findsOneWidget);
      expect(
        router.routerDelegate.currentConfiguration.uri.path,
        AppRoutes.home,
      );
    },
  );

  testWidgets('unauthenticated from the very first build -> lands on /login', (
    tester,
  ) async {
    final router = await _pumpApp(
      tester,
      _FixedAuthController(const AuthState(status: AuthStatus.unauthenticated)),
    );

    await tester.pumpAndSettle();

    expect(find.byType(LoginPage), findsOneWidget);
    expect(
      router.routerDelegate.currentConfiguration.uri.path,
      AppRoutes.login,
    );
  });

  testWidgets(
    'authenticated but landed directly on /login (deep link / back button) '
    '-> still redirected to /home (pre-existing behaviour, must not regress)',
    (tester) async {
      final container = ProviderContainer(
        overrides: [
          authControllerProvider.overrideWith(
            () => _FixedAuthController(
              const AuthState(
                status: AuthStatus.authenticated,
                role: UserRole.st,
              ),
            ),
          ),
          taskRepositoryProvider.overrideWithValue(_EmptyTaskRepository()),
          notificationRepositoryProvider.overrideWithValue(
            _EmptyNotificationRepository(),
          ),
        ],
      );
      addTearDown(container.dispose);

      final router = container.read(routerProvider);
      router.go(AppRoutes.login);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(LoginPage), findsNothing);
      expect(find.byType(HomePage), findsOneWidget);
      expect(
        router.routerDelegate.currentConfiguration.uri.path,
        AppRoutes.home,
      );
    },
  );
}
