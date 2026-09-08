import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/features/config_simulator/config_repository.dart';
import 'package:mobile/features/config_simulator/simulator_page.dart';
import 'package:mobile/features/config_simulator/simulator_repository.dart';
import 'package:mobile/features/task/task_repository.dart';

class _FakeAuthController extends AuthController {
  _FakeAuthController(this._role);

  final UserRole? _role;

  @override
  AuthState build() => AuthState(status: AuthStatus.authenticated, role: _role);
}

Task _task({required String id, String? deviceId}) => Task(
  id: id,
  title: 'งาน $id',
  assignedTo: 'u1',
  status: TaskStatus.pending,
  createdAt: DateTime(2026, 9, 1),
  updatedAt: DateTime(2026, 9, 1),
  deviceId: deviceId,
);

class _FakeTaskRepository implements TaskRepository {
  _FakeTaskRepository({List<Task>? tasks, this.error})
    : _tasks = tasks ?? const [];

  final List<Task> _tasks;
  final Object? error;

  @override
  Future<List<Task>> listTasks() async {
    if (error != null) throw error!;
    return _tasks;
  }

  @override
  Future<Task> getTask(String id) async => throw UnimplementedError();

  @override
  Future<Task> updateStatus(String id, TaskStatus status) async =>
      throw UnimplementedError();
}

DeviceConfigDraft _config({
  required String id,
  ConfigStatus status = ConfigStatus.approved,
  String deviceModel = 'GT06N',
}) => DeviceConfigDraft(
  id: id,
  deviceModel: deviceModel,
  protocol: 'TCP',
  status: status,
);

/// A fully-passing [DeviceSimulateConfigResult] with each field overridable —
/// keeps the per-test noise down.
DeviceSimulateConfigResult _simResult({
  bool passed = true,
  SimulationResult? configCheck,
  CompatibilityCheckResult? compatibilityCheck,
  DeviceConnectionTestResult? connectionCheck,
}) => DeviceSimulateConfigResult(
  passed: passed,
  configCheck:
      configCheck ??
      const SimulationResult(passed: true, details: ['ทุก field ผ่าน']),
  compatibilityCheck:
      compatibilityCheck ??
      const CompatibilityCheckResult(
        passed: true,
        details: ['GT06N/TCP ตรงกับอุปกรณ์'],
      ),
  connectionCheck:
      connectionCheck ??
      DeviceConnectionTestResult(
        passed: true,
        signalStrength: -65,
        details: const ['อุปกรณ์ออนไลน์'],
        testedAt: DateTime(2026, 9, 8),
      ),
);

class _FakeConfigRepository implements ConfigRepository {
  _FakeConfigRepository({List<DeviceConfigDraft>? configs, this.error})
    : _configs = configs ?? const [];

  final List<DeviceConfigDraft> _configs;
  final Object? error;

  @override
  Future<List<DeviceConfigDraft>> listConfigs() async {
    if (error != null) throw error!;
    return _configs;
  }
}

class _FakeSimulatorRepository implements SimulatorRepository {
  _FakeSimulatorRepository({this.result, this.error});

  final DeviceSimulateConfigResult? result;
  final Object? error;

  String? lastDeviceId;
  String? lastConfigId;

  @override
  Future<DeviceSimulateConfigResult> simulate({
    required String deviceId,
    required String configId,
  }) async {
    lastDeviceId = deviceId;
    lastConfigId = configId;
    if (error != null) throw error!;
    return result!;
  }
}

Future<void> _pump(
  WidgetTester tester, {
  UserRole role = UserRole.st,
  List<Task>? tasks,
  Object? tasksError,
  List<DeviceConfigDraft>? configs,
  Object? configsError,
  DeviceSimulateConfigResult? simulateResult,
  Object? simulateError,
  _FakeSimulatorRepository? simulatorRepo,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authControllerProvider.overrideWith(() => _FakeAuthController(role)),
        taskRepositoryProvider.overrideWithValue(
          _FakeTaskRepository(tasks: tasks, error: tasksError),
        ),
        configRepositoryProvider.overrideWithValue(
          _FakeConfigRepository(configs: configs, error: configsError),
        ),
        simulatorRepositoryProvider.overrideWithValue(
          simulatorRepo ??
              _FakeSimulatorRepository(
                result: simulateResult,
                error: simulateError,
              ),
        ),
      ],
      child: const MaterialApp(home: SimulatorPage()),
    ),
  );
  await tester.pumpAndSettle();
}

