import 'dart:async';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/db/providers/database_provider.dart';
import 'package:mobile/core/realtime/realtime_controller.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/core/sync/sync_queue_service.dart';
import 'package:mobile/core/widgets/app_error_view.dart';
import 'package:mobile/features/config_override/config_override_repository.dart';
import 'package:mobile/features/device_search/device_central_repository.dart';
import 'package:mobile/features/device_search/device_detail_page.dart';
import 'package:mobile/features/device_search/device_history_repository.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';
import 'package:mobile/features/device_search/device_status_repository.dart';
import 'package:mobile/features/home/home_tasks_page.dart';
import 'package:mobile/features/task/apply_config_picker_page.dart';
import 'package:mobile/features/task/apply_mode_provider.dart';
import 'package:mobile/features/task/config_apply_request_repository.dart';
import 'package:mobile/features/task/field_task_repository.dart';
import 'package:mobile/features/task/task_detail_page.dart';
import 'package:mobile/features/task/task_event_repository.dart';
import 'package:mobile/features/task/task_repository.dart';

import 'support/fake_config_apply_request_repository.dart';
import 'support/fake_field_task_repository.dart';

// เทสหน้าจริงที่เปิด polling (RealtimeController mockMode: false) เพราะเทสหน้าจอ
// อื่นรันในโหมด mock ซึ่ง Timer ปิดอยู่

const _taskTitle = 'ติดตั้งกล่อง GPS';

class _FakeAuth extends AuthController {
  @override
  AuthState build() =>
      const AuthState(status: AuthStatus.authenticated, role: UserRole.st);
}

Task _task() => Task(
  id: 't1',
  title: _taskTitle,
  assignedTo: 'u1',
  status: TaskStatus.inProgress,
  createdAt: DateTime(2026, 9, 1),
  updatedAt: DateTime(2026, 9, 2),
  deviceId: 'DVC-1',
);

class _FakeTasks implements TaskRepository {
  Object? error;

  @override
  Future<List<Task>> listTasks() async {
    if (error != null) throw error!;
    return [_task()];
  }

  @override
  Future<Task> getTask(String id) async {
    if (error != null) throw error!;
    return _task();
  }

  @override
  Future<Task> updateStatus(String id, TaskStatus status) =>
      throw UnimplementedError();
}

class _FakeEvents implements TaskEventRepository {
  Object? error;

  @override
  Future<List<TaskEvent>> getEvents(String taskId) async {
    if (error != null) throw error!;
    return const [];
  }

  @override
  Future<TaskEvent> addNote(String taskId, String note) =>
      throw UnimplementedError();
}

class _FakeDevices implements DeviceSearchRepository {
  @override
  Future<List<Device>> listDevices() => throw UnimplementedError();

  @override
  Future<Device> getDevice(String deviceId) async => Device(
    id: 'uuid-1',
    deviceId: deviceId,
    simNumber: '0812345678',
    deviceModel: 'GT06N',
    protocol: 'TCP',
    status: DeviceLifecycleStatus.installed,
    registeredAt: DateTime(2026, 6, 1),
  );
}

class _FakeStatus implements DeviceStatusRepository {
  Object? error;
  int calls = 0;

  @override
  Future<DeviceStatus> getDeviceStatus(String deviceId) async {
    calls++;
    if (error != null) throw error!;
    return DeviceStatus(
      deviceId: deviceId,
      configStatus: DevicePayloadStatus.unknown,
      firmwareStatus: DevicePayloadStatus.unknown,
      online: true,
    );
  }
}

class _FakeCentral implements DeviceCentralRepository {
  Object? error;

  @override
  Future<DeviceCentral> getDeviceCentral(String deviceId) async {
    if (error != null) throw error!;
    return const DeviceCentral(reachable: false);
  }
}

class _FakeOverride implements ConfigOverrideRepository {
  Object? error;

  @override
  Future<DeviceConfigDraft> getCurrentConfig(String deviceId) async {
    if (error != null) throw error!;
    return const DeviceConfigDraft(id: 'cfg-1', fields: {});
  }

  @override
  Future<List<ConfigFieldDefinition>> listDefinitions() async => const [];

  @override
  Future<DeviceConfigOverride> overrideConfig({
    required String deviceId,
    required Map<String, dynamic> fields,
    required String reason,
    String? configId,
  }) => throw UnimplementedError();
}

RealtimeController _liveController() {
  final controller = RealtimeController(mockMode: false)..start();
  controller.setAuthenticated(true);
  addTearDown(controller.dispose);
  return controller;
}

