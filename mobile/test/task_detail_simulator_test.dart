import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/features/config_simulator/simulator_repository.dart';
import 'package:mobile/features/incident/incident_repository.dart';
import 'package:mobile/features/task/confirm_install_repository.dart';
import 'package:mobile/features/task/task_detail_page.dart';
import 'package:mobile/features/task/task_repository.dart';

// แถว 26b — ปุ่ม "ทดสอบกับ Device Simulator" ก่อนส่ง Config เข้าเครื่อง
// (Config-only). แยกไฟล์จาก task_detail_page_test.dart เพื่อไม่ชนกับ PR อื่น
// ที่แก้ไฟล์นั้น.

class _FakeAuthController extends AuthController {
  @override
  AuthState build() =>
      const AuthState(status: AuthStatus.authenticated, role: UserRole.st);
}

final _task = Task(
  id: 't1',
  title: 'ติดตั้งกล่อง GPS',
  assignedTo: 'u1',
  status: TaskStatus.inProgress,
  createdAt: DateTime(2026, 9, 1, 8),
  updatedAt: DateTime(2026, 9, 2, 9, 30),
  deviceId: 'DVC-1',
  configId: 'cfg-1',
);

class _FakeTaskRepository implements TaskRepository {
  @override
  Future<List<Task>> listTasks() async => [_task];

  @override
  Future<Task> getTask(String id) async => _task;

  @override
  Future<Task> updateStatus(String id, TaskStatus status) async => _task;
}

class _FakeConfirmInstallRepository implements ConfirmInstallRepository {
  int calls = 0;

  @override
  Future<ConfigApplyResult> applyConfig({
    required String deviceId,
    required String configId,
  }) async {
    calls++;
    return ConfigApplyResult(
      applied: true,
      details: const ['ok'],
      appliedAt: DateTime(2026, 9, 11),
    );
  }
}

DeviceSimulateConfigResult _result({required bool passed}) =>
    DeviceSimulateConfigResult(
      passed: passed,
      configCheck: SimulationResult(
        passed: passed,
        details: [passed ? 'ทุก field ผ่าน' : 'APN ไม่ถูกต้อง'],
      ),
      compatibilityCheck: const CompatibilityCheckResult(
        passed: true,
        details: ['ตรงกับอุปกรณ์'],
      ),
      connectionCheck: DeviceConnectionTestResult(
        passed: true,
        signalStrength: -65,
        details: const ['ออนไลน์'],
        testedAt: DateTime(2026, 9, 11),
      ),
    );

/// Scripted: pops the next outcome (a result, or an exception to throw).
class _FakeSimulatorRepository implements SimulatorRepository {
  _FakeSimulatorRepository(this._outcomes);

  final List<Object> _outcomes;
  final List<(String, String)> calls = [];

  @override
  Future<DeviceSimulateConfigResult> simulate({
    required String deviceId,
    required String configId,
  }) async {
    calls.add((deviceId, configId));
    final next = _outcomes.length > 1 ? _outcomes.removeAt(0) : _outcomes.first;
    if (next is Exception) throw next;
    return next as DeviceSimulateConfigResult;
  }
}

class _FakeIncidentRepository implements IncidentRepository {
  _FakeIncidentRepository({this.error});

  final Object? error;
  final List<Map<String, Object?>> created = [];

  @override
  Future<Incident> createFieldReport({
    required String title,
    required String description,
    required IncidentSeverity severity,
    String? deviceId,
  }) async {
    created.add({
      'title': title,
      'description': description,
      'severity': severity,
      'deviceId': deviceId,
    });
    if (error != null) throw error!;
    return Incident(
      id: 'inc-1',
      title: title,
      description: description,
      severity: severity,
      status: IncidentStatus.open,
      source: 'field-report',
      reportedBy: 'u1',
      deviceId: deviceId,
      createdAt: DateTime(2026, 9, 11),
      updatedAt: DateTime(2026, 9, 11),
    );
  }

  @override
  Future<List<Incident>> listIncidents() async => const [];

  @override
  Future<Incident> getIncident(String id) async =>
      throw ApiException('ไม่พบ', statusCode: 404);
}

