import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';
import 'package:mobile/features/device_search/device_status_repository.dart';
import 'package:mobile/features/firmware_override/firmware_override_page.dart';
import 'package:mobile/features/firmware_override/firmware_override_repository.dart';

final _device = Device(
  id: 'uuid-1',
  deviceId: 'DEV-0117',
  simNumber: '0812345678',
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: DeviceLifecycleStatus.installed,
  registeredAt: DateTime(2026, 6, 1, 9),
);

const _okFw = Firmware(
  id: 'fw-ok',
  version: '2.1.0',
  deviceModelCompatibility: ['GT06N'],
  uploadStatus: 'stored',
  approvalStatus: 'approved',
);
const _otherModelFw = Firmware(
  id: 'fw-other',
  version: '9.9.9',
  deviceModelCompatibility: ['TK103'],
  uploadStatus: 'stored',
  approvalStatus: 'approved',
);
const _unapprovedFw = Firmware(
  id: 'fw-pending',
  version: '3.0.0-rc',
  deviceModelCompatibility: ['GT06N'],
  uploadStatus: 'stored',
  approvalStatus: 'pending_review',
);

class _FakeDeviceSearchRepository implements DeviceSearchRepository {
  @override
  Future<List<Device>> listDevices() async => [_device];

  @override
  Future<Device> getDevice(String deviceId) async => _device;
}

class _FakeDeviceStatusRepository implements DeviceStatusRepository {
  _FakeDeviceStatusRepository({this.pending, this.error});

  final DeviceFirmwareOverride? pending;
  final Object? error;

  @override
  Future<DeviceStatus> getDeviceStatus(String deviceId) async {
    if (error != null) throw error!;
    return DeviceStatus(
      deviceId: deviceId,
      configStatus: DevicePayloadStatus.unknown,
      firmwareStatus: DevicePayloadStatus.unknown,
      pendingFirmwareOverride: pending,
    );
  }
}

const _pendingOverride = DeviceFirmwareOverride(
  id: 'fo-0',
  deviceId: 'DEV-0117',
  firmwareId: 'fw-ok',
  versionNumber: 1,
  reason: 'คำขอเดิมที่ยังรออยู่',
  status: 'pending',
  overriddenBy: 'st-1',
  overriddenAt: '2026-10-06T00:00:00.000Z',
);

class _FakeFirmwareOverrideRepository implements FirmwareOverrideRepository {
  _FakeFirmwareOverrideRepository({
    this.firmware = const [_okFw, _otherModelFw, _unapprovedFw],
    this.listError,
    this.overrideError,
  });

  final List<Firmware> firmware;
  final Object? listError;
  final Object? overrideError;

  String? lastDeviceId;
  String? lastFirmwareId;
  String? lastReason;

  @override
  Future<List<Firmware>> listFirmware() async {
    if (listError != null) throw listError!;
    return firmware;
  }

  @override
  Future<DeviceFirmwareOverride> overrideFirmware({
    required String deviceId,
    required String firmwareId,
    required String reason,
  }) async {
    lastDeviceId = deviceId;
    lastFirmwareId = firmwareId;
    lastReason = reason;
    if (overrideError != null) throw overrideError!;
    return DeviceFirmwareOverride(
      id: 'fo-1',
      deviceId: deviceId,
      firmwareId: firmwareId,
      versionNumber: 1,
      reason: reason,
      status: 'pending',
      overriddenBy: 'st-1',
      overriddenAt: '2026-10-06T00:00:00.000Z',
    );
  }
}

Future<_FakeFirmwareOverrideRepository> _pump(
  WidgetTester tester, {
  _FakeFirmwareOverrideRepository? repo,
  _FakeDeviceStatusRepository? statusRepo,
}) async {
  final fake = repo ?? _FakeFirmwareOverrideRepository();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        firmwareOverrideRepositoryProvider.overrideWithValue(fake),
        deviceSearchRepositoryProvider.overrideWithValue(
          _FakeDeviceSearchRepository(),
        ),
        deviceStatusRepositoryProvider.overrideWithValue(
          statusRepo ?? _FakeDeviceStatusRepository(),
        ),
      ],
      child: const MaterialApp(
        home: FirmwareOverridePage(deviceId: 'DEV-0117'),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return fake;
}

