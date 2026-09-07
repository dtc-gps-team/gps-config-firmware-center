import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/features/config_simulator/simulator_repository.dart';
import 'package:mobile/features/task/task_repository.dart';

class _FakeAuthController extends AuthController {
  _FakeAuthController(this._role);

  final UserRole? _role;

  @override
  AuthState build() => AuthState(status: AuthStatus.authenticated, role: _role);
}

class _FakeTaskRepository implements TaskRepository {
  _FakeTaskRepository(this._tasks);

  final List<Task> _tasks;

  @override
  Future<List<Task>> listTasks() async => _tasks;

  @override
  Future<Task> getTask(String id) async => _tasks.firstWhere((t) => t.id == id);

  @override
  Future<Task> updateStatus(String id, TaskStatus status) async =>
      throw UnimplementedError();
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

/// `ApiClient.simulateConfig` error-mapping is already covered end-to-end in
/// `api_client_test.dart` — this fake just proves `ApiSimulatorRepository`
/// forwards to it with the right configId.
class _RecordingDio {
  RequestOptions? lastRequest;

  Dio build(Object? body, {int statusCode = 200}) {
    final dio = Dio(BaseOptions(baseUrl: 'http://test.local'))
      ..httpClientAdapter = _FakeAdapter(this, body, statusCode: statusCode);
    return dio;
  }
}

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.recorder, this.body, {this.statusCode = 200});

  final _RecordingDio recorder;
  final Object? body;
  final int statusCode;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    recorder.lastRequest = options;
    return ResponseBody.fromString(
      jsonEncode(body),
      statusCode,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  group('MockSimulatorRepository', () {
    test('configId ไม่ว่าง -> passed + details มี MOCK/ค่าที่ส่ง', () async {
      final result = await MockSimulatorRepository().simulate(
        configId: 'cfg-1',
      );

      expect(result.passed, isTrue);
      expect(result.details.first, startsWith('MOCK'));
      expect(result.details, contains('configId = cfg-1'));
      expect(
        result.details.any((line) => line.contains('ผ่านการตรวจ')),
        isTrue,
      );
    });

    test('configId ว่าง -> ไม่ผ่าน + แจ้งให้ระบุ', () async {
      final result = await MockSimulatorRepository().simulate(configId: '');

      expect(result.passed, isFalse);
      expect(result.details, contains('ต้องระบุ configId'));
    });

    test('configId เป็น whitespace ล้วน -> ไม่ผ่าน', () async {
      final result = await MockSimulatorRepository().simulate(configId: '   ');
      expect(result.passed, isFalse);
    });
  });

  group('ApiSimulatorRepository', () {
    test('simulate() -> POST /config/{configId}/simulate', () async {
      final recorder = _RecordingDio();
      final api = ApiClient(
        dio: recorder.build({
          'passed': true,
          'details': ['ok'],
        }),
      );
      final repo = ApiSimulatorRepository(api);

      final result = await repo.simulate(configId: 'cfg-42');

      expect(recorder.lastRequest?.method, 'POST');
      expect(recorder.lastRequest?.path, '/config/cfg-42/simulate');
      expect(result.passed, isTrue);
      expect(result.details, ['ok']);
    });
  });

  test(
    'simulatorRepositoryProvider ให้ ApiSimulatorRepository เมื่อ API_MOCK_MODE=false '
    '(ค่า default ตอนรันเทส — ไม่ได้ตั้ง --dart-define) — regression test: เดิม '
    'provider นี้ hardcode คืน MockSimulatorRepository เสมอ ไม่เคยเช็ค '
    'AppConfig.apiMockMode เลย ต่างจาก taskRepositoryProvider/notificationRepositoryProvider',
    () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      expect(
        container.read(simulatorRepositoryProvider),
        isA<ApiSimulatorRepository>(),
      );
    },
  );

  group('assignedDeviceIdListProvider', () {
    ProviderContainer containerWith(List<Task> tasks, {UserRole? role}) {
      final container = ProviderContainer(
        overrides: [
          authControllerProvider.overrideWith(() => _FakeAuthController(role)),
          taskRepositoryProvider.overrideWithValue(_FakeTaskRepository(tasks)),
        ],
      );
      addTearDown(container.dispose);
      return container;
    }

    test('dedupe + เรียงตัวอักษร, ตัด null/ว่างออก', () async {
      final container = containerWith([
        _task(id: 't1', deviceId: 'DVC-2'),
        _task(id: 't2', deviceId: 'DVC-1'),
        _task(id: 't3', deviceId: 'DVC-1'), // ซ้ำกับ t2
        _task(id: 't4'), // ไม่มี deviceId
        _task(id: 't5', deviceId: '   '), // whitespace ล้วน
      ], role: UserRole.st);

      await container.read(taskListProvider.future);
      final result = container.read(assignedDeviceIdListProvider);

      expect(result.value, ['DVC-1', 'DVC-2']);
    });

    test(
      'role ที่ไม่ใช่ ST/OT -> taskListProvider ว่าง -> ไม่มีอุปกรณ์เลย',
      () async {
        final container = containerWith([
          _task(id: 't1', deviceId: 'DVC-1'),
        ], role: UserRole.sw);

        await container.read(taskListProvider.future);
        final result = container.read(assignedDeviceIdListProvider);

        expect(result.value, isEmpty);
      },
    );
  });
}