Finder get _runButton => find.byKey(const Key('simulator_run'));

Future<void> _selectDropdown(
  WidgetTester tester,
  Key dropdownKey,
  String itemText,
) async {
  await tester.tap(find.byKey(dropdownKey));
  await tester.pumpAndSettle();
  await tester.tap(find.text(itemText).last);
  await tester.pumpAndSettle();
}

void main() {
  final twoDevices = [
    _task(id: 't1', deviceId: 'DVC-2'),
    _task(id: 't2', deviceId: 'DVC-1'),
    _task(id: 't3', deviceId: 'DVC-1'), // ซ้ำ — ต้อง dedupe
  ];
  final threeConfigsMixedStatus = [
    _config(id: 'cfg-approved', status: ConfigStatus.approved),
    _config(id: 'cfg-synced', status: ConfigStatus.synced),
    _config(id: 'cfg-draft', status: ConfigStatus.draft),
  ];

  testWidgets('render — device dropdown มีเฉพาะอุปกรณ์ของ user (dedupe แล้ว)', (
    tester,
  ) async {
    await _pump(tester, tasks: twoDevices, configs: threeConfigsMixedStatus);

    await tester.tap(find.byKey(const Key('simulator_device_dropdown')));
    await tester.pumpAndSettle();

    expect(find.text('DVC-1'), findsOneWidget);
    expect(find.text('DVC-2'), findsOneWidget);
  });

  testWidgets(
    'render — config dropdown แสดงเฉพาะ approved/synced (ตัด draft ออก)',
    (tester) async {
      await _pump(tester, tasks: twoDevices, configs: threeConfigsMixedStatus);

      await tester.tap(find.byKey(const Key('simulator_config_dropdown')));
      await tester.pumpAndSettle();

      expect(find.text('GT06N/TCP · approved'), findsOneWidget);
      expect(find.text('GT06N/TCP · synced'), findsOneWidget);
      expect(find.text('GT06N/TCP · draft'), findsNothing);
    },
  );

  testWidgets('ปุ่มทดสอบความพร้อม disable จนกว่าจะเลือกครบทั้ง 2 ช่อง', (
    tester,
  ) async {
    await _pump(tester, tasks: twoDevices, configs: threeConfigsMixedStatus);

    expect(tester.widget<FilledButton>(_runButton).onPressed, isNull);

    await _selectDropdown(
      tester,
      const Key('simulator_device_dropdown'),
      'DVC-1',
    );
    expect(tester.widget<FilledButton>(_runButton).onPressed, isNull);

    await _selectDropdown(
      tester,
      const Key('simulator_config_dropdown'),
      'GT06N/TCP · approved',
    );
    expect(tester.widget<FilledButton>(_runButton).onPressed, isNotNull);
  });

  testWidgets(
    'เลือกครบแล้วกดทดสอบ -> เรียก repo ด้วย deviceId + configId ที่เลือก + '
    'แสดงผล 3 ส่วน',
    (tester) async {
      final repo = _FakeSimulatorRepository(result: _simResult());
      await _pump(
        tester,
        tasks: twoDevices,
        configs: threeConfigsMixedStatus,
        simulatorRepo: repo,
      );

      await _selectDropdown(
        tester,
        const Key('simulator_device_dropdown'),
        'DVC-1',
      );
      await _selectDropdown(
        tester,
        const Key('simulator_config_dropdown'),
        'GT06N/TCP · approved',
      );

      await tester.tap(_runButton);
      await tester.pump(); // kick off _run
      await tester.pumpAndSettle();

      expect(repo.lastDeviceId, 'DVC-1');
      expect(repo.lastConfigId, 'cfg-approved');
      expect(find.text('พร้อมติดตั้ง'), findsOneWidget);
      expect(find.text('Config — ผ่าน'), findsOneWidget);
      expect(find.text('ความเข้ากันได้กับอุปกรณ์ — ผ่าน'), findsOneWidget);
      expect(find.text('สัญญาณอุปกรณ์ — ผ่าน'), findsOneWidget);
      expect(find.text('• ทุก field ผ่าน'), findsOneWidget);
      expect(find.text('• GT06N/TCP ตรงกับอุปกรณ์'), findsOneWidget);
      expect(find.text('• แรงสัญญาณ: -65 dBm'), findsOneWidget);
    },
  );

  testWidgets(
    'compatibilityCheck ไม่ผ่าน -> ผลรวม "ยังไม่พร้อมติดตั้ง" + บล็อกนั้นโชว์เหตุผล',
    (tester) async {
      await _pump(
        tester,
        tasks: twoDevices,
        configs: threeConfigsMixedStatus,
        simulateResult: _simResult(
          passed: false,
          compatibilityCheck: const CompatibilityCheckResult(
            passed: false,
            details: ['Config เป็น GT06L แต่อุปกรณ์เป็น GT06N'],
          ),
        ),
      );

      await _selectDropdown(
        tester,
        const Key('simulator_device_dropdown'),
        'DVC-1',
      );
      await _selectDropdown(
        tester,
        const Key('simulator_config_dropdown'),
        'GT06N/TCP · approved',
      );
      await tester.tap(_runButton);
      await tester.pumpAndSettle();

      expect(find.text('ยังไม่พร้อมติดตั้ง'), findsOneWidget);
      expect(find.text('ความเข้ากันได้กับอุปกรณ์ — ไม่ผ่าน'), findsOneWidget);
      expect(
        find.text('• Config เป็น GT06L แต่อุปกรณ์เป็น GT06N'),
        findsOneWidget,
      );
      // ส่วนที่ยังผ่านยังแสดง "ผ่าน" ของตัวเอง
      expect(find.text('Config — ผ่าน'), findsOneWidget);
    },
  );

  testWidgets(
    'backend ล่มตอนกดทดสอบ -> ข้อความ error จาก ApiException.message ไม่ใช่ raw exception',
    (tester) async {
      await _pump(
        tester,
        tasks: twoDevices,
        configs: threeConfigsMixedStatus,
        simulateError: ApiException(
          'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง',
        ),
      );

      await _selectDropdown(
        tester,
        const Key('simulator_device_dropdown'),
        'DVC-1',
      );
      await _selectDropdown(
        tester,
        const Key('simulator_config_dropdown'),
        'GT06N/TCP · approved',
      );
      await tester.tap(_runButton);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('simulator_run_error')), findsOneWidget);
      expect(
        find.text(
          'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง',
        ),
        findsOneWidget,
      );
      // ปุ่มกลับมากดได้อีกครั้ง (ไม่ค้าง loading)
      expect(tester.widget<FilledButton>(_runButton).onPressed, isNotNull);
    },
  );

  testWidgets(
    'user ไม่มีอุปกรณ์ถูกมอบหมายเลย -> ข้อความแจ้ง ไม่ใช่ dropdown ว่างๆ',
    (tester) async {
      await _pump(tester, tasks: const [], configs: threeConfigsMixedStatus);

      expect(find.byKey(const Key('simulator_device_empty')), findsOneWidget);
      expect(find.byKey(const Key('simulator_device_dropdown')), findsNothing);
    },
  );

  testWidgets('ไม่มี Config ที่พร้อมทดสอบ (ทุกตัวยัง draft) -> ข้อความแจ้ง', (
    tester,
  ) async {
    await _pump(
      tester,
      tasks: twoDevices,
      configs: [_config(id: 'c1', status: ConfigStatus.draft)],
    );

    expect(find.byKey(const Key('simulator_config_empty')), findsOneWidget);
  });
}