List<Override> _common(RealtimeController controller) => [
  realtimeControllerProvider.overrideWithValue(controller),
  authControllerProvider.overrideWith(_FakeAuth.new),
  tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
  sessionProfileStoreProvider.overrideWithValue(InMemorySessionProfileStore()),
  pendingTaskIdsProvider.overrideWith((ref) => Stream.value(const <String>{})),
  failedSyncActionsProvider.overrideWith(
    (ref) => Stream.value(const <PendingActionRow>[]),
  ),
  appDatabaseProvider.overrideWith((ref) {
    final db = AppDatabase.forTesting(NativeDatabase.memory());
    ref.onDispose(db.close);
    return db;
  }),
];

/// เลื่อนเวลาแล้วรอ future ของ fake ให้จบ
Future<void> _advance(WidgetTester tester, Duration by) async {
  await tester.pump(by);
  await tester.pump();
  await tester.pump();
}

void _setTallView(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 4000);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
}

void _expectNoFailureUi(WidgetTester tester) {
  expect(find.byType(AppErrorView), findsNothing);
  expect(find.byType(SnackBar), findsNothing);
  expect(find.byType(CircularProgressIndicator), findsNothing);
}

Future<void> _pumpTaskDetail(
  WidgetTester tester, {
  required RealtimeController controller,
  required TaskRepository tasks,
  required TaskEventRepository events,
  required FakeConfigApplyRequestRepository requests,
}) async {
  _setTallView(tester);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        ..._common(controller),
        taskRepositoryProvider.overrideWithValue(tasks),
        taskEventRepositoryProvider.overrideWithValue(events),
        configApplyRequestRepositoryProvider.overrideWithValue(requests),
      ],
      child: const MaterialApp(home: TaskDetailPage(taskId: 't1')),
    ),
  );
  await _advance(tester, Duration.zero);
  await _advance(tester, Duration.zero);
}

