import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/activity_log/activity_log_entry.dart';
import 'package:mobile/features/activity_log/activity_log_repository.dart';

/// Store whose every method throws — proves the repository swallows storage
/// failures and never propagates.
class _ThrowingStore implements ActivityLogStore {
  @override
  Future<String?> read() async => throw StateError('read boom');
  @override
  Future<void> write(String value) async => throw StateError('write boom');
  @override
  Future<void> delete() async => throw StateError('delete boom');
}

DefaultActivityLogRepository _repo(
  ActivityLogStore store, {
  required DateTime now,
}) => DefaultActivityLogRepository(store, now: () => now);

void main() {
  group('record + list', () {
    test('record แล้ว list คืน entry ที่ถูกต้อง (navigation)', () async {
      final store = InMemoryActivityLogStore();
      final t = DateTime.utc(2026, 9, 8, 10, 30);
      final repo = _repo(store, now: t);

      await repo.record(path: '/home', title: 'หน้าหลัก');

      final entries = await repo.list();
      expect(entries, hasLength(1));
      expect(entries.single.type, ActivityLogType.navigation);
      expect(entries.single.path, '/home');
      expect(entries.single.title, 'หน้าหลัก');
      expect(entries.single.at, t);
      expect(entries.single.id, isNotEmpty);
    });

    test('list เรียงล่าสุดก่อน + จำกัดตาม limit', () async {
      final store = InMemoryActivityLogStore();
      var t = DateTime.utc(2026, 9, 8, 10);
      final repo = DefaultActivityLogRepository(store, now: () => t);

      for (final title in ['A', 'B', 'C', 'D']) {
        await repo.record(path: '/x', title: title);
        t = t.add(const Duration(minutes: 1));
      }

      final top2 = await repo.list(limit: 2);
      expect(top2.map((e) => e.title).toList(), ['D', 'C']);
    });
  });

  group('retention', () {
    test('ตัด entry ที่เก่ากว่า 14 วันตอน record', () async {
      // seed: 1 entry อายุ 20 วัน + 1 entry อายุ 2 วัน
      final now = DateTime.utc(2026, 9, 20, 12);
      final store = InMemoryActivityLogStore(
        jsonEncode([
          _rawEntry('old', now.subtract(const Duration(days: 20))),
          _rawEntry('recent', now.subtract(const Duration(days: 2))),
        ]),
      );
      final repo = _repo(store, now: now);

      await repo.record(path: '/home', title: 'ใหม่');

      final titles = (await repo.list(limit: 999)).map((e) => e.title).toSet();
      expect(titles, {'recent', 'ใหม่'}); // 'old' ถูกตัด
    });

    test('เกิน 300 รายการ -> เหลือ 300 ตัวล่าสุด', () async {
      final now = DateTime.utc(2026, 9, 20, 12);
      // 320 entries ภายใน 14 วัน (ไม่โดนตัดด้วยอายุ)
      final raw = <Map<String, dynamic>>[
        for (var i = 0; i < 320; i++)
          _rawEntry(
            'e$i',
            now.subtract(Duration(minutes: 320 - i)), // e0 เก่าสุด
          ),
      ];
      final store = InMemoryActivityLogStore(jsonEncode(raw));
      final repo = _repo(store, now: now);

      await repo.record(path: '/home', title: 'newest');

      final all = await repo.list(limit: 999);
      expect(all, hasLength(300));
      // ตัวล่าสุดคือที่เพิ่ง record, ตัวเก่าสุดที่เหลือคือ e21 (e0..e20 โดนตัด)
      expect(all.first.title, 'newest');
      expect(all.last.title, 'e21');
    });
  });

  group('clear', () {
    test('ล้างจริง — list คืน []', () async {
      final store = InMemoryActivityLogStore();
      final repo = _repo(store, now: DateTime.utc(2026, 9, 8));
      await repo.record(path: '/home', title: 'x');
      expect(await repo.list(), isNotEmpty);

      await repo.clear();

      expect(await repo.list(), isEmpty);
      expect(await store.read(), isNull);
    });
  });

  group('never throws', () {
    test(
      'storage พังทุก method -> record/clear เป็น no-op, list คืน []',
      () async {
        final repo = _repo(_ThrowingStore(), now: DateTime.utc(2026, 9, 8));

        await expectLater(repo.record(path: '/home', title: 'x'), completes);
        await expectLater(repo.clear(), completes);
        expect(await repo.list(), isEmpty);
      },
    );

    test('raw JSON เสีย -> list คืน [] ไม่ throw', () async {
      final repo = _repo(
        InMemoryActivityLogStore('not-json{{'),
        now: DateTime.utc(2026, 9, 8),
      );
      expect(await repo.list(), isEmpty);
    });

    test('entry เดี่ยว shape ผิด -> ข้ามตัวนั้น เก็บตัวที่ดี', () async {
      final now = DateTime.utc(2026, 9, 8, 10);
      final store = InMemoryActivityLogStore(
        jsonEncode([
          {'garbage': true},
          _rawEntry('ok', now),
        ]),
      );
      final repo = _repo(store, now: now);
      final entries = await repo.list();
      expect(entries.map((e) => e.title).toList(), ['ok']);
    });
  });
}

Map<String, dynamic> _rawEntry(String title, DateTime at) => {
  'id': 'id-$title',
  'type': 'navigation',
  'at': at.toUtc().toIso8601String(),
  'detail': {'path': '/x', 'title': title},
};
