import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/auth_repository.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/db/providers/database_provider.dart';
import 'package:mobile/core/db/tables/pending_actions_table.dart';
import 'package:mobile/core/db/task_mapping.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/features/push_notification/push_notification_service.dart';

// UX audit #5 — token หมดอายุ (401) ระหว่างใช้งาน ต้องพากลับหน้า login พร้อม
// ข้อความ "เซสชันหมดอายุ" แต่ห้ามล้างคิว sync ที่ยังส่งไม่ได้ (logout ปกติล้าง
// ทิ้งหมด) — คนเดิม login กลับมาต้องได้คิวเดิมคืน คนอื่น login ต้องไม่เห็น
// ข้อมูลของคนก่อน

/// ตอบทุกคำขอด้วย [statusCode] (ใช้ 401 จำลอง token หมดอายุ)
class _StatusAdapter implements HttpClientAdapter {
  _StatusAdapter(this.statusCode);

  int statusCode;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async => ResponseBody.fromString(
    jsonEncode({'message': 'Unauthorized'}),
    statusCode,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );

  @override
  void close({bool force = false}) {}
}

class _FakeAuthRepository implements AuthRepository {
  @override
  Future<LoginResponse> login(String username, String password) async =>
      LoginResponse(accessToken: 'token-$username', role: UserRole.st);
}

class _NoopPush implements PushNotificationService {
  @override
  Future<void> initializeAndRegister() async {}

  @override
  Future<void> unregisterAndStop() async {}
}

AppDatabase _inMemoryDb(Ref ref) {
  final db = AppDatabase.forTesting(NativeDatabase.memory());
  ref.onDispose(db.close);
  return db;
}

({ProviderContainer container, InMemoryTokenStore tokens}) _setUp() {
  final tokens = InMemoryTokenStore();
  final dio = Dio(BaseOptions(baseUrl: 'http://test.local'))
    ..httpClientAdapter = _StatusAdapter(401);
  final container = ProviderContainer(
    overrides: [
      apiClientProvider.overrideWithValue(ApiClient(dio: dio)),
      authRepositoryProvider.overrideWithValue(_FakeAuthRepository()),
      tokenStoreProvider.overrideWithValue(tokens),
      sessionProfileStoreProvider.overrideWithValue(
        InMemorySessionProfileStore(),
      ),
      pushNotificationServiceProvider.overrideWithValue(_NoopPush()),
      appDatabaseProvider.overrideWith(_inMemoryDb),
    ],
  );
  addTearDown(container.dispose);
  return (container: container, tokens: tokens);
}

Future<void> _queueOne(ProviderContainer c, {String userId = 'st.a'}) => c
    .read(pendingActionDaoProvider)
    .insertAction(
      PendingActionsCompanion.insert(
        id: 'act-1',
        userId: userId,
        type: PendingActionType.taskStatus.wireName,
        entityId: 'task-1',
        payload: jsonEncode({'status': 'completed'}),
        createdAt: DateTime(2026, 10, 16, 9),
      ),
    );

Future<int> _unsynced(ProviderContainer c) =>
    c.read(pendingActionDaoProvider).countUnsynced();

const _expiredMessage = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('401 จาก API ระหว่างใช้งาน -> ออกจาก session พร้อมข้อความเซสชันหมดอายุ '
      'ล้าง token แต่คิวที่ยังไม่ซิงค์ยังอยู่ครบ', () async {
    final (:container, :tokens) = _setUp();
    await container.read(authControllerProvider.notifier).login('st.a', 'pw');
    await _queueOne(container);
    expect(container.read(authControllerProvider).isAuthenticated, isTrue);

    await expectLater(
      container.read(apiClientProvider).listTasks(),
      throwsA(isA<ApiException>()),
    );

    final auth = container.read(authControllerProvider);
    expect(auth.status, AuthStatus.unauthenticated);
    expect(auth.error, _expiredMessage);
    expect(await tokens.read(), isNull);
    expect(await _unsynced(container), 1);
  });

  test('401 หลายคำขอพร้อมกัน -> จัดการครั้งเดียว ไม่ทับ login ใหม่', () async {
    final (:container, tokens: _) = _setUp();
    final auth = container.read(authControllerProvider.notifier);
    await auth.login('st.a', 'pw');

    await Future.wait([
      container.read(apiClientProvider).listTasks().catchError((_) => <Task>[]),
      container.read(apiClientProvider).listTasks().catchError((_) => <Task>[]),
    ]);
    expect(container.read(authControllerProvider).error, _expiredMessage);

    // login ใหม่แล้ว expireSession ที่มาช้าต้องไม่เตะออกอีก (ไม่มีคำขอใหม่)
    await auth.login('st.a', 'pw');
    auth.expireSession(); // เรียกตรงๆ ตอน authenticated = ทำงานปกติ
    expect(container.read(authControllerProvider).isAuthenticated, isFalse);
    auth.expireSession(); // ซ้ำตอน unauthenticated = ไม่ทำอะไร
    expect(container.read(authControllerProvider).error, _expiredMessage);
  });

  test('ไม่ได้ login อยู่ -> expireSession ไม่ตั้งข้อความ', () async {
    final (:container, tokens: _) = _setUp();
    container.read(authControllerProvider.notifier).expireSession();
    await Future<void>.delayed(Duration.zero);

    expect(container.read(authControllerProvider).error, isNull);
  });

  test('หมดอายุแล้วคนเดิม login กลับ -> คิวเดิมยังอยู่ (รอส่งต่อ)', () async {
    final (:container, tokens: _) = _setUp();
    final auth = container.read(authControllerProvider.notifier);
    await auth.login('st.a', 'pw');
    await _queueOne(container);
    auth.expireSession();
    await Future<void>.delayed(Duration.zero);

    await auth.login('st.a', 'pw');

    expect(container.read(authControllerProvider).isAuthenticated, isTrue);
    expect(await _unsynced(container), 1);
  });

  test('หมดอายุแล้วคนอื่น login ต่อ -> ล้างข้อมูลของคนก่อนก่อนเข้า', () async {
    final (:container, tokens: _) = _setUp();
    final auth = container.read(authControllerProvider.notifier);
    await auth.login('st.a', 'pw');
    await _queueOne(container);
    await container
        .read(taskDaoProvider)
        .upsertTask(
          taskToCompanion(
            Task(
              id: 'task-1',
              title: 'งานของ st.a',
              assignedTo: 'st.a',
              status: TaskStatus.pending,
              createdAt: DateTime(2026, 10, 1),
              updatedAt: DateTime(2026, 10, 1),
            ),
          ),
        );
    auth.expireSession();
    await Future<void>.delayed(Duration.zero);

    await auth.login('st.b', 'pw');

    expect(container.read(authControllerProvider).username, 'st.b');
    expect(await _unsynced(container), 0);
    expect(await container.read(taskDaoProvider).getAllTasks(), isEmpty);
  });

  test('คิว sync ได้ 401 -> พฤติกรรมเดิมของคิวยังอยู่ (ตั้ง syncAuthExpired, '
      'รายการค้างไว้ส่งใหม่) และ session หมดอายุผ่านจุดเดียวกัน', () async {
    final (:container, tokens: _) = _setUp();
    await container.read(authControllerProvider.notifier).login('st.a', 'pw');
    await _queueOne(container);

    await container.read(syncQueueServiceProvider).flush();

    expect(container.read(syncAuthExpiredProvider), isTrue);
    expect(await _unsynced(container), 1);
    final auth = container.read(authControllerProvider);
    expect(auth.status, AuthStatus.unauthenticated);
    expect(auth.error, _expiredMessage);
  });
}
