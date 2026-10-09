import 'dart:async';

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

// ส่วนเสริมของ task_detail_simulator_test.dart ให้ครบ checklist ของ PR #281:
// เงื่อนไขที่ปุ่มโผล่, ปุ่มส่ง Config ยิง API ด้วย id ของงานจริงหลังผ่าน/ไม่ถูก
// เรียกตอนถูกบล็อก, กดทดสอบซ้อนไม่ได้, ผ่านแล้วกลับมาไม่ผ่านใหม่ต้องสร้าง
// Incident รอบใหม่. (ไฟล์เดิมไม่ถูกแก้ — กันชนกับ PR อื่น)

class _Auth extends AuthController {
  _Auth(this._role);
  final UserRole _role;

  @override
  AuthState build() => AuthState(status: AuthStatus.authenticated, role: _role);
}

Task _task({
  TaskStatus status = TaskStatus.inProgress,
  String? deviceId = 'DVC-1',
  String? configId = 'cfg-1',
}) => Task(
  id: 't1',
  title: 'ติดตั้งกล่อง GPS',
  assignedTo: 'u1',
  status: status,
  createdAt: DateTime(2026, 9, 1, 8),
  updatedAt: DateTime(2026, 9, 2, 9, 30),
  deviceId: deviceId,
  configId: configId,
);

class _TaskRepo implements TaskRepository {
  _TaskRepo(this.task);
  final Task task;

  @override
  Future<List<Task>> listTasks() async => [task];
  @override
  Future<Task> getTask(String id) async => task;
  @override
  Future<Task> updateStatus(String id, TaskStatus status) async => task;
}

class _ConfirmRepo implements ConfirmInstallRepository {
  final List<(String, String)> calls = [];

