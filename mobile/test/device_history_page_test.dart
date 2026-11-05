import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/device_search/device_history_page.dart';
import 'package:mobile/features/device_search/device_history_repository.dart';

class _FakeHistoryRepository implements DeviceHistoryRepository {
  _FakeHistoryRepository(this.pages);

  /// คีย์ = cursor ที่ส่งมา (`null` = หน้าแรก)
  final Map<String?, Object> pages;
  final calls = <String?>[];

  @override
  Future<DeviceHistoryResult> getHistory(
    String deviceId, {
    String? before,
  }) async {
    calls.add(before);
    final page = pages[before];
    if (page is DeviceHistoryResult) return page;
    throw page!;
  }
}

DeviceHistoryItem _item(
  String id,
  DeviceHistoryType type, {
  String? status,
  String? title,
  String? payloadType,
  String? firmwareVersion,
  String? configName,
}) => DeviceHistoryItem(
  id: id,
  type: type,
  occurredAt: DateTime(2026, 10, 27, 14, 35),
  status: status,
  title: title,
  payloadType: payloadType,
  firmwareVersion: firmwareVersion,
  configName: configName,
);

Future<_FakeHistoryRepository> _pump(
  WidgetTester tester,
  Map<String?, Object> pages,
) async {
  final repo = _FakeHistoryRepository(pages);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [deviceHistoryRepositoryProvider.overrideWithValue(repo)],
      child: const MaterialApp(home: DeviceHistoryPage(deviceId: 'BOX-0001')),
    ),
  );
  await tester.pumpAndSettle();
  return repo;
}

void main() {
  testWidgets('หัวบอกชื่อเครื่อง · ไม่มีรายการ -> ยังไม่มีประวัติ', (
    tester,
  ) async {
    await _pump(tester, {null: const DeviceHistoryResult(items: [])});
    expect(find.text('ประวัติ BOX-0001'), findsOneWidget);
    expect(find.text('ประวัติการทำงานกับอุปกรณ์'), findsOneWidget);
    expect(find.byKey(const Key('device_history_empty')), findsOneWidget);
    expect(find.byKey(const Key('device_history_more')), findsNothing);
  });

  testWidgets('รายการแสดงเป็นคำไทยตามชนิด พร้อมสถานะและเวลา', (tester) async {
    await _pump(tester, {
      null: DeviceHistoryResult(
        items: [
          _item(
            'rollout:1',
            DeviceHistoryType.rollout,
            status: 'success',
            payloadType: 'Firmware',
            firmwareVersion: '1.2.0',
          ),
          _item(
            'task:1',
            DeviceHistoryType.task,
            status: 'completed',
            title: 'ติดตั้งกล่อง GPS',
          ),
          _item('x:1', DeviceHistoryType.unknown, status: 'something_new'),
        ],
      ),
    });
    expect(find.text('ส่ง Firmware 1.2.0'), findsOneWidget);
    expect(find.text('สำเร็จ'), findsOneWidget);
    expect(find.text('งานภาคสนาม'), findsOneWidget);
    expect(find.text('ติดตั้งกล่อง GPS'), findsOneWidget);
    expect(find.text('เสร็จแล้ว'), findsOneWidget);
    // ชนิด/สถานะที่ backend เพิ่มในอนาคตไม่ทำให้หน้าพัง
    expect(find.text('เหตุการณ์อื่น'), findsOneWidget);
    expect(find.text('something_new'), findsOneWidget);
    expect(find.text('27/10/2026 14:35'), findsNWidgets(3));
  });

  testWidgets('มี nextCursor -> โหลดเพิ่มด้วย cursor นั้น ต่อท้ายรายการเดิม', (
    tester,
  ) async {
    final repo = await _pump(tester, {
      null: DeviceHistoryResult(
        items: [_item('task:1', DeviceHistoryType.task, title: 'งานแรก')],
        nextCursor: 'c1',
      ),
      'c1': DeviceHistoryResult(
        items: [_item('task:2', DeviceHistoryType.task, title: 'งานเก่า')],
      ),
    });
    await tester.tap(find.byKey(const Key('device_history_more')));
    await tester.pumpAndSettle();
    expect(repo.calls, [null, 'c1']);
    expect(find.text('งานแรก'), findsOneWidget);
    expect(find.text('งานเก่า'), findsOneWidget);
    // หน้าสุดท้าย (nextCursor null) -> ไม่มีปุ่มโหลดเพิ่ม
    expect(find.byKey(const Key('device_history_more')), findsNothing);
  });

  testWidgets(
    'โหลดเพิ่มไม่สำเร็จ -> บอกข้อผิดพลาด รายการเดิมยังอยู่ กดใหม่ได้',
    (tester) async {
      await _pump(tester, {
        null: DeviceHistoryResult(
          items: [_item('task:1', DeviceHistoryType.task, title: 'งานแรก')],
          nextCursor: 'c1',
        ),
        'c1': ApiException('เครือข่ายขัดข้อง', statusCode: 503),
      });
      await tester.tap(find.byKey(const Key('device_history_more')));
      await tester.pumpAndSettle();
      expect(find.textContaining('เครือข่ายขัดข้อง'), findsOneWidget);
      expect(find.text('งานแรก'), findsOneWidget);
      expect(find.byKey(const Key('device_history_more')), findsOneWidget);
    },
  );

  testWidgets('โหลดหน้าแรกไม่สำเร็จ -> error + ลองใหม่เรียกอีกครั้ง', (
    tester,
  ) async {
    final repo = await _pump(tester, {
      null: ApiException('ไม่พบ Device นี้', statusCode: 404),
    });
    expect(find.byKey(const Key('device_history_error')), findsOneWidget);
    await tester.tap(find.byKey(const Key('device_history_retry')));
    await tester.pumpAndSettle();
    expect(repo.calls.length, 2);
  });

  test('DeviceHistoryResult.fromJson ตาม schema DeviceHistory ใน openapi', () {
    final r = DeviceHistoryResult.fromJson({
      'summary': {
        'currentConfig': {'id': 'c1', 'name': 'ส่งพิกัดทุก 15 วินาที'},
        'currentFirmware': null,
      },
      'items': [
        {
          'id': 'rollout:t1',
          'type': 'rollout',
          'occurredAt': '2026-10-27T07:35:02.000Z',
          'status': 'failed',
          'title': 'Campaign A',
          'detail': 'timeout',
          'actorId': null,
          'payloadType': 'Config',
          'isRollback': false,
          'severity': null,
          'config': {'id': 'c1', 'name': 'ส่งพิกัด', 'versionNumber': 3},
          'firmware': null,
          'decision': null,
          'refs': {
            'campaignId': 'x',
            'rolloutId': 'y',
            'taskId': null,
            'incidentId': null,
            'overrideId': null,
          },
        },
        {
          'id': 'new:1',
          'type': 'something-new',
          'occurredAt': '2026-10-26T00:00:00.000Z',
        },
      ],
      'nextCursor': '2026-10-26T00:00:00.000Z_new:1',
    });
    expect(r.currentConfigName, 'ส่งพิกัดทุก 15 วินาที');
    expect(r.currentFirmwareVersion, isNull);
    expect(r.nextCursor, '2026-10-26T00:00:00.000Z_new:1');
    expect(r.items.first.type, DeviceHistoryType.rollout);
    expect(r.items.first.configVersion, 3);
    expect(r.items.first.payloadType, 'Config');
    expect(r.items.last.type, DeviceHistoryType.unknown);
  });
}
