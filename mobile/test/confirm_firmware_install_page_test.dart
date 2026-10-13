import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';
import 'package:mobile/features/device_search/device_status_repository.dart';
import 'package:mobile/features/firmware_install/confirm_firmware_install_page.dart';
import 'package:mobile/features/firmware_install/confirm_firmware_install_repository.dart';
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
  _FakeDeviceStatusRepository({
    this.firmwareStatus = DevicePayloadStatus.unknown,
    this.firmwareRolloutId,
    this.error,
  });

  final DevicePayloadStatus firmwareStatus;
  final String? firmwareRolloutId;
  final Object? error;

  @override
  Future<DeviceStatus> getDeviceStatus(String deviceId) async {
    if (error != null) throw error!;
    return DeviceStatus(
      deviceId: deviceId,
      configStatus: DevicePayloadStatus.unknown,
      firmwareStatus: firmwareStatus,
      firmwareRolloutId: firmwareRolloutId,
    );
  }
}

class _FakeFirmwareOverrideRepository implements FirmwareOverrideRepository {
  _FakeFirmwareOverrideRepository(this.firmware);

  final List<Firmware> firmware;

  @override
  Future<List<Firmware>> listFirmware() async => firmware;

  @override
  Future<DeviceFirmwareOverride> overrideFirmware({
    required String deviceId,
    required String firmwareId,
    required String reason,
  }) => throw UnimplementedError();
}

class _FakeConfirmRepository implements ConfirmFirmwareInstallRepository {
  _FakeConfirmRepository({this.error});

  final Object? error;
  int calls = 0;
  String? lastDeviceId;
  String? lastFirmwareId;
  String? lastRolloutId;

  @override
  Future<ConfirmFirmwareInstallResult> confirm({
    required String deviceId,
    required String firmwareId,
    String? rolloutId,
  }) async {
    calls++;
    lastDeviceId = deviceId;
    lastFirmwareId = firmwareId;
    lastRolloutId = rolloutId;
    if (error != null) throw error!;
    return ConfirmFirmwareInstallResult(
      deviceId: deviceId,
      firmwareId: firmwareId,
      confirmedAt: DateTime(2026, 10, 12, 10, 30),
    );
  }
}

class _FakeAuthController extends AuthController {
  _FakeAuthController(this._role);

  final UserRole? _role;

  @override
  AuthState build() => AuthState(status: AuthStatus.authenticated, role: _role);
}

const _gateMessage =
    'Firmware นี้ไม่ตรงกับแผนที่ Campaign กำหนดไว้ (fw-ok) — ต้องขอ Firmware '
    'Override ก่อน (หรือ override เดิมถูกใช้ไปแล้ว)';

Future<void> _pump(
  WidgetTester tester, {
  required _FakeConfirmRepository confirmRepo,
  UserRole role = UserRole.st,
  List<Firmware> firmware = const [_okFw, _otherModelFw, _unapprovedFw],
  DeviceStatusRepository? statusRepo,
}) async {
  final router = GoRouter(
    initialLocation: AppRoutes.deviceConfirmFirmware('DEV-0117'),
    routes: [
      GoRoute(
        path: AppRoutes.deviceConfirmFirmwarePattern,
        builder: (context, state) => ConfirmFirmwareInstallPage(
          deviceId: state.pathParameters['deviceId']!,
        ),
      ),
      GoRoute(
        path: AppRoutes.deviceFirmwareOverridePattern,
        builder: (context, state) =>
            const Scaffold(body: Text('FIRMWARE OVERRIDE PAGE')),
      ),
    ],
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        deviceSearchRepositoryProvider.overrideWithValue(
          _FakeDeviceSearchRepository(),
        ),
        deviceStatusRepositoryProvider.overrideWithValue(
          statusRepo ?? _FakeDeviceStatusRepository(),
        ),
        firmwareOverrideRepositoryProvider.overrideWithValue(
          _FakeFirmwareOverrideRepository(firmware),
        ),
        confirmFirmwareInstallRepositoryProvider.overrideWithValue(confirmRepo),
        authControllerProvider.overrideWith(() => _FakeAuthController(role)),
      ],
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pump(); // resolve device
  await tester.pump(); // resolve firmware list
}