Future<void> _pump(
  WidgetTester tester, {
  required _FakeSimulatorRepository simulator,
  required _FakeIncidentRepository incidents,
  required _FakeConfirmInstallRepository confirm,
}) async {
  tester.view.physicalSize = const Size(800, 3000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        taskRepositoryProvider.overrideWithValue(_FakeTaskRepository()),
        authControllerProvider.overrideWith(() => _FakeAuthController()),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
        sessionProfileStoreProvider.overrideWithValue(
          InMemorySessionProfileStore(),
        ),
        confirmInstallRepositoryProvider.overrideWithValue(confirm),
        simulatorRepositoryProvider.overrideWithValue(simulator),
        incidentRepositoryProvider.overrideWithValue(incidents),
      ],
      child: const MaterialApp(home: TaskDetailPage(taskId: 't1')),
    ),
  );
  await tester.pump(); // resolve getTask
}

Finder get _simulateButton => find.byKey(const Key('simulate_test_button'));
Finder get _applyButton => find.byKey(const Key('confirm_install_button'));

bool _applyEnabled(WidgetTester tester) =>
    tester.widget<FilledButton>(_applyButton).onPressed != null;

Future<void> _runSimulation(WidgetTester tester) async {
  await tester.tap(_simulateButton);
  await tester.pump();
  await tester.pump();
}

