import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';
import 'package:mobile/features/incident/field_report_page.dart';
import 'package:mobile/features/incident/incident_repository.dart';

Device _device(String id, String model) => Device(
  id: 'uuid-$id',
  deviceId: id,
  simNumber: '0812345678',
  deviceModel: model,
  protocol: 'TCP',
  status: DeviceLifecycleStatus.installed,
  registeredAt: DateTime(2026, 6, 1, 9),
);

class _FakeDeviceSearchRepository implements DeviceSearchRepository {
  _FakeDeviceSearchRepository({this.listError});

  final Object? listError;

  @override
  Future<List<Device>> listDevices() async {
    if (listError != null) throw listError!;
    return [_device('DEV-0001', 'GT06N'), _device('DEV-0002', 'GT06L')];
  }

  @override
  Future<Device> getDevice(String deviceId) => throw UnimplementedError();
}

/// ใช้ MockIncidentRepository จริง (pattern เดียวกับ MockTaskRepository) แต่
/// บันทึกการเรียกไว้ให้ assert และจำลอง error ได้
class _SpyIncidentRepository extends MockIncidentRepository {
  _SpyIncidentRepository({this.createError});

  final Object? createError;
  int createCalls = 0;
  String? lastTitle;
  String? lastDescription;
  IncidentSeverity? lastSeverity;
  String? lastDeviceId;

  @override
  Future<Incident> createFieldReport({
    required String title,
    required String description,
    required IncidentSeverity severity,
    String? deviceId,
  }) {
    createCalls++;
    lastTitle = title;
    lastDescription = description;
    lastSeverity = severity;
    lastDeviceId = deviceId;
    if (createError != null) throw createError!;
    return super.createFieldReport(
      title: title,
      description: description,
      severity: severity,
      deviceId: deviceId,
    );
  }
}

Future<_SpyIncidentRepository> _pump(
  WidgetTester tester, {
  _SpyIncidentRepository? repo,
  _FakeDeviceSearchRepository? devices,
  String? initialDeviceId,
}) async {
  final spy = repo ?? _SpyIncidentRepository();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        incidentRepositoryProvider.overrideWithValue(spy),
        deviceSearchRepositoryProvider.overrideWithValue(
          devices ?? _FakeDeviceSearchRepository(),
        ),
      ],
      child: MaterialApp(
        home: FieldReportPage(initialDeviceId: initialDeviceId),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return spy;
}

Future<void> _fill(
  WidgetTester tester, {
  String title = 'ไม่ส่งสัญญาณ',
  String description = 'หลังติดตั้งไม่มีสัญญาณ',
}) async {
  await tester.enterText(find.byKey(const Key('field_report_title')), title);
  await tester.enterText(
    find.byKey(const Key('field_report_description')),
    description,
  );
}

