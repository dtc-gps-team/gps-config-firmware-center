import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/features/task/task_event_repository.dart';

/// Scriptable [ApiClient] — hand-written fake, same style as
/// `task_repository_test.dart`.
class _FakeApiClient extends ApiClient {
  _FakeApiClient(this.events);

  List<TaskEvent> events;
  Object? error;
  final List<(String, String)> notes = [];

  @override
  Future<List<TaskEvent>> listTaskEvents(String taskId) async {
    if (error != null) throw error!;
    return events.where((e) => e.taskId == taskId).toList();
  }

  @override
  Future<TaskEvent> addTaskNote(String taskId, String note) async {
    if (error != null) throw error!;
    notes.add((taskId, note));
    return TaskEvent(
      id: 'n1',
      taskId: taskId,
      changedBy: 'u1',
      changedByName: 'ช่างสมชาย',
      changedAt: DateTime.utc(2026, 9, 3),
      note: note,
    );
  }
}

TaskEvent _created(String taskId, {String id = 'e1'}) => TaskEvent(
  id: id,
  taskId: taskId,
  toStatus: TaskStatus.pending,
  changedBy: 'op1',
  changedByName: 'คุณสั่งงาน',
  changedAt: DateTime.utc(2026, 9, 1),
);

TaskEvent _started(String taskId) => TaskEvent(
  id: 'e2',
  taskId: taskId,
  fromStatus: TaskStatus.pending,
  toStatus: TaskStatus.inProgress,
  changedBy: 'u1',
  changedByName: 'ช่างสมชาย',
  changedAt: DateTime.utc(2026, 9, 2),
);

void main() {
  late AppDatabase db;
  late _FakeApiClient api;
  late CachedApiTaskEventRepository repo;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    api = _FakeApiClient([_created('t1'), _started('t1')]);
    repo = CachedApiTaskEventRepository(api, db.taskEventDao);
  });
  tearDown(() => db.close());

  group('CachedApiTaskEventRepository.getEvents', () {
    test('online -> คืนค่าจาก server และเก็บลง cache', () async {
      final events = await repo.getEvents('t1');

      expect(events.map((e) => e.id), ['e1', 'e2']);
      final cached = await db.taskEventDao.getEventsByTaskId('t1');
      expect(cached.map((r) => r.id), ['e1', 'e2']);
      expect(cached[1].fromStatus, 'pending');
      expect(cached[1].toStatus, 'in_progress');
    });

    test(
      'cache ของงานนั้นถูกแทนที่ทั้งชุด (แถวที่ server ไม่คืนแล้วหายไป) งานอื่นไม่โดน',
      () async {
        api.events = [_created('t1'), _started('t1'), _created('t2', id: 'x')];
        await repo.getEvents('t1');
        await repo.getEvents('t2');

        api.events = [_created('t1'), _created('t2', id: 'x')];
        await repo.getEvents('t1');

        expect(
          (await db.taskEventDao.getEventsByTaskId('t1')).map((r) => r.id),
          ['e1'],
        );
        expect(
          (await db.taskEventDao.getEventsByTaskId('t2')).map((r) => r.id),
          ['x'],
        );
      },
    );

    test('offline (ไม่มี statusCode) -> คืนจาก cache ครบทุก field', () async {
      await repo.getEvents('t1');
      api.error = ApiException('offline');

      final events = await repo.getEvents('t1');

      expect(events.map((e) => e.id), ['e1', 'e2']);
      expect(events[0].fromStatus, isNull);
      expect(events[0].toStatus, TaskStatus.pending);
      expect(events[1].fromStatus, TaskStatus.pending);
      expect(events[1].changedByName, 'ช่างสมชาย');
      expect(
        events[1].changedAt.isAtSameMomentAs(DateTime.utc(2026, 9, 2)),
        isTrue,
      );
    });

    test('5xx -> คืนจาก cache', () async {
      await repo.getEvents('t1');
      api.error = ApiException('down', statusCode: 503);

      expect(await repo.getEvents('t1'), hasLength(2));
    });

    test('404 (งานหาย / ไม่ใช่ของเราแล้ว) -> ไม่เอา cache มาปิดไว้', () async {
      await repo.getEvents('t1');
      api.error = ApiException('not found', statusCode: 404);

      expect(repo.getEvents('t1'), throwsA(isA<ApiException>()));
    });

    test('offline และไม่เคยมี cache -> โยน error ให้หน้าจอแสดง', () async {
      api.error = ApiException('offline');

      expect(repo.getEvents('t1'), throwsA(isA<ApiException>()));
    });
  });

  group('CachedApiTaskEventRepository.addNote', () {
    test('ส่งขึ้น server แล้วเก็บ event ที่ได้ลง cache', () async {
      final event = await repo.addNote('t1', 'ถึงหน้างานแล้ว');

      expect(api.notes, [('t1', 'ถึงหน้างานแล้ว')]);
      expect(event.isNote, isTrue);
      final cached = await db.taskEventDao.getEventsByTaskId('t1');
      expect(cached.single.note, 'ถึงหน้างานแล้ว');
      expect(cached.single.toStatus, isNull);
    });

    test(
      'offline -> โยน error ไม่เข้าคิว ไม่เขียน cache (docs/16 §7)',
      () async {
        api.error = ApiException('offline');

        await expectLater(
          repo.addNote('t1', 'x'),
          throwsA(isA<ApiException>()),
        );
        expect(await db.taskEventDao.getEventsByTaskId('t1'), isEmpty);
        expect(await db.pendingActionDao.getPending(), isEmpty);
      },
    );
  });

  test(
    'MockTaskEventRepository: งาน mock เริ่มด้วย event สร้างงาน และเพิ่มบันทึกได้',
    () async {
      final mock = MockTaskEventRepository();

      final before = await mock.getEvents('mock-task-1');
      expect(before.single.toStatus, TaskStatus.pending);

      await mock.addNote('mock-task-1', 'ทดสอบ');
      final after = await mock.getEvents('mock-task-1');
      expect(after.map((e) => e.note), [null, 'ทดสอบ']);
    },
  );

  test(
    'migration v2 -> v3: เพิ่มตาราง task_events โดยไม่แตะ tasks/pending_actions เดิม',
    () async {
      final dir = await Directory.systemTemp.createTemp('task_event_mig');
      addTearDown(() => dir.delete(recursive: true));
      final file = File('${dir.path}/app.db');

      // Turn a fresh database into what a v2 install has on disk: the two v2
      // tables (same DDL the code generates), one cached task, no
      // task_events, user_version 2.
      final fresh = AppDatabase.forTesting(NativeDatabase(file));
      await fresh.customStatement('DROP TABLE task_events');
      await fresh.customStatement(
        "INSERT INTO tasks (id, title, assigned_to, status, created_at, "
        "updated_at) VALUES ('t1', 'งานเก่า', 'u1', 'pending', 0, 0)",
      );
      await fresh.customStatement('PRAGMA user_version = 2');
      await fresh.close();

      final upgraded = AppDatabase.forTesting(NativeDatabase(file));
      addTearDown(upgraded.close);

      expect((await upgraded.taskDao.getTaskById('t1'))?.title, 'งานเก่า');
      await upgraded.taskEventDao.upsertEvent(
        TaskEventsCompanion.insert(
          id: 'e1',
          taskId: 't1',
          changedAt: DateTime.utc(2026, 9, 1),
        ),
      );
      expect(await upgraded.taskEventDao.getEventsByTaskId('t1'), hasLength(1));
      final version = await upgraded
          .customSelect('PRAGMA user_version')
          .getSingle();
      expect(version.data.values.single, 3);
    },
  );
}
