import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/auth/login_page.dart';
import 'package:mobile/features/notification/notification_repository.dart';
import 'package:mobile/features/push_notification/push_message_handler.dart';
import 'package:mobile/features/task/task_repository.dart';

// PR #279 checklist: "เปิดแอปจาก terminated ด้วยการกด notification ตอนยังไม่
// login แล้ว login ต้องไปหน้าปลายทาง" and "กด notification ของ task_assigned /
// incident_report_* ไปหน้าปลายทาง" — driven through the REAL redirecting
// router (not a bare GoRouter) so the splash/login redirect that used to eat
// the destination is part of the test. Payload → path mapping itself is in
// `push_message_handler_test.dart`.

class _MutableAuth extends AuthController {
  _MutableAuth(this._initial);
  final AuthState _initial;

  @override
  AuthState build() => _initial;

  void set(AuthState next) => state = next;
}

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

const _unknown = AuthState(status: AuthStatus.unknown);
const _loggedOut = AuthState(status: AuthStatus.unauthenticated);
const _loggedIn = AuthState(
  status: AuthStatus.authenticated,
  role: UserRole.st,
);

/// testWidgets + tear the app down and let the pages' timers (retry/refresh)
/// run out, otherwise the landing page's pending Timer fails the invariant.
void flowTest(String name, Future<void> Function(WidgetTester) body) {
  testWidgets(name, (tester) async {
    await body(tester);
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 60));
  });
}

void main() {
  late ProviderContainer container;
  late GoRouter router;
  late _MutableAuth auth;
  late PushMessageHandler handler;

  Future<void> boot(WidgetTester tester, AuthState initial) async {
    container = ProviderContainer(
      overrides: [
        authControllerProvider.overrideWith(() => _MutableAuth(initial)),
        taskRepositoryProvider.overrideWithValue(_EmptyTaskRepository()),
        notificationRepositoryProvider.overrideWithValue(
          _EmptyNotificationRepository(),
        ),
      ],
    );
    addTearDown(container.dispose);
    router = container.read(routerProvider);
    auth = container.read(authControllerProvider.notifier) as _MutableAuth;
    handler = container.read(pushMessageHandlerProvider);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pump();
  }

  String path() => router.routeInformationProvider.value.uri.path;

  Future<void> settle(WidgetTester tester) async {
    // addPostFrameCallback doesn't request a frame by itself; in the real app
    // a frame is always coming (resume / animations), here nothing is dirty.
    WidgetsBinding.instance.scheduleFrame();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump();
  }

  final taskPayload = {
    'type': 'task_assigned',
    'payload': jsonEncode({'taskId': 't-42'}),
  };
  final incidentPayload = {
    'type': 'incident_report_resolved',
    'payload': jsonEncode({'incidentId': 'i-7'}),
  };

  for (final c in [
    ('task_assigned', taskPayload, '/tasks/t-42'),
    ('incident_report_resolved', incidentPayload, '/incidents/i-7'),
  ]) {
    flowTest('terminated + session ยัง restore อยู่ -> กด ${c.$1} ถูกพักไว้ '
        'แล้วพอ authenticated ไปหน้า ${c.$3} (ไม่ใช่ /home)', (tester) async {
      await boot(tester, _unknown);
      expect(path(), AppRoutes.splash);

      handler.openPath(resolvePushDeepLink(c.$2));
      await settle(tester);
      expect(path(), AppRoutes.splash); // router untouched
      expect(container.read(pendingPushRouteProvider), c.$3);

      auth.set(_loggedIn);
      await settle(tester);
      await settle(tester);

      expect(path(), c.$3);
      expect(container.read(pendingPushRouteProvider), isNull);
    });
  }

  flowTest('ยังไม่ login (หน้า login) -> กด notification แล้วค้างที่ login '
      'จนกว่าจะ login สำเร็จ แล้วไปปลายทาง', (tester) async {
    await boot(tester, _loggedOut);
    await settle(tester);
    expect(find.byType(LoginPage), findsOneWidget);

    handler.openPath(resolvePushDeepLink(taskPayload));
    await settle(tester);
    expect(find.byType(LoginPage), findsOneWidget);
    expect(path(), AppRoutes.login);

    auth.set(_loggedIn);
    await settle(tester);
    await settle(tester);

    expect(path(), '/tasks/t-42');
    expect(find.byType(LoginPage), findsNothing);
  });

  flowTest('กดหลายครั้งก่อน login -> เปิดอันล่าสุดเท่านั้น', (tester) async {
    await boot(tester, _unknown);
    handler.openPath(resolvePushDeepLink(taskPayload));
    handler.openPath(resolvePushDeepLink(incidentPayload));

    auth.set(_loggedIn);
    await settle(tester);
    await settle(tester);

    expect(path(), '/incidents/i-7');
  });

  flowTest('ใช้ path ที่พักไว้ครั้งเดียว -> logout แล้ว login ใหม่ไป /home '
      'ตามปกติ ไม่เด้งไปปลายทางเดิมซ้ำ', (tester) async {
    await boot(tester, _unknown);
    handler.openPath(resolvePushDeepLink(taskPayload));
    auth.set(_loggedIn);
    await settle(tester);
    await settle(tester);
    expect(path(), '/tasks/t-42');

    auth.set(_loggedOut);
    await settle(tester);
    expect(path(), AppRoutes.login);

    auth.set(_loggedIn);
    await settle(tester);
    await settle(tester);
    expect(path(), AppRoutes.home);
  });

  flowTest('authenticated อยู่แล้ว + แอปอยู่ background -> กด notification '
      'ไปปลายทางทันที ไม่พัก', (tester) async {
    await boot(tester, _loggedIn);
    await settle(tester);
    expect(path(), AppRoutes.home);

    handler.openPath(resolvePushDeepLink(incidentPayload));
    await settle(tester);

    expect(path(), '/incidents/i-7');
    expect(container.read(pendingPushRouteProvider), isNull);
  });

  flowTest('payload ใช้ไม่ได้ (ไม่มี taskId) ตอนยังไม่ login -> พอ login '
      'ไปหน้ารายการแจ้งเตือน', (tester) async {
    await boot(tester, _unknown);
    handler.openPath(resolvePushDeepLink({'type': 'task_assigned'}));

    auth.set(_loggedIn);
    await settle(tester);
    await settle(tester);

    expect(path(), AppRoutes.notifications);
  });
}
