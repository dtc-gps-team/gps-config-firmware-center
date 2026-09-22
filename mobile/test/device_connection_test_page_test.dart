import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/device_connection_test/device_connection_test_page.dart';
import 'package:mobile/features/device_connection_test/device_connection_test_repository.dart';
import 'package:mobile/features/device_connection_test/recent_device_id_store.dart';

class _FakeRepo implements DeviceConnectionTestRepository {
  _FakeRepo({this.result, this.error});

  final DeviceConnectionTestResult? result;
  final Object? error;
  String? lastDeviceId;

  @override
  Future<DeviceConnectionTestResult> testConnection(String deviceId) async {
    lastDeviceId = deviceId;
    if (error != null) throw error!;
    return result!;
  }
}

Future<void> _pump(
  WidgetTester tester,
  DeviceConnectionTestRepository repo, {
  RecentDeviceIdStore? recentStore,
}) {
  return tester.pumpWidget(
    ProviderScope(
      overrides: [
        deviceConnectionTestRepositoryProvider.overrideWithValue(repo),
        recentDeviceIdStoreProvider.overrideWithValue(
          recentStore ?? InMemoryRecentDeviceIdStore(),
        ),
      ],
      child: const MaterialApp(home: DeviceConnectionTestPage()),
    ),
  );
}

VoidCallback? _submitCallback(WidgetTester tester) => tester
    .widget<FilledButton>(find.byKey(const Key('test_connection_submit')))
    .onPressed;