void main() {
  late _FakeIncidentRepository incidents;
  late _FakeConfirmInstallRepository confirm;

  setUp(() {
    incidents = _FakeIncidentRepository();
    confirm = _FakeConfirmInstallRepository();
  });

  testWidgets('ข้ามการทดสอบ -> ปุ่มส่ง Config กดได้ปกติ ไม่มีผล/Incident', (
    tester,
  ) async {
    final sim = _FakeSimulatorRepository([_result(passed: true)]);
    await _pump(tester, simulator: sim, incidents: incidents, confirm: confirm);

    expect(_simulateButton, findsOneWidget);
    expect(_applyEnabled(tester), isTrue);
    expect(find.byKey(const Key('simulate_result')), findsNothing);

    await tester.tap(_applyButton);
    await tester.pump();
    await tester.pump();

    expect(confirm.calls, 1);
    expect(sim.calls, isEmpty);
    expect(incidents.created, isEmpty);
  });

  testWidgets('ทดสอบผ่าน -> แสดงผล 3 ส่วน, ปุ่มส่ง Config ยังกดได้, ไม่สร้าง '
      'Incident', (tester) async {
    final sim = _FakeSimulatorRepository([_result(passed: true)]);
    await _pump(tester, simulator: sim, incidents: incidents, confirm: confirm);

    await _runSimulation(tester);

    expect(sim.calls, [('DVC-1', 'cfg-1')]); // ใช้ deviceId/configId ของงาน
    expect(find.byKey(const Key('simulate_result')), findsOneWidget);
    expect(find.text('พร้อมติดตั้ง'), findsOneWidget);
    expect(find.text('Config — ผ่าน'), findsOneWidget);
    expect(find.text('ความเข้ากันได้กับอุปกรณ์ — ผ่าน'), findsOneWidget);
    expect(find.text('สัญญาณอุปกรณ์ — ผ่าน'), findsOneWidget);
    expect(_applyEnabled(tester), isTrue);
    expect(find.byKey(const Key('simulate_blocked_message')), findsNothing);
    expect(incidents.created, isEmpty);
  });

  testWidgets('ทดสอบไม่ผ่าน -> ปุ่มส่ง Config ถูก disable + สร้าง Incident '
      '(prefix [Simulator Check], severity low, deviceId)', (tester) async {
    final sim = _FakeSimulatorRepository([_result(passed: false)]);
    await _pump(tester, simulator: sim, incidents: incidents, confirm: confirm);

    await _runSimulation(tester);

    expect(find.text('ยังไม่พร้อมติดตั้ง'), findsOneWidget);
    expect(_applyEnabled(tester), isFalse);
    expect(find.byKey(const Key('simulate_blocked_message')), findsOneWidget);

    expect(incidents.created, hasLength(1));
    final incident = incidents.created.single;
    expect(incident['deviceId'], 'DVC-1');
    expect(incident['severity'], IncidentSeverity.low);
    final description = incident['description']! as String;
    expect(description, startsWith('[Simulator Check] '));
    expect(description, contains('APN ไม่ถูกต้อง'));
    expect(description, contains('Config: ไม่ผ่าน'));
    expect(find.byKey(const Key('simulate_incident_notice')), findsOneWidget);
  });

  testWidgets(
    'ไม่ผ่านแล้วทดสอบซ้ำ: ยังไม่ผ่าน -> ไม่สร้าง Incident ซ้ำ, ผ่าน -> '
    'ปลดบล็อก',
    (tester) async {
      final sim = _FakeSimulatorRepository([
        _result(passed: false),
        _result(passed: false),
        _result(passed: true),
      ]);
      await _pump(
        tester,
        simulator: sim,
        incidents: incidents,
        confirm: confirm,
      );

      await _runSimulation(tester);
      await _runSimulation(tester);
      expect(_applyEnabled(tester), isFalse);
      expect(incidents.created, hasLength(1));

      await _runSimulation(tester);
      expect(_applyEnabled(tester), isTrue);
      expect(find.byKey(const Key('simulate_blocked_message')), findsNothing);
      expect(incidents.created, hasLength(1));
    },
  );

  testWidgets(
    'สร้าง Incident ล้ม (ออฟไลน์) -> ไม่ crash, ปุ่มยัง disable อยู่, '
    'ไม่ retry',
    (tester) async {
      incidents = _FakeIncidentRepository(error: ApiException('ออฟไลน์'));
      final sim = _FakeSimulatorRepository([_result(passed: false)]);
      await _pump(
        tester,
        simulator: sim,
        incidents: incidents,
        confirm: confirm,
      );

      await _runSimulation(tester);

      expect(tester.takeException(), isNull);
      expect(_applyEnabled(tester), isFalse);
      expect(incidents.created, hasLength(1)); // ลองครั้งเดียว
      expect(
        find.text('สร้าง Incident อัตโนมัติไม่สำเร็จ (ไม่กระทบการทดสอบ)'),
        findsOneWidget,
      );
    },
  );

  testWidgets('เรียก simulate เองล้ม (ออฟไลน์) -> แสดง error แต่ไม่บล็อกปุ่ม '
      'ส่ง Config และไม่สร้าง Incident', (tester) async {
    final sim = _FakeSimulatorRepository([ApiException('เชื่อมต่อไม่ได้')]);
    await _pump(tester, simulator: sim, incidents: incidents, confirm: confirm);

    await _runSimulation(tester);

    expect(find.byKey(const Key('simulate_error')), findsOneWidget);
    expect(find.text('เชื่อมต่อไม่ได้'), findsOneWidget);
    expect(_applyEnabled(tester), isTrue);
    expect(incidents.created, isEmpty);
  });

  test('simulationIncidentDescription: prefix, ครบ 3 ส่วน, ไม่เกิน 2000 '
      'ตัวอักษร', () {
    final long = DeviceSimulateConfigResult(
      passed: false,
      configCheck: SimulationResult(
        passed: false,
        details: List.filled(500, 'รายละเอียดยาวมาก'),
      ),
      compatibilityCheck: const CompatibilityCheckResult(
        passed: false,
        details: ['ไม่ตรงรุ่น'],
      ),
      connectionCheck: DeviceConnectionTestResult(
        passed: false,
        signalStrength: -99,
        details: const ['ออฟไลน์'],
        testedAt: DateTime(2026, 9, 11),
      ),
    );

    final text = simulationIncidentDescription('DVC-1', long);
    expect(text, startsWith('[Simulator Check] '));
    expect(text.length, lessThanOrEqualTo(2000));

    final short = simulationIncidentDescription(
      'DVC-1',
      _result(passed: false),
    );
    expect(short, contains('Config: ไม่ผ่าน'));
    expect(short, contains('ความเข้ากันได้กับอุปกรณ์: ผ่าน'));
    expect(short, contains('สัญญาณอุปกรณ์: ผ่าน'));
    expect(short, contains('-65 dBm'));
  });
}
