import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/task/apply_request_history_page.dart';
import 'package:mobile/features/task/config_apply_request_repository.dart';

import 'support/fake_config_apply_request_repository.dart';

/// เวลาเครื่องของวันนี้ / เมื่อวาน / 3 วันก่อน (หน้านี้จัดกลุ่มตามวันของเวลาเครื่อง)
DateTime _daysAgo(int days, {int hour = 10}) {
  final now = DateTime.now();
  return DateTime(now.year, now.month, now.day - days, hour).toUtc();
}

ConfigApplyRequest _fw(
  String id, {
  required DateTime at,
  ConfigApplyRequestStatus status = ConfigApplyRequestStatus.succeeded,
  String version = '1.2.9',
  String? from = '1.0.0',
  int attempts = 1,
}) => fakeApplyRequest(
  id: id,
  kind: FieldApplyKind.firmware,
  firmwareVersion: version,
  fromFirmwareVersion: from,
  status: status,
  requestedAt: at,
  attemptCount: attempts,
  maxAttempts: 3,
);

ConfigApplyRequest _cfg(
  String id, {
  required DateTime at,
  ConfigApplyRequestStatus status = ConfigApplyRequestStatus.succeeded,
}) => fakeApplyRequest(id: id, status: status, requestedAt: at);

Future<FakeConfigApplyRequestRepository> _pump(
  WidgetTester tester,
  List<ConfigApplyRequest> requests, {
  int pageSize = 20,
  void Function(String uri)? onOpen,
}) async {
  final repo = FakeConfigApplyRequestRepository(requests: requests)
    ..historyPageSize = pageSize;
  await tester.pumpWidget(
    ProviderScope(
      overrides: [configApplyRequestRepositoryProvider.overrideWithValue(repo)],
      child: MaterialApp.router(
        routerConfig: GoRouter(
          initialLocation: AppRoutes.taskRequestHistory('t1'),
          routes: [
            GoRoute(
              path: AppRoutes.taskRequestHistoryPattern,
              builder: (_, state) =>
                  ApplyRequestHistoryPage(taskId: state.pathParameters['id']!),
            ),
            GoRoute(
              path: AppRoutes.taskApplyProgressPattern,
              builder: (_, state) {
                onOpen?.call(state.uri.toString());
                return const Text('PROGRESS_PAGE');
              },
            ),
          ],
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return repo;
}

void main() {
  testWidgets('จัดกลุ่มตามวัน · แถวบอกเวอร์ชัน สถานะ และจำนวนรอบ', (
    tester,
  ) async {
    await _pump(tester, [
      _fw('r4', at: _daysAgo(0, hour: 11), attempts: 3),
      _fw('r3', at: _daysAgo(0, hour: 9), version: '1.2.1', from: '1.2.9'),
      _cfg('r2', at: _daysAgo(1)),
      _fw(
        'r1',
        at: _daysAgo(3),
        status: ConfigApplyRequestStatus.failed,
        attempts: 3,
      ),
    ]);

    expect(find.text('วันนี้'), findsOneWidget);
    expect(find.text('เมื่อวาน'), findsOneWidget);
    // วันอื่น = วันที่เต็ม
    final d = _daysAgo(3).toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    expect(
      find.text('${two(d.day)}/${two(d.month)}/${d.year}'),
      findsOneWidget,
    );

    final row0 = find.byKey(const Key('request_history_row_0'));
    expect(
      find.descendant(of: row0, matching: find.text('Firmware 1.0.0 → 1.2.9')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: row0, matching: find.text('3 รอบ')),
      findsOneWidget,
    );
    // ส่งรอบเดียว = ไม่ต้องบอกจำนวนรอบ
    expect(
      find.descendant(
        of: find.byKey(const Key('request_history_row_1')),
        matching: find.textContaining('รอบ'),
      ),
      findsNothing,
    );
    expect(
      find.descendant(
        of: find.byKey(const Key('request_history_row_2')),
        matching: find.text('Config'),
      ),
      findsOneWidget,
    );
    // สถานะมีไอคอนกำกับ ไม่ใช้สีอย่างเดียว
    expect(
      find.descendant(
        of: find.byKey(const Key('request_history_row_3')),
        matching: find.byIcon(Icons.error_outline),
      ),
      findsOneWidget,
    );
  });

  testWidgets('แตะแถว -> เปิดหน้ารายละเอียดของคำขอนั้น', (tester) async {
    String? opened;
    await _pump(tester, [
      _fw('r2', at: _daysAgo(0, hour: 11)),
      _fw('r1', at: _daysAgo(0, hour: 9)),
    ], onOpen: (uri) => opened = uri);

    await tester.tap(find.byKey(const Key('request_history_row_1')));
    await tester.pumpAndSettle();

    expect(opened, AppRoutes.taskApplyProgress('t1', 'r1'));
    expect(find.text('PROGRESS_PAGE'), findsOneWidget);
  });

  testWidgets('กรองกลุ่มผล -> ถาม backend ใหม่ด้วยตัวกรอง และแสดงเฉพาะที่ตรง', (
    tester,
  ) async {
    final repo = await _pump(tester, [
      _fw('r3', at: _daysAgo(0, hour: 11)),
      _fw(
        'r2',
        at: _daysAgo(0, hour: 10),
        status: ConfigApplyRequestStatus.failed,
      ),
      _cfg(
        'r1',
        at: _daysAgo(0, hour: 9),
        status: ConfigApplyRequestStatus.pending,
      ),
    ]);
    expect(find.byKey(const Key('request_history_row_2')), findsOneWidget);

    await tester.tap(
      find.byKey(const Key('request_history_result_unsuccessful')),
    );
    await tester.pumpAndSettle();

    expect(repo.historyQueries.last.result, ApplyHistoryResult.unsuccessful);
    expect(repo.historyQueries.last.before, isNull);
    expect(find.byKey(const Key('request_history_row_0')), findsOneWidget);
    expect(find.byKey(const Key('request_history_row_1')), findsNothing);

    await tester.tap(find.byKey(const Key('request_history_result_open')));
    await tester.pumpAndSettle();
    expect(repo.historyQueries.last.result, ApplyHistoryResult.open);
    expect(find.byKey(const Key('request_history_row_0')), findsOneWidget);
  });

  testWidgets('กรองชนิด Firmware จากเมนู', (tester) async {
    final repo = await _pump(tester, [
      _fw('r2', at: _daysAgo(0, hour: 11)),
      _cfg('r1', at: _daysAgo(0, hour: 9)),
    ]);

    await tester.tap(find.byKey(const Key('request_history_kind_menu')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const Key('request_history_kind_firmware')).last,
    );
    await tester.pumpAndSettle();

    expect(repo.historyQueries.last.kind, FieldApplyKind.firmware);
    expect(find.byKey(const Key('request_history_row_0')), findsOneWidget);
    expect(find.byKey(const Key('request_history_row_1')), findsNothing);
  });

  testWidgets('รายการสั้นกว่าจอ -> โหลดหน้าถัดไปเองจนครบ ไม่ต้องเลื่อน', (
    tester,
  ) async {
    final repo = await _pump(tester, [
      for (var i = 0; i < 5; i++) _fw('r$i', at: _daysAgo(0, hour: 20 - i)),
    ], pageSize: 2);

    expect(repo.historyQueries.map((q) => q.before), [null, 'r1', 'r3']);
    await tester.drag(
      find.byKey(const Key('request_history_list')),
      const Offset(0, -2000),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('request_history_row_4')), findsOneWidget);
    expect(find.byKey(const Key('request_history_end')), findsOneWidget);
    expect(repo.historyCalls, 3);
  });

  testWidgets('รายการยาว -> โหลดหน้าถัดไปเมื่อเลื่อนใกล้ท้ายเท่านั้น', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final repo = await _pump(tester, [
      for (var i = 0; i < 20; i++)
        _fw('r$i', at: _daysAgo(0, hour: 23).subtract(Duration(minutes: i))),
    ], pageSize: 12);
    // หน้าแรกยาวพอ ยังไม่โหลดต่อเอง
    expect(repo.historyCalls, 1);
    expect(find.byKey(const Key('request_history_end')), findsNothing);

    for (var i = 0; i < 6; i++) {
      await tester.drag(
        find.byKey(const Key('request_history_list')),
        const Offset(0, -600),
      );
      await tester.pumpAndSettle();
    }

    expect(repo.historyQueries.map((q) => q.before), [null, 'r11']);
    expect(find.byKey(const Key('request_history_row_19')), findsOneWidget);
    expect(find.byKey(const Key('request_history_end')), findsOneWidget);
  });

  testWidgets('ไม่มีคำขอเลย / กรองแล้วไม่เจอ -> ข้อความต่างกัน', (
    tester,
  ) async {
    await _pump(tester, []);
    expect(find.byKey(const Key('request_history_empty')), findsOneWidget);

    await tester.pumpWidget(const SizedBox());
    await _pump(tester, [_fw('r1', at: _daysAgo(0))]);
    await tester.tap(find.byKey(const Key('request_history_result_open')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('request_history_no_match')), findsOneWidget);
  });

  testWidgets('โหลดไม่สำเร็จ -> ข้อความ + ลองใหม่ได้', (tester) async {
    final repo = FakeConfigApplyRequestRepository(
      requests: [_fw('r1', at: _daysAgo(0))],
    )..historyError = ApiException('เครือข่ายขัดข้อง');
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          configApplyRequestRepositoryProvider.overrideWithValue(repo),
        ],
        child: const MaterialApp(home: ApplyRequestHistoryPage(taskId: 't1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('เครือข่ายขัดข้อง'), findsOneWidget);

    repo.historyError = null;
    await tester.tap(find.byKey(const Key('request_history_retry')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('request_history_row_0')), findsOneWidget);
  });
}