Future<void> _tapSubmit(WidgetTester tester) async {
  // ปุ่มอยู่ท้ายฟอร์มยาว (ListView สร้าง lazy) — เลื่อนลงจนเจอก่อนแตะ
  final submit = find.byKey(const Key('field_report_submit'));
  await tester.scrollUntilVisible(
    submit,
    300,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.tap(submit);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('ไม่กรองหัวข้อ -> error ไม่เรียก repository', (tester) async {
    final spy = await _pump(tester);

    await _tapSubmit(tester);

    expect(find.text('กรอกหัวข้อปัญหาก่อน'), findsOneWidget);
    expect(spy.createCalls, 0);
  });

  testWidgets('กรอกหัวข้อแต่ไม่กรอกรายละเอียด -> error ไม่เรียก repository', (
    tester,
  ) async {
    final spy = await _pump(tester);
    await _fill(tester, description: '   ');

    await _tapSubmit(tester);

    expect(find.text('กรอกรายละเอียดปัญหาก่อน'), findsOneWidget);
    expect(spy.createCalls, 0);
  });

  testWidgets(
    'กรอกครบ -> ส่ง trim แล้ว ความรุนแรง default ปานกลาง ไม่ระบุอุปกรณ์',
    (tester) async {
      final spy = await _pump(tester);
      await _fill(
        tester,
        title: '  ไม่ส่งสัญญาณ ',
        description: ' รายละเอียด ',
      );

      await _tapSubmit(tester);

      expect(spy.createCalls, 1);
      expect(spy.lastTitle, 'ไม่ส่งสัญญาณ');
      expect(spy.lastDescription, 'รายละเอียด');
      expect(spy.lastSeverity, IncidentSeverity.medium);
      expect(spy.lastDeviceId, isNull);
      expect(find.byKey(const Key('field_report_submitted')), findsOneWidget);
      expect(find.byKey(const Key('field_report_error')), findsNothing);
      // ส่งซ้ำไม่ได้
      final button = tester.widget<FilledButton>(
        find.byKey(const Key('field_report_submit')),
      );
      expect(button.onPressed, isNull);
    },
  );

  testWidgets('เลือกความรุนแรงและอุปกรณ์ -> ส่งค่าตามที่เลือก', (tester) async {
    final spy = await _pump(tester);
    await _fill(tester);

    await tester.tap(find.byKey(const Key('field_report_severity')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('วิกฤต').last);
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('field_report_device')));
    await tester.tap(find.byKey(const Key('field_report_device')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('DEV-0002 · GT06L').last);
    await tester.pumpAndSettle();

    await _tapSubmit(tester);

    expect(spy.lastSeverity, IncidentSeverity.critical);
    expect(spy.lastDeviceId, 'DEV-0002');
  });

  testWidgets('initialDeviceId (เปิดจาก Device Detail) -> pre-fill อุปกรณ์', (
    tester,
  ) async {
    final spy = await _pump(tester, initialDeviceId: 'DEV-0001');
    await _fill(tester);

    await _tapSubmit(tester);

    expect(spy.lastDeviceId, 'DEV-0001');
  });

  testWidgets(
    'โหลดรายการอุปกรณ์ไม่สำเร็จ -> ฟอร์มยังส่งได้ (อุปกรณ์ optional)',
    (tester) async {
      final spy = await _pump(
        tester,
        devices: _FakeDeviceSearchRepository(
          listError: ApiException('ล้มเหลว', statusCode: 500),
        ),
      );
      await _fill(tester);

      await _tapSubmit(tester);

      expect(spy.createCalls, 1);
      expect(find.byKey(const Key('field_report_submitted')), findsOneWidget);
    },
  );

  testWidgets(
    'backend 400/403 -> แสดง message + details ที่ฟอร์ม ไม่ถือว่าส่งแล้ว',
    (tester) async {
      final spy = await _pump(
        tester,
        repo: _SpyIncidentRepository(
          createError: ApiException(
            'ไม่มีสิทธิ์แจ้งปัญหา',
            statusCode: 403,
            details: const ['role นี้ไม่มีสิทธิ์ Create incidents'],
          ),
        ),
      );
      await _fill(tester);

      await _tapSubmit(tester);

      expect(spy.createCalls, 1);
      expect(find.byKey(const Key('field_report_error')), findsOneWidget);
      expect(find.text('ไม่มีสิทธิ์แจ้งปัญหา'), findsOneWidget);
      expect(
        find.text('• role นี้ไม่มีสิทธิ์ Create incidents'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('field_report_submitted')), findsNothing);
      // กดส่งใหม่ได้
      final button = tester.widget<FilledButton>(
        find.byKey(const Key('field_report_submit')),
      );
      expect(button.onPressed, isNotNull);
    },
  );

  testWidgets('แจ้งผู้ใช้ชัดว่าไม่ auto-pause/rollback', (tester) async {
    await _pump(tester);

    expect(find.textContaining('ไม่ได้สั่ง'), findsOneWidget);
    expect(find.textContaining('Operation จะเป็นผู้ตัดสินใจ'), findsOneWidget);
  });
}
