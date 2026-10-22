import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/features/incident/incident_repository.dart';
import 'package:mobile/features/notification/notification_repository.dart';
import 'package:mobile/features/push_notification/push_message_handler.dart';
import 'package:mobile/features/task/task_event_repository.dart';
import 'package:mobile/features/task/task_repository.dart';

// UX audit #4 — แตะแจ้งเตือนแล้วเปิดหน้าปลายทางด้วย router.go() ซึ่งแทนที่
// stack ทั้งหมด หน้าปลายทางไม่มีปุ่ม back และกด back ของระบบแล้วแอปปิด
// ต้องมี Home อยู่ใต้หน้าปลายทางเสมอ (ทดสอบผ่าน router จริงที่มี redirect)

class _MutableAuth extends AuthController {
  _MutableAuth(this._initial);
  final AuthState _initial;

  @override
  AuthState build() => _initial;

  void set(AuthState next) => state = next;
}

class _TaskRepository implements TaskRepository {
  @override
  Future<List<Task>> listTasks() async => const [];

  @override
  Future<Task> getTask(String id) async => Task(
    id: id,
    title: 'งานจากแจ้งเตือน',
    assignedTo: 'u1',
    status: TaskStatus.pending,
    createdAt: DateTime(2026, 10, 1),
    updatedAt: DateTime(2026, 10, 1),
  );

  @override
  Future<Task> updateStatus(String id, TaskStatus status) async =>
      throw UnimplementedError();
}

class _TaskEventRepository implements TaskEventRepository {
  @override
  Future<List<TaskEvent>> getEvents(String taskId) async => const [];

  @override
  Future<TaskEvent> addNote(String taskId, String note) =>
      throw UnimplementedError();
}

class _NotificationRepository implements NotificationRepository {
  @override
  Future<List<AppNotification>> list({bool? unread}) async => const [];

  @override
  Future<AppNotification> markRead(String id) async =>
      throw UnimplementedError();
}

class _IncidentRepository implements IncidentRepository {
  @override
  Future<List<Incident>> listIncidents() async => const [];

  @override
  Future<Incident> getIncident(String id) async => Incident(
    id: id,
    title: 'Incident จากแจ้งเตือน',
    severity: IncidentSeverity.high,
    status: IncidentStatus.open,
    createdAt: DateTime(2026, 10, 1),
    updatedAt: DateTime(2026, 10, 1),
  );

  @override
  Future<Incident> createFieldReport({
    required String title,
    required String description,
    required IncidentSeverity severity,
    String? deviceId,
  }) => throw UnimplementedError();
}

const _loggedIn = AuthState(
  status: AuthStatus.authenticated,
  role: UserRole.st,
  username: 'st.a',
);

final _taskPayload = {
  'type': 'task_assigned',
  'payload': jsonEncode({'taskId': 't-42'}),
};