Future<void> _selectFirmware(WidgetTester tester, String label) async {
  await tester.tap(find.byKey(const Key('firmware_override_select')));
  await tester.pumpAndSettle();
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

Future<void> _submit(WidgetTester tester, {String reason = 'ลูกค้าขอ'}) async {
  await tester.enterText(
    find.byKey(const Key('firmware_override_reason_input')),
    reason,
  );
  await tester.tap(find.byKey(const Key('firmware_override_submit')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'แสดงเฉพาะ Firmware ที่ติดตั้งได้กับรุ่นนี้ (stored+approved+รองรับรุ่น)',
    (tester) async {
      await _pump(tester);

      await tester.tap(find.byKey(const Key('firmware_override_select')));
      await tester.pumpAndSettle();

      expect(find.text('v2.1.0'), findsWidgets);
      expect(find.text('v9.9.9'), findsNothing); // ไม่รองรับรุ่น GT06N
      expect(find.text('v3.0.0-rc'), findsNothing); // ยังไม่อนุมัติคุณภาพ
    },
  );

  testWidgets(
    'ไม่มี Firmware ที่ติดตั้งได้ -> ข้อความอธิบาย + ปุ่มส่งกดไม่ได้',
    (tester) async {
      await _pump(
        tester,
        repo: _FakeFirmwareOverrideRepository(firmware: const [_otherModelFw]),
      );

      expect(
        find.byKey(const Key('firmware_override_no_options')),
        findsOneWidget,
      );
      final button = tester.widget<FilledButton>(
        find.byKey(const Key('firmware_override_submit')),
      );
      expect(button.onPressed, isNull);
    },
  );

  testWidgets('ไม่เลือก Firmware -> error ไม่เรียก API', (tester) async {
    final fake = await _pump(tester);

    await _submit(tester);

    expect(find.text('เลือก Firmware ก่อน'), findsOneWidget);
    expect(fake.lastDeviceId, isNull);
  });

  testWidgets('ไม่กรอกเหตุผล -> error ไม่เรียก API', (tester) async {
    final fake = await _pump(tester);
    await _selectFirmware(tester, 'v2.1.0');

    await tester.tap(find.byKey(const Key('firmware_override_submit')));
    await tester.pumpAndSettle();

    expect(find.text('กรอกเหตุผลก่อนส่งคำขอ'), findsOneWidget);
    expect(fake.lastDeviceId, isNull);
  });

  testWidgets('เลือก + กรอกเหตุผล -> ส่ง deviceId/firmwareId/reason ถูกต้อง '
      'แล้วขึ้นสถานะรออนุมัติ', (tester) async {
    final fake = await _pump(tester);
    await _selectFirmware(tester, 'v2.1.0');

    await _submit(tester, reason: '  ลูกค้าขอใช้รุ่นนี้  ');

    expect(fake.lastDeviceId, 'DEV-0117');
    expect(fake.lastFirmwareId, 'fw-ok');
    expect(fake.lastReason, 'ลูกค้าขอใช้รุ่นนี้'); // trim แล้ว
    expect(
      find.byKey(const Key('firmware_override_submitted')),
      findsOneWidget,
    );
    expect(find.byKey(const Key('firmware_override_error')), findsNothing);
    // ส่งซ้ำไม่ได้
    final button = tester.widget<FilledButton>(
      find.byKey(const Key('firmware_override_submit')),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('409 (มีคำขอ pending อยู่แล้ว) -> แสดงข้อความ backend + คำอธิบาย '
      'ว่าต้องรอ ไม่ใช่ error เปล่าๆ', (tester) async {
    await _pump(
      tester,
      repo: _FakeFirmwareOverrideRepository(
        overrideError: ApiException(
          'อุปกรณ์นี้มีคำขอ override ที่รอ Operation อนุมัติอยู่แล้ว — รอผลก่อนส่งคำขอใหม่',
          statusCode: 409,
        ),
      ),
    );
    await _selectFirmware(tester, 'v2.1.0');

    await _submit(tester);

    expect(find.byKey(const Key('firmware_override_error')), findsOneWidget);
    expect(find.textContaining('รอ Operation อนุมัติอยู่แล้ว'), findsOneWidget);
    expect(
      find.byKey(const Key('firmware_override_conflict_hint')),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('firmware_override_submitted')),
      findsNothing,
    ); // ยังส่งใหม่ได้
  });

  testWidgets('403/อื่นๆ -> แสดง error ไม่แสดง hint ของ 409', (tester) async {
    await _pump(
      tester,
      repo: _FakeFirmwareOverrideRepository(
        overrideError: ApiException('ไม่มีสิทธิ์', statusCode: 403),
      ),
    );
    await _selectFirmware(tester, 'v2.1.0');

    await _submit(tester);

    expect(find.text('ไม่มีสิทธิ์'), findsOneWidget);
    expect(
      find.byKey(const Key('firmware_override_conflict_hint')),
      findsNothing,
    );
  });

  testWidgets('โหลดรายการ Firmware ไม่สำเร็จ -> error + ปุ่มลองอีกครั้ง', (
    tester,
  ) async {
    await _pump(
      tester,
      repo: _FakeFirmwareOverrideRepository(
        listError: ApiException('เซิร์ฟเวอร์ขัดข้อง', statusCode: 500),
      ),
    );

    expect(
      find.byKey(const Key('firmware_override_load_error')),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('firmware_override_load_retry')),
      findsOneWidget,
    );
  });

  group('pendingFirmwareOverride banner (PR #257)', () {
    testWidgets('มีคำขอ pending -> เห็น banner + ปุ่มส่งกดไม่ได้', (
      tester,
    ) async {
      await _pump(
        tester,
        statusRepo: _FakeDeviceStatusRepository(pending: _pendingOverride),
      );

      expect(
        find.byKey(const Key('firmware_override_pending_banner')),
        findsOneWidget,
      );
      expect(find.text('เหตุผล: คำขอเดิมที่ยังรออยู่'), findsOneWidget);
      final button = tester.widget<FilledButton>(
        find.byKey(const Key('firmware_override_submit')),
      );
      expect(button.onPressed, isNull);
    });

    testWidgets('ไม่มีคำขอ pending -> ไม่เห็น banner', (tester) async {
      await _pump(tester);

      expect(
        find.byKey(const Key('firmware_override_pending_banner')),
        findsNothing,
      );
    });

    testWidgets('โหลดสถานะไม่สำเร็จ -> ไม่ block ฟอร์ม (ไม่มี banner)', (
      tester,
    ) async {
      await _pump(
        tester,
        statusRepo: _FakeDeviceStatusRepository(
          error: ApiException('ล้มเหลว', statusCode: 500),
        ),
      );

      expect(
        find.byKey(const Key('firmware_override_pending_banner')),
        findsNothing,
      );
      expect(find.byKey(const Key('firmware_override_select')), findsOneWidget);
    });
  });
}