void main() {
  group('Task Detail', () {
    testWidgets(
      'มีคำขอกำลังทำงานโหลดทุก 5 วินาที จบแล้วเปลี่ยนเป็น 15 วินาที',
      (tester) async {
        final requests = FakeConfigApplyRequestRepository(
          requests: [
            fakeApplyRequest(status: ConfigApplyRequestStatus.sending),
          ],
        );
        await _pumpTaskDetail(
          tester,
          controller: _liveController(),
          tasks: _FakeTasks(),
          events: _FakeEvents(),
          requests: requests,
        );

        var before = requests.listCalls;
        await _advance(tester, const Duration(seconds: 5));
        expect(requests.listCalls, before + 1);

        requests.requests[0] = fakeApplyRequest(
          status: ConfigApplyRequestStatus.succeeded,
        );
        await _advance(tester, const Duration(seconds: 5));

        before = requests.listCalls;
        await _advance(tester, const Duration(seconds: 14));
        expect(requests.listCalls, before, reason: 'ยังไม่ครบ 15 วินาที');
        await _advance(tester, const Duration(seconds: 2));
        expect(requests.listCalls, before + 1);
      },
    );

    testWidgets('refresh พลาด เนื้อหาเดิมยังอยู่ และไม่มีหน้า error', (
      tester,
    ) async {
      final tasks = _FakeTasks();
      final events = _FakeEvents();
      final requests = FakeConfigApplyRequestRepository();
      await _pumpTaskDetail(
        tester,
        controller: _liveController(),
        tasks: tasks,
        events: events,
        requests: requests,
      );
      expect(find.text(_taskTitle), findsWidgets);

      final failure = ApiException('network down');
      tasks.error = failure;
      events.error = failure;
      requests.listError = failure;
      await _advance(tester, const Duration(seconds: 15));

      expect(find.text(_taskTitle), findsWidgets);
      _expectNoFailureUi(tester);
    });
  });

  testWidgets('งานทั้งหมด: refresh พลาด รายการเดิมยังอยู่', (tester) async {
    _setTallView(tester);
    final tasks = _FakeTasks();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          ..._common(_liveController()),
          taskRepositoryProvider.overrideWithValue(tasks),
        ],
        child: const MaterialApp(home: HomeTasksPage()),
      ),
    );
    await _advance(tester, Duration.zero);
    expect(find.text(_taskTitle), findsOneWidget);

    tasks.error = ApiException('network down');
    await _advance(tester, const Duration(seconds: 15));

    expect(find.text(_taskTitle), findsOneWidget);
    _expectNoFailureUi(tester);
  });

  testWidgets(
    'Device Detail: โหลดทุก 10 วินาที refresh พลาดแล้วเนื้อหาเดิมยังอยู่',
    (tester) async {
      _setTallView(tester);
      final status = _FakeStatus();
      final central = _FakeCentral();
      final override = _FakeOverride();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            ..._common(_liveController()),
            deviceSearchRepositoryProvider.overrideWithValue(_FakeDevices()),
            deviceStatusRepositoryProvider.overrideWithValue(status),
            deviceCentralRepositoryProvider.overrideWithValue(central),
            configOverrideRepositoryProvider.overrideWithValue(override),
            fieldTaskRepositoryProvider.overrideWithValue(
              FakeFieldTaskRepository(),
            ),
            openTaskForDeviceProvider.overrideWith((ref, _) async => null),
            centralApplyModeProvider.overrideWith((ref) async => false),
            deviceHistoryProvider.overrideWith(
              (ref, _) async => const DeviceHistoryResult(items: []),
            ),
            deviceApplyOptionsProvider.overrideWith(
              (ref, id) async => DeviceApplyOptions(
                deviceId: id,
                deviceInstalled: true,
                configs: const [],
              ),
            ),
          ],
          child: const MaterialApp(
            home: DeviceDetailPage(deviceId: 'DEV-0117'),
          ),
        ),
      );
      await _advance(tester, Duration.zero);
      await _advance(tester, Duration.zero);
      expect(find.textContaining('DEV-0117'), findsWidgets);

      final before = status.calls;
      await _advance(tester, const Duration(seconds: 10));
      expect(status.calls, before + 1);

      final failure = ApiException('network down');
      status.error = failure;
      central.error = failure;
      override.error = failure;
      await _advance(tester, const Duration(seconds: 10));

      expect(find.textContaining('DEV-0117'), findsWidgets);
      _expectNoFailureUi(tester);
    },
  );

  testWidgets('หน้าเลือก Config โหลดใหม่เมื่อกลับเข้ามา และไม่มี polling', (
    tester,
  ) async {
    _setTallView(tester);
    final requests = FakeConfigApplyRequestRepository();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          ..._common(_liveController()),
          configApplyRequestRepositoryProvider.overrideWithValue(requests),
          fieldTaskRepositoryProvider.overrideWithValue(
            FakeFieldTaskRepository(),
          ),
        ],
        child: MaterialApp(
          navigatorObservers: [mobileRouteObserver],
          home: const ApplyConfigPickerPage(deviceId: 'DVC-1'),
        ),
      ),
    );
    await _advance(tester, Duration.zero);

    final loaded = requests.optionsCalls;
    await _advance(tester, const Duration(seconds: 60));
    expect(requests.optionsCalls, loaded, reason: 'เลือกอยู่ต้องไม่โหลดเอง');

    final navigator = Navigator.of(
      tester.element(find.byType(ApplyConfigPickerPage)),
    );
    navigator.push<void>(
      MaterialPageRoute<void>(builder: (_) => const Scaffold()),
    );
    await tester.pumpAndSettle();
    navigator.pop();
    await tester.pumpAndSettle();

    expect(requests.optionsCalls, loaded + 1);
  });

  test('หน้าฟอร์มต้องไม่ใช้ LiveRefresh เพื่อไม่ให้ค่าที่กรอกถูกรบกวน', () {
    const forms = [
      'lib/features/task/apply_config_params_page.dart',
      'lib/features/task/apply_config_picker_page.dart',
      'lib/features/config_override/config_override_page.dart',
      'lib/features/firmware_override/firmware_override_page.dart',
      'lib/features/incident/field_report_page.dart',
      'lib/features/firmware_install/confirm_firmware_install_page.dart',
    ];
    for (final path in forms) {
      expect(
        File(path).readAsStringSync().contains('LiveRefresh'),
        isFalse,
        reason: path,
      );
    }
  });

  group('แอปกลับมาหรือเน็ตกลับมา', () {
    TestWidgetsFlutterBinding.ensureInitialized();

    test('ส่งคิว sync ให้จบก่อน แล้วจึงโหลดหน้าที่เปิดอยู่', () async {
      final db = AppDatabase.forTesting(NativeDatabase.memory());
      addTearDown(db.close);
      final order = <String>[];
      final gate = Completer<void>();
      final container = ProviderContainer(
        overrides: [
          authControllerProvider.overrideWith(_FakeAuth.new),
          syncConnectivityProvider.overrideWithValue(const Stream.empty()),
          syncQueueServiceProvider.overrideWithValue(
            _GatedSync(db, order, gate),
          ),
          realtimeControllerProvider.overrideWithValue(
            _RecordingController(order),
          ),
        ],
      );
      addTearDown(container.dispose);

      container.read(syncTriggersProvider).onTrigger();
      await Future<void>.delayed(Duration.zero);
      expect(order, isNot(contains('refresh')));

      gate.complete();
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(order.last, 'refresh');
      expect(order.indexOf('flushDone'), lessThan(order.indexOf('refresh')));
    });
  });
}

class _GatedSync extends SyncQueueService {
  _GatedSync(AppDatabase db, this.order, this.gate)
    : super(ApiClient(), db.pendingActionDao, db.taskDao);

  final List<String> order;
  final Completer<void> gate;

  @override
  Future<void> flush() async {
    order.add('flush');
    await gate.future;
    order.add('flushDone');
  }
}

class _RecordingController extends RealtimeController {
  _RecordingController(this.order) : super(mockMode: false);

  final List<String> order;

  @override
  void refreshActive() => order.add('refresh');
}