Future<void> _selectFirmware(WidgetTester tester, String label) async {
  await tester.tap(find.byKey(const Key('confirm_firmware_select')));
  await tester.pumpAndSettle();
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

Future<void> _submit(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('confirm_firmware_submit')));
  await tester.pump(); // kick off _confirm
  await tester.pump(); // status lookup
  await tester.pump(); // confirm call
}

void main() {
  group('รายการ Firmware', () {
    testWidgets(
      'แสดงเฉพาะตัวที่ติดตั้งได้กับรุ่นเครื่อง (stored+approved+รองรับรุ่น)',
      (tester) async {
        await _pump(tester, confirmRepo: _FakeConfirmRepository());

        await tester.tap(find.byKey(const Key('confirm_firmware_select')));
        await tester.pumpAndSettle();

        expect(find.text('v2.1.0'), findsWidgets);
        expect(find.text('v9.9.9'), findsNothing); // คนละรุ่น
        expect(find.text('v3.0.0-rc'), findsNothing); // ยังไม่ approved
      },
    );

    testWidgets('ไม่มี Firmware ที่ติดตั้งได้ -> แจ้ง + ปุ่มยืนยัน disabled', (
      tester,
    ) async {
      await _pump(
        tester,
        confirmRepo: _FakeConfirmRepository(),
        firmware: const [_otherModelFw, _unapprovedFw],
      );

      expect(find.byKey(const Key('confirm_firmware_no_options')), findsOne);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const Key('confirm_firmware_submit')),
            )
            .onPressed,
        isNull,
      );
    });
  });

  group('200 สำเร็จ', () {
    testWidgets(
      'เลือก + ยืนยัน -> เรียก repo + แสดงผล (deviceId, firmware, เวลา)',
      (tester) async {
        final repo = _FakeConfirmRepository();
        await _pump(tester, confirmRepo: repo);

        await _selectFirmware(tester, 'v2.1.0');
        await _submit(tester);

        expect(repo.calls, 1);
        expect(repo.lastDeviceId, 'DEV-0117');
        expect(repo.lastFirmwareId, 'fw-ok');
        expect(find.byKey(const Key('confirm_firmware_success')), findsOne);
        expect(find.text('อุปกรณ์: DEV-0117'), findsOne);
        expect(find.text('Firmware: v2.1.0'), findsOne);
        expect(find.text('เมื่อ: 12/10/2026 10:30'), findsOne);
        // กดซ้ำไม่ได้
        expect(
          tester
              .widget<FilledButton>(
                find.byKey(const Key('confirm_firmware_submit')),
              )
              .onPressed,
          isNull,
        );
      },
    );

    testWidgets('ยังไม่เลือก Firmware -> ไม่เรียก repo + บอกให้เลือก', (
      tester,
    ) async {
      final repo = _FakeConfirmRepository();
      await _pump(tester, confirmRepo: repo);

      await _submit(tester);

      expect(repo.calls, 0);
      expect(find.text('เลือก Firmware ก่อน'), findsOne);
    });
  });

  group('rolloutId (issue #265)', () {
    testWidgets(
      'firmwareStatus pending + มี firmwareRolloutId -> ส่ง rolloutId',
      (tester) async {
        final repo = _FakeConfirmRepository();
        await _pump(
          tester,
          confirmRepo: repo,
          statusRepo: _FakeDeviceStatusRepository(
            firmwareStatus: DevicePayloadStatus.pending,
            firmwareRolloutId: 'ro-fw-1',
          ),
        );

        await _selectFirmware(tester, 'v2.1.0');
        await _submit(tester);

        expect(repo.lastRolloutId, 'ro-fw-1');
      },
    );

    testWidgets('ไม่ pending / ไม่มี rollout -> ไม่ส่ง rolloutId (null)', (
      tester,
    ) async {
      final repo = _FakeConfirmRepository();
      await _pump(tester, confirmRepo: repo);

      await _selectFirmware(tester, 'v2.1.0');
      await _submit(tester);

      expect(repo.calls, 1);
      expect(repo.lastRolloutId, isNull);
    });

    testWidgets('โหลดสถานะไม่สำเร็จ -> ยังยืนยันได้ โดยไม่ส่ง rolloutId', (
      tester,
    ) async {
      final repo = _FakeConfirmRepository();
      await _pump(
        tester,
        confirmRepo: repo,
        statusRepo: _FakeDeviceStatusRepository(
          error: ApiException('เซิร์ฟเวอร์ล่ม', statusCode: 500),
        ),
      );

      await _selectFirmware(tester, 'v2.1.0');
      await _submit(tester);

      expect(repo.calls, 1);
      expect(repo.lastRolloutId, isNull);
      expect(find.byKey(const Key('confirm_firmware_success')), findsOne);
    });
  });

  group('409', () {
    testWidgets(
      'gate (ไม่ตรง Campaign) + ST -> ข้อความ + ปุ่มไปหน้า Firmware Override',
      (tester) async {
        final repo = _FakeConfirmRepository(
          error: ApiException(_gateMessage, statusCode: 409),
        );
        await _pump(tester, confirmRepo: repo, role: UserRole.st);

        await _selectFirmware(tester, 'v2.1.0');
        await _submit(tester);

        expect(find.text(_gateMessage), findsOne);
        expect(find.byKey(const Key('confirm_firmware_gate_hint')), findsOne);
        expect(
          find.byKey(const Key('confirm_firmware_goto_override')),
          findsOne,
        );
        expect(find.byKey(const Key('confirm_firmware_success')), findsNothing);

        await tester.tap(
          find.byKey(const Key('confirm_firmware_goto_override')),
        );
        await tester.pumpAndSettle();
        expect(find.text('FIRMWARE OVERRIDE PAGE'), findsOne);
      },
    );

    testWidgets(
      'gate + OT -> เห็นข้อความแต่ไม่มีปุ่มลิงก์ (OT ขอ override ไม่ได้)',
      (tester) async {
        final repo = _FakeConfirmRepository(
          error: ApiException(_gateMessage, statusCode: 409),
        );
        await _pump(tester, confirmRepo: repo, role: UserRole.ot);

        await _selectFirmware(tester, 'v2.1.0');
        await _submit(tester);

        expect(find.text(_gateMessage), findsOne);
        expect(find.byKey(const Key('confirm_firmware_gate_hint')), findsOne);
        expect(
          find.byKey(const Key('confirm_firmware_goto_override')),
          findsNothing,
        );
      },
    );

    testWidgets(
      '409 อื่น (Device ยังไม่ installed) -> แค่ข้อความ error ไม่มีปุ่มลิงก์',
      (tester) async {
        const msg =
            'Device สถานะปัจจุบัน (registered) ยังยืนยันติดตั้ง Firmware ไม่ได้ — '
            'ต้องเป็น installed (ติดตั้งจริงแล้ว) เท่านั้น';
        final repo = _FakeConfirmRepository(
          error: ApiException(msg, statusCode: 409),
        );
        await _pump(tester, confirmRepo: repo, role: UserRole.st);

        await _selectFirmware(tester, 'v2.1.0');
        await _submit(tester);

        expect(find.text(msg), findsOne);
        expect(
          find.byKey(const Key('confirm_firmware_gate_hint')),
          findsNothing,
        );
        expect(
          find.byKey(const Key('confirm_firmware_goto_override')),
          findsNothing,
        );
        // ลองใหม่ได้ (ปุ่มไม่ถูกล็อก)
        expect(
          tester
              .widget<FilledButton>(
                find.byKey(const Key('confirm_firmware_submit')),
              )
              .onPressed,
          isNotNull,
        );
      },
    );
  });

  group('isFirmwareGateConflict', () {
    test('409 + ข้อความพูดถึง Firmware Override -> true', () {
      expect(
        isFirmwareGateConflict(ApiException(_gateMessage, statusCode: 409)),
        isTrue,
      );
    });

    test('409 ที่ไม่พูดถึง override / status อื่น -> false', () {
      expect(
        isFirmwareGateConflict(
          ApiException('Firmware ไม่รองรับรุ่นอุปกรณ์', statusCode: 409),
        ),
        isFalse,
      );
      expect(
        isFirmwareGateConflict(ApiException(_gateMessage, statusCode: 400)),
        isFalse,
      );
    });
  });
}
