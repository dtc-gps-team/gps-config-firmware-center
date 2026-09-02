import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/device_connection_test/device_connection_test_page.dart';
import 'package:mobile/features/device_connection_test/device_connection_test_repository.dart';

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
  DeviceConnectionTestRepository repo,
) {
  return tester.pumpWidget(
    ProviderScope(
      overrides: [
        deviceConnectionTestRepositoryProvider.overrideWithValue(repo),
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
    final repo = _FakeRepo(
      error: ApiException('not found', statusCode: 404),
    );
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
    final repo = _FakeRepo(
      error: ApiException('conflict', statusCode: 409),
    );
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
}