void main() {
  testWidgets('ปุ่ม disable จนกว่าจะกรอกเลขเครื่อง', (tester) async {
    await _pump(tester, _FakeRepo());
    expect(_submitCallback(tester), isNull);

    await tester.enterText(find.byKey(const Key('device_id_input')), 'DEV-001');
    await tester.pump();
    expect(_submitCallback(tester), isNotNull);
  });

  testWidgets('กรอกเลขเครื่องแล้วกดปุ่ม -> เห็น result card', (tester) async {
    final repo = _FakeRepo(
      result: DeviceConnectionTestResult(
        passed: true,
        signalStrength: -65,
        details: const ['เชื่อมต่อสำเร็จ (mock)'],
        testedAt: DateTime(2026, 9, 2, 10, 30, 15),
      ),
    );
    await _pump(tester, repo);

    await tester.enterText(find.byKey(const Key('device_id_input')), 'DEV-001');
    await tester.pump();
    await tester.tap(find.byKey(const Key('test_connection_submit')));
    await tester.pumpAndSettle();

    expect(repo.lastDeviceId, 'DEV-001');
    expect(find.byKey(const Key('test_connection_result')), findsOneWidget);
    expect(find.text('สัญญาณปกติ'), findsOneWidget);
    expect(find.text('ความแรงสัญญาณ: -65 dBm'), findsOneWidget);
    expect(find.text('• เชื่อมต่อสำเร็จ (mock)'), findsOneWidget);
    expect(find.textContaining('ทดสอบเมื่อ 10:30:15'), findsOneWidget);
  });

  testWidgets('deviceId ถูก trim ก่อนส่ง', (tester) async {
    final repo = _FakeRepo(
      result: DeviceConnectionTestResult(
        passed: false,
        signalStrength: 0,
        details: const [],
        testedAt: DateTime(2026),
      ),
    );
    await _pump(tester, repo);

    await tester.enterText(
      find.byKey(const Key('device_id_input')),
      '  DEV-9  ',
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('test_connection_submit')));
    await tester.pumpAndSettle();

    expect(repo.lastDeviceId, 'DEV-9');
    expect(find.text('สัญญาณมีปัญหา'), findsOneWidget);
  });

  testWidgets('404 -> ข้อความ error เฉพาะ ไม่มี result card', (tester) async {
    final repo = _FakeRepo(error: ApiException('not found', statusCode: 404));
    await _pump(tester, repo);

    await tester.enterText(find.byKey(const Key('device_id_input')), 'NOPE');
    await tester.pump();
    await tester.tap(find.byKey(const Key('test_connection_submit')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('test_connection_error')), findsOneWidget);
    expect(
      find.text('ไม่พบอุปกรณ์ที่มีเลขเครื่องนี้ ตรวจสอบเลขเครื่องอีกครั้ง'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('test_connection_result')), findsNothing);
  });

  testWidgets('409 -> ข้อความ error เฉพาะ', (tester) async {
    final repo = _FakeRepo(error: ApiException('conflict', statusCode: 409));
    await _pump(tester, repo);

    await tester.enterText(find.byKey(const Key('device_id_input')), 'DEV-2');
    await tester.pump();
    await tester.tap(find.byKey(const Key('test_connection_submit')));
    await tester.pumpAndSettle();

    expect(
      find.text(
        'อุปกรณ์นี้ยังไม่ได้ติดตั้ง หรือถูกปลดระวางไปแล้ว ทดสอบสัญญาณไม่ได้',
      ),
      findsOneWidget,
    );
  });

  testWidgets('error อื่นๆ -> โชว์ message ตรงๆ', (tester) async {
    final repo = _FakeRepo(
      error: ApiException('เซิร์ฟเวอร์ผิดพลาด', statusCode: 500),
    );
    await _pump(tester, repo);

    await tester.enterText(find.byKey(const Key('device_id_input')), 'DEV-3');
    await tester.pump();
    await tester.tap(find.byKey(const Key('test_connection_submit')));
    await tester.pumpAndSettle();

    expect(find.text('เซิร์ฟเวอร์ผิดพลาด'), findsOneWidget);
  });

  testWidgets(
    'ปุ่ม "เลือกจากรายการ" (issue #204) อยู่คู่กับช่องพิมพ์เอง ไม่ได้แทนที่กัน',
    (tester) async {
      await _pump(tester, _FakeRepo());

      // ช่องพิมพ์เดิมยังอยู่
      expect(find.byKey(const Key('device_id_input')), findsOneWidget);
      // ปุ่มเลือกจากรายการเป็นทางเลือกเพิ่ม ไม่ใช่แทนที่
      expect(
        find.byKey(const Key('device_connection_pick_from_list')),
        findsOneWidget,
      );
    },
  );

  group('ประวัติล่าสุด', () {
    testWidgets('ยังไม่มีประวัติ -> ไม่โชว์แถวชิปเลย', (tester) async {
      await _pump(tester, _FakeRepo());
      await tester.pump();

      expect(find.byType(ActionChip), findsNothing);
    });

    testWidgets('ทดสอบสำเร็จ (passed: true) -> บันทึกประวัติ + โชว์เป็นชิป', (
      tester,
    ) async {
      final repo = _FakeRepo(
        result: DeviceConnectionTestResult(
          passed: true,
          signalStrength: -65,
          details: const [],
          testedAt: DateTime(2026),
        ),
      );
      await _pump(tester, repo);

      await tester.enterText(
        find.byKey(const Key('device_id_input')),
        'DEV-001',
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('test_connection_submit')));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const Key('device_connection_recent_chip_0')),
        findsOneWidget,
      );
      expect(find.text('DEV-001'), findsWidgets); // ชิป + result card
    });

    testWidgets(
      'ทดสอบแล้วไม่ passed (signal มีปัญหา) -> ก็ยังนับว่าทดสอบแล้ว บันทึก'
      'ประวัติเหมือนกัน',
      (tester) async {
        final repo = _FakeRepo(
          result: DeviceConnectionTestResult(
            passed: false,
            signalStrength: -110,
            details: const [],
            testedAt: DateTime(2026),
          ),
        );
        await _pump(tester, repo);

        await tester.enterText(
          find.byKey(const Key('device_id_input')),
          'DEV-002',
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('test_connection_submit')));
        await tester.pumpAndSettle();

        expect(
          find.byKey(const Key('device_connection_recent_chip_0')),
          findsOneWidget,
        );
      },
    );

    testWidgets('404 (ไม่พบอุปกรณ์) -> ไม่บันทึกประวัติ', (tester) async {
      final repo = _FakeRepo(error: ApiException('not found', statusCode: 404));
      await _pump(tester, repo);

      await tester.enterText(find.byKey(const Key('device_id_input')), 'NOPE');
      await tester.pump();
      await tester.tap(find.byKey(const Key('test_connection_submit')));
      await tester.pumpAndSettle();

      expect(find.byType(ActionChip), findsNothing);
    });

    testWidgets(
      'กดชิป -> auto-fill ช่อง device_id_input ทันที (ไม่ auto-submit)',
      (tester) async {
        final store = InMemoryRecentDeviceIdStore(['DEV-OLD']);
        final repo = _FakeRepo(
          result: DeviceConnectionTestResult(
            passed: true,
            signalStrength: -65,
            details: const [],
            testedAt: DateTime(2026),
          ),
        );
        await _pump(tester, repo, recentStore: store);
        await tester.pump();

        expect(
          find.byKey(const Key('device_connection_recent_chip_0')),
          findsOneWidget,
        );

        await tester.tap(
          find.byKey(const Key('device_connection_recent_chip_0')),
        );
        await tester.pump();

        final field = tester.widget<TextField>(
          find.byKey(const Key('device_id_input')),
        );
        expect(field.controller!.text, 'DEV-OLD');
        // ไม่ auto-submit — ยังไม่มี result card จนกว่าจะกดปุ่มเอง
        expect(find.byKey(const Key('test_connection_result')), findsNothing);
        expect(repo.lastDeviceId, isNull);
      },
    );
  });
}