/// testWidgets + ปิดแอปแล้วรอ timer ของหน้า (retry/refresh) หมด
void _flowTest(String name, Future<void> Function(WidgetTester) body) {
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
    tester.view.physicalSize = const Size(1080, 4000);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    container = ProviderContainer(
      overrides: [
        authControllerProvider.overrideWith(() => _MutableAuth(initial)),
        taskRepositoryProvider.overrideWithValue(_TaskRepository()),
        taskEventRepositoryProvider.overrideWithValue(_TaskEventRepository()),
        incidentRepositoryProvider.overrideWithValue(_IncidentRepository()),
        notificationRepositoryProvider.overrideWithValue(
          _NotificationRepository(),
        ),
        pendingTaskIdsProvider.overrideWith(
          (ref) => Stream.value(const <String>{}),
        ),
        failedSyncActionsProvider.overrideWith(
          (ref) => Stream.value(const <PendingActionRow>[]),
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

  // หน้าบนสุดของ stack — หลัง push() go_router ไม่เปลี่ยน uri
  // (optionURLReflectsImperativeAPIs = false) จึงอ่านจาก match ตัวสุดท้าย
  String path() =>
      router.routerDelegate.currentConfiguration.last.matchedLocation;

  Future<void> settle(WidgetTester tester) async {
    // addPostFrameCallback ไม่ขอ frame เอง (ในแอปจริงมี frame มาเสมอ)
    for (var i = 0; i < 3; i++) {
      WidgetsBinding.instance.scheduleFrame();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> expectBackToHome(WidgetTester tester) async {
    expect(router.canPop(), isTrue, reason: 'ต้องมี Home อยู่ใต้หน้าปลายทาง');
    // Task Detail ย้ายไป AppPageHeader แล้ว (docs/22 Batch 5) — ปุ่มย้อนกลับเป็น
    // IconButton tooltip "ย้อนกลับ" แทน BackButton ของ AppBar
    final back = find.byTooltip('ย้อนกลับ');
    expect(back, findsOneWidget, reason: 'หัวหน้าจอต้องมีปุ่มย้อนกลับ');
    await tester.tap(back);
    await settle(tester);
    expect(path(), AppRoutes.home);
  }

  group('แตะแจ้งเตือนแล้วกด back กลับ Home ได้ (UX audit #4)', () {
    _flowTest('login อยู่แล้ว แตะแจ้งเตือนงาน -> เปิดหน้างาน, canPop และ back '
        'กลับ Home', (tester) async {
      await boot(tester, _loggedIn);
      await settle(tester);
      expect(path(), AppRoutes.home);

      handler.openPath(resolvePushDeepLink(_taskPayload));
      await settle(tester);

      expect(path(), '/tasks/t-42');
      await expectBackToHome(tester);
    });

    _flowTest(
      'อยู่หน้าอื่น (รายการแจ้งเตือน) แล้วแตะแจ้งเตือน -> back กลับ Home '
      '(stack ฐานเป็น Home เสมอ)',
      (tester) async {
        await boot(tester, _loggedIn);
        await settle(tester);
        router.push(AppRoutes.notifications);
        await settle(tester);

        handler.openPath(resolvePushDeepLink(_taskPayload));
        await settle(tester);

        expect(path(), '/tasks/t-42');
        await expectBackToHome(tester);
      },
    );

    _flowTest('แอปปิดอยู่ แตะแจ้งเตือนก่อน login -> login แล้วไปหน้างาน และ '
        'back กลับ Home ได้', (tester) async {
      await boot(tester, const AuthState(status: AuthStatus.unauthenticated));
      await settle(tester);
      handler.openPath(resolvePushDeepLink(_taskPayload));
      await settle(tester);

      auth.set(_loggedIn);
      await settle(tester);

      expect(path(), '/tasks/t-42');
      await expectBackToHome(tester);
    });

    _flowTest(
      'หน้าฐานไม่ใช่ Home (เคย go ไปหน้าอื่น) -> go Home ก่อน รอให้ถึงจริง '
      'แล้วค่อยเปิดปลายทาง',
      (tester) async {
        await boot(tester, _loggedIn);
        await settle(tester);
        router.go(AppRoutes.notifications);
        await settle(tester);
        expect(router.canPop(), isFalse);

        handler.openPath(resolvePushDeepLink(_taskPayload));
        await settle(tester);

        expect(path(), '/tasks/t-42');
        await expectBackToHome(tester);
      },
    );

    _flowTest('ปลายทางเป็น Home เอง -> ไม่ซ้อน Home สองชั้น', (tester) async {
      await boot(tester, _loggedIn);
      await settle(tester);

      handler.openPath(AppRoutes.home);
      await settle(tester);

      expect(path(), AppRoutes.home);
      expect(router.canPop(), isFalse);
    });
  });
  // docs/22 §7.2 — หน้าแรกเป็นแท็บแล้ว: ฐานของหน้าปลายทาง = แท็บที่เกี่ยวข้อง
  group('ฐานของ deep link = แท็บที่เกี่ยวข้อง (docs/22 §7.2)', () {
    Future<void> tapHeaderBack(WidgetTester tester) async {
      await tester.tap(find.byTooltip('ย้อนกลับ'));
      await settle(tester);
    }

    _flowTest('แจ้งเตือน Incident -> เปิดหน้า Incident, back กลับแท็บ '
        'Incidents', (tester) async {
      await boot(tester, _loggedIn);
      await settle(tester);

      handler.openPath(
        resolvePushDeepLink({
          'type': 'incident_report_resolved',
          'payload': jsonEncode({'incidentId': 'i-7'}),
        }),
      );
      await settle(tester);

      expect(path(), '/incidents/i-7');
      expect(router.canPop(), isTrue);
      await tapHeaderBack(tester);
      expect(path(), AppRoutes.incidents);
      expect(find.byKey(const Key('app_tab_bar')), findsOneWidget);
    });

    _flowTest('Operation (ไม่มีแท็บงาน) แจ้งเตือนงาน -> back กลับแท็บ '
        'แจ้งเตือน', (tester) async {
      await boot(
        tester,
        const AuthState(
          status: AuthStatus.authenticated,
          role: UserRole.operation,
          username: 'op.a',
        ),
      );
      await settle(tester);
      expect(path(), AppRoutes.deviceSearch);

      handler.openPath(resolvePushDeepLink(_taskPayload));
      await settle(tester);

      expect(path(), '/tasks/t-42');
      await tester.tap(find.byTooltip('ย้อนกลับ'));
      await settle(tester);
      expect(path(), AppRoutes.notifications);
    });

    test('pushBaseTabFor', () {
      expect(pushBaseTabFor('/tasks/t-1', UserRole.st), AppRoutes.home);
      expect(
        pushBaseTabFor('/tasks/t-1', UserRole.operation),
        AppRoutes.notifications,
      );
      expect(
        pushBaseTabFor('/incidents/i-1', UserRole.ot),
        AppRoutes.incidents,
      );
      expect(
        pushBaseTabFor(AppRoutes.notifications, UserRole.st),
        AppRoutes.notifications,
      );
      expect(pushBaseTabFor(AppRoutes.home, UserRole.st), AppRoutes.home);
    });
  });
}