  @override
  Future<ConfigApplyResult> applyConfig({
    required String deviceId,
    required String configId,
  }) async {
    calls.add((deviceId, configId));
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

/// Pops scripted outcomes (result | Exception); the last one repeats. If
/// [gate] is set, each call waits for it (request in flight).
class _SimRepo implements SimulatorRepository {
  _SimRepo(this._outcomes);
  final List<Object> _outcomes;
  Completer<void>? gate;
  int calls = 0;

  @override
  Future<DeviceSimulateConfigResult> simulate({
    required String deviceId,
    required String configId,
  }) async {
    calls++;
    final next = _outcomes.length > 1 ? _outcomes.removeAt(0) : _outcomes.first;
    if (gate != null) await gate!.future;
    if (next is Exception) throw next;
    return next as DeviceSimulateConfigResult;
  }
}

class _IncidentRepo implements IncidentRepository {
  _IncidentRepo({this.fail = false});
  bool fail;
  int created = 0;

  @override
  Future<Incident> createFieldReport({
    required String title,
    required String description,
    required IncidentSeverity severity,
    String? deviceId,
  }) async {
    created++;
    if (fail) throw ApiException('ออฟไลน์');
    return Incident(
      id: 'inc-$created',
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
  required _SimRepo sim,
  required _IncidentRepo incidents,
  required _ConfirmRepo confirm,
  Task? task,
  UserRole role = UserRole.st,
}) async {
  tester.view.physicalSize = const Size(800, 3000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        taskRepositoryProvider.overrideWithValue(_TaskRepo(task ?? _task())),
        authControllerProvider.overrideWith(() => _Auth(role)),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
        sessionProfileStoreProvider.overrideWithValue(
          InMemorySessionProfileStore(),
        ),
        confirmInstallRepositoryProvider.overrideWithValue(confirm),
        simulatorRepositoryProvider.overrideWithValue(sim),
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
  late _IncidentRepo incidents;
  late _ConfirmRepo confirm;

  setUp(() {
    incidents = _IncidentRepo();
    confirm = _ConfirmRepo();
  });

  group(
    'เงื่อนไขที่ปุ่มทดสอบโผล่ (in_progress + configId + deviceId + ST/OT)',
    () {
      testWidgets('in_progress + ครบ + ST -> เห็นปุ่มทดสอบและปุ่มส่ง Config', (
        tester,
      ) async {
        await _pump(
          tester,
          sim: _SimRepo([_result(passed: true)]),
          incidents: incidents,
          confirm: confirm,
        );
        expect(_simulateButton, findsOneWidget);
        expect(_applyButton, findsOneWidget);
      });

      testWidgets('OT ก็เห็นปุ่ม', (tester) async {
        await _pump(
          tester,
          sim: _SimRepo([_result(passed: true)]),
          incidents: incidents,
          confirm: confirm,
          role: UserRole.ot,
        );
        expect(_simulateButton, findsOneWidget);
      });

      for (final status in [
        TaskStatus.pending,
        TaskStatus.completed,
        TaskStatus.cancelled,
      ]) {
        testWidgets('งานสถานะ ${status.wireName} -> ไม่มีปุ่มทดสอบ/ปุ่มส่ง', (
          tester,
        ) async {
          await _pump(
            tester,
            sim: _SimRepo([_result(passed: true)]),
            incidents: incidents,
            confirm: confirm,
            task: _task(status: status),
          );
          expect(_simulateButton, findsNothing);
          expect(_applyButton, findsNothing);
        });
      }

      testWidgets('ไม่มี configId -> ไม่มีปุ่ม', (tester) async {
        await _pump(
          tester,
          sim: _SimRepo([_result(passed: true)]),
          incidents: incidents,
          confirm: confirm,
          task: _task(configId: null),
        );
        expect(_simulateButton, findsNothing);
        expect(_applyButton, findsNothing);
      });

      testWidgets('ไม่มี deviceId -> ไม่มีปุ่ม', (tester) async {
        await _pump(
          tester,
          sim: _SimRepo([_result(passed: true)]),
          incidents: incidents,
          confirm: confirm,
          task: _task(deviceId: null),
        );
        expect(_simulateButton, findsNothing);
        expect(_applyButton, findsNothing);
      });

      for (final role in [UserRole.operation, UserRole.auditor]) {
        testWidgets('role ${role.wireName} (ไม่ใช่ ST/OT) -> ไม่มีปุ่ม', (
          tester,
        ) async {
          await _pump(
            tester,
            sim: _SimRepo([_result(passed: true)]),
            incidents: incidents,
            confirm: confirm,
            role: role,
          );
          expect(_simulateButton, findsNothing);
          expect(_applyButton, findsNothing);
        });
      }
    },
  );

  group('ปุ่มส่ง Config เมื่อถูกบล็อก / ปลดบล็อก', () {
    testWidgets('ไม่ผ่าน -> แตะปุ่มส่ง Config แล้วไม่มี API apply ถูกเรียก', (
      tester,
    ) async {
      await _pump(
        tester,
        sim: _SimRepo([_result(passed: false)]),
        incidents: incidents,
        confirm: confirm,
      );
      await _runSimulation(tester);
      expect(_applyEnabled(tester), isFalse);

      await tester.tap(_applyButton, warnIfMissed: false);
      await tester.pump();
      await tester.pump();

      expect(confirm.calls, isEmpty);
    });

    testWidgets('ไม่ผ่าน -> ทดสอบซ้ำผ่าน -> ส่ง Config ด้วย deviceId/configId '
        'ของงาน, notice ของ Incident หายไป', (tester) async {
      await _pump(
        tester,
        sim: _SimRepo([_result(passed: false), _result(passed: true)]),
        incidents: incidents,
        confirm: confirm,
      );
      await _runSimulation(tester);
      expect(find.byKey(const Key('simulate_incident_notice')), findsOneWidget);

      await _runSimulation(tester);
      expect(_applyEnabled(tester), isTrue);
      expect(find.byKey(const Key('simulate_incident_notice')), findsNothing);

      await tester.tap(_applyButton);
      await tester.pump();
      await tester.pump();
      expect(confirm.calls, [('DVC-1', 'cfg-1')]);
    });

    testWidgets('ผ่าน -> กลับมาไม่ผ่านอีกรอบ = ถือเป็นรอบใหม่ สร้าง Incident '
        'ใหม่ และบล็อกปุ่มอีกครั้ง', (tester) async {
      await _pump(
        tester,
        sim: _SimRepo([
          _result(passed: false),
          _result(passed: true),
          _result(passed: false),
        ]),
        incidents: incidents,
        confirm: confirm,
      );

      await _runSimulation(tester);
      expect(incidents.created, 1);
      await _runSimulation(tester);
      expect(incidents.created, 1); // ผ่านไม่สร้าง
      expect(_applyEnabled(tester), isTrue);

      await _runSimulation(tester);
      expect(incidents.created, 2);
      expect(_applyEnabled(tester), isFalse);
    });

    testWidgets('สร้าง Incident ล้มแล้วทดสอบซ้ำยังไม่ผ่าน -> ไม่ retry '
        '(ยังเป็น 1 ครั้ง) และปุ่มยังบล็อก', (tester) async {
      incidents = _IncidentRepo(fail: true);
      await _pump(
        tester,
        sim: _SimRepo([_result(passed: false)]),
        incidents: incidents,
        confirm: confirm,
      );

      await _runSimulation(tester);
      await _runSimulation(tester);

      expect(incidents.created, 1);
      expect(_applyEnabled(tester), isFalse);
      expect(tester.takeException(), isNull);
    });
  });

  group('ระหว่างทดสอบ / simulate เองล้ม', () {
    testWidgets('กำลังทดสอบ -> ปุ่มทดสอบถูก disable (กดซ้อนไม่ได้) จบแล้วกด '
        'ได้อีก', (tester) async {
      final sim = _SimRepo([_result(passed: true)])..gate = Completer<void>();
      await _pump(tester, sim: sim, incidents: incidents, confirm: confirm);

      await tester.tap(_simulateButton);
      await tester.pump();
      expect(tester.widget<OutlinedButton>(_simulateButton).onPressed, isNull);
      await tester.tap(_simulateButton, warnIfMissed: false);
      await tester.pump();
      expect(sim.calls, 1);

      sim.gate!.complete();
      await tester.pump();
      await tester.pump();
      expect(
        tester.widget<OutlinedButton>(_simulateButton).onPressed,
        isNotNull,
      );
    });

    testWidgets('simulate ล้มแล้วกดทดสอบใหม่สำเร็จ -> error หาย แสดงผลปกติ', (
      tester,
    ) async {
      await _pump(
        tester,
        sim: _SimRepo([ApiException('เชื่อมต่อไม่ได้'), _result(passed: true)]),
        incidents: incidents,
        confirm: confirm,
      );

      await _runSimulation(tester);
      expect(find.byKey(const Key('simulate_error')), findsOneWidget);
      expect(_applyEnabled(tester), isTrue);

      await _runSimulation(tester);
      expect(find.byKey(const Key('simulate_error')), findsNothing);
      expect(find.byKey(const Key('simulate_result')), findsOneWidget);
    });
  });
}
