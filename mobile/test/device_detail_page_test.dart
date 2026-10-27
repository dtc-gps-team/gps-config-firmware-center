import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/ui/app_info_row.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/config_override/config_override_repository.dart';
import 'package:mobile/features/device_search/device_detail_page.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';
import 'package:mobile/features/device_search/device_status_repository.dart';
import 'package:mobile/features/task/apply_mode_provider.dart';
import 'package:mobile/features/task/field_task_repository.dart';

import 'support/fake_field_task_repository.dart';

class _FakeAuthController extends AuthController {
  _FakeAuthController(this._role);

  final UserRole? _role;

  @override
  AuthState build() => AuthState(status: AuthStatus.authenticated, role: _role);
}

Device _makeDevice({
  DeviceLifecycleStatus status = DeviceLifecycleStatus.installed,
  DateTime? installedAt,
}) => Device(
  id: 'uuid-1',
  deviceId: 'DEV-0117',
  simNumber: '0812345678',
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: status,
  registeredAt: DateTime(2026, 6, 1, 9),
  installedAt: installedAt ?? DateTime(2026, 6, 3, 14, 30),
);

class _FakeDeviceSearchRepository implements DeviceSearchRepository {
  _FakeDeviceSearchRepository({Device? device, this.getError})
    : _device = device ?? _makeDevice();

  final Device _device;
  final Object? getError;

  @override
  Future<List<Device>> listDevices() async => [_device];

  @override
  Future<Device> getDevice(String deviceId) async {
    if (getError != null) throw getError!;
    return _device;
  }
}

class _FakeDeviceStatusRepository implements DeviceStatusRepository {
  _FakeDeviceStatusRepository({DeviceStatus? status, this.error})
    : _status = status ?? _makeStatus();

  final DeviceStatus _status;
  Object? error;
  final List<String> calls = [];

  @override
  Future<DeviceStatus> getDeviceStatus(String deviceId) async {
    calls.add(deviceId);
    if (error != null) throw error!;
    return _status;
  }
}

class _NeverCompletesStatusRepository implements DeviceStatusRepository {
  @override
  Future<DeviceStatus> getDeviceStatus(String deviceId) =>
      Completer<DeviceStatus>().future;
}

DeviceConfigOverride _pendingOverride() => DeviceConfigOverride(
  id: 'ovr-1',
  deviceId: 'DEV-0117',
  configId: 'cfg-1',
  versionNumber: 1,
  fields: const {'REPORT_INTERVAL_MOVING': 60},
  reason: 'ลูกค้าขอปรับรอบส่งพิกัด',
  status: 'pending',
  overriddenBy: 'u-st',
  overriddenAt: '2026-10-16T09:00:00.000Z',
);

/// `GET /devices/{deviceId}/config` ปลอม — ตั้ง [pending] / [error] ระหว่างเทสได้
/// (จำลองว่าไปส่งคำขอที่หน้า Override แล้วย้อนกลับมา)
class _FakeConfigOverrideRepository implements ConfigOverrideRepository {
  DeviceConfigOverride? pending;
  Object? error;
  int getCalls = 0;

  @override
  Future<DeviceConfigDraft> getCurrentConfig(String deviceId) async {
    getCalls++;
    if (error != null) throw error!;
    return DeviceConfigDraft(
      id: 'cfg-1',
      fields: const {'REPORT_INTERVAL_MOVING': 30},
      pendingOverride: pending,
    );
  }

  @override
  Future<List<ConfigFieldDefinition>> listDefinitions() async => const [];

  @override
  Future<DeviceConfigOverride> overrideConfig({
    required String deviceId,
    required Map<String, dynamic> fields,
    required String reason,
  }) => throw UnimplementedError();
}

DeviceStatus _makeStatus({
  DevicePayloadStatus config = DevicePayloadStatus.unknown,
  DevicePayloadStatus firmware = DevicePayloadStatus.unknown,
  String? message,
  DeviceFirmwareOverride? pendingFirmwareOverride,
}) => DeviceStatus(
  deviceId: 'DEV-0117',
  configStatus: config,
  firmwareStatus: firmware,
  lastCheckInMessage: message,
  pendingFirmwareOverride: pendingFirmwareOverride,
);

Future<void> _pump(
  WidgetTester tester, {
  required DeviceSearchRepository repo,
  DeviceStatusRepository? statusRepo,
  String deviceId = 'DEV-0117',
  UserRole? role,
  ConfigOverrideRepository? overrideRepo,
  GoRouter? router,
  Task? openTask,
  FieldTaskRepository? fieldTaskRepo,
  bool centralMode = false,
}) async {
  // หน้านี้ยาวขึ้นหลังเพิ่ม section "ข้อมูลอุปกรณ์"/"ลูกค้า" — ใช้จอสูงพอให้
  // ListView สร้างทุก section (สถานะ Config/Firmware, ปุ่มด้านล่าง) ได้ในเทสต์
  tester.view.physicalSize = const Size(1080, 4000);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        deviceSearchRepositoryProvider.overrideWithValue(repo),
        deviceStatusRepositoryProvider.overrideWithValue(
          statusRepo ?? _FakeDeviceStatusRepository(),
        ),
        authControllerProvider.overrideWith(() => _FakeAuthController(role)),
        configOverrideRepositoryProvider.overrideWithValue(
          overrideRepo ?? _FakeConfigOverrideRepository(),
        ),
        // docs/28 — ไม่ให้ไปโหลดรายการงานจริง (cache/DB) ในเทสหน้านี้
        openTaskForDeviceProvider.overrideWith((ref, _) async => openTask),
        fieldTaskRepositoryProvider.overrideWithValue(
          fieldTaskRepo ?? FakeFieldTaskRepository(),
        ),
        centralApplyModeProvider.overrideWith((ref) async => centralMode),
      ],
      child: router == null
          ? MaterialApp(home: DeviceDetailPage(deviceId: deviceId))
          : MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pump(); // resolve getDevice
}

/// แถวในการ์ดข้อมูลที่มี [label] — ใช้หาค่าของแถวนั้นโดยไม่ชนกับ "-" ของแถวอื่น
/// (แถวเป็น `AppInfoRow` ตั้งแต่ docs/22 Batch 4)
Finder _rowValue(String label, String value) => find.descendant(
  of: find
      .ancestor(of: find.text(label), matching: find.byType(AppInfoRow))
      .first,
  matching: find.text(value),
);

void main() {
  _statusTests();
  _pendingConfigOverrideTests();

  // ผลตรวจ #304 — backend ส่ง imei/serialNumber/blackboxId/customer มาแล้ว และ
  // Web แสดงแล้ว แต่ Mobile ยังไม่แสดง
  group('ข้อมูลอุปกรณ์ + ลูกค้า', () {
    testWidgets('มีค่าครบ -> แสดง IMEI, Serial, Blackbox ID และชื่อลูกค้า', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(
          device: Device(
            id: 'uuid-1',
            deviceId: 'DEV-0117',
            simNumber: '0812345678',
            deviceModel: 'GT06N',
            protocol: 'TCP',
            status: DeviceLifecycleStatus.installed,
            registeredAt: DateTime(2026, 6, 1, 9),
            imei: '860000000000117',
            serialNumber: 'SNGT06N000117',
            blackboxId: '7100000117',
            customer: const Customer(id: 'c1', companyName: 'ขนส่งสมมติ จำกัด'),
          ),
        ),
      );

      expect(find.text('ข้อมูลอุปกรณ์'), findsOneWidget);
      expect(find.text('ลูกค้า'), findsOneWidget);
      expect(_rowValue('IMEI', '860000000000117'), findsOneWidget);
      expect(_rowValue('Serial Number', 'SNGT06N000117'), findsOneWidget);
      expect(_rowValue('Blackbox ID', '7100000117'), findsOneWidget);
      expect(_rowValue('ชื่อบริษัท', 'ขนส่งสมมติ จำกัด'), findsOneWidget);
    });

    testWidgets('เป็น null ทั้งหมด -> แสดง "-" ทุกแถว ไม่ซ่อนแถว ไม่ crash', (
      tester,
    ) async {
      await _pump(tester, repo: _FakeDeviceSearchRepository());

      expect(tester.takeException(), isNull);
      expect(_rowValue('IMEI', '-'), findsOneWidget);
      expect(_rowValue('Serial Number', '-'), findsOneWidget);
      expect(_rowValue('Blackbox ID', '-'), findsOneWidget);
      expect(_rowValue('ชื่อบริษัท', '-'), findsOneWidget);
    });
  });

  testWidgets('โหลดสำเร็จ -> แสดง field ครบ', (tester) async {
    await _pump(
      tester,
      repo: _FakeDeviceSearchRepository(
        device: _makeDevice(status: DeviceLifecycleStatus.installed),
      ),
    );

    expect(find.text('DEV-0117'), findsOneWidget);
    expect(find.text('0812345678'), findsOneWidget);
    expect(find.text('GT06N'), findsOneWidget);
    expect(find.text('TCP'), findsOneWidget);
    // ป้ายสถานะเครื่องบนหัวหน้าจอ (docs/22 §6.1 — Installed ตาม Web)
    expect(find.text('Installed'), findsOneWidget);
    expect(find.text('01/06/2026 09:00'), findsOneWidget); // registeredAt
    expect(find.text('03/06/2026 14:30'), findsOneWidget); // installedAt
  });

  testWidgets('ยังไม่ติดตั้ง (installedAt null) -> แสดง -', (tester) async {
    await _pump(
      tester,
      repo: _FakeDeviceSearchRepository(
        device: Device(
          id: 'uuid-1',
          deviceId: 'DEV-0092',
          simNumber: '0899999999',
          deviceModel: 'GT06L',
          protocol: 'TCP',
          status: DeviceLifecycleStatus.registered,
          registeredAt: DateTime(2026, 8, 20, 10),
        ),
      ),
      deviceId: 'DEV-0092',
    );

    expect(find.text('DEV-0092'), findsOneWidget);
    expect(find.text('Registered'), findsOneWidget);
    expect(_rowValue('ติดตั้งเมื่อ', '-'), findsOneWidget);
  });

  testWidgets('404 -> "ไม่พบอุปกรณ์นี้" + ปุ่มลองอีกครั้ง', (tester) async {
    await _pump(
      tester,
      repo: _FakeDeviceSearchRepository(
        getError: ApiException('not found', statusCode: 404),
      ),
    );

    expect(find.byKey(const Key('device_detail_error')), findsOneWidget);
    expect(find.text('ไม่พบอุปกรณ์นี้'), findsOneWidget);
    expect(find.byKey(const Key('device_detail_retry')), findsOneWidget);
  });

  testWidgets(
    'connection error (ไม่มี statusCode) -> ข้อความไทยอ่านได้ ไม่ใช่ raw',
    (tester) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(
          getError: ApiException(
            'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง',
          ),
        ),
      );

      expect(find.byKey(const Key('device_detail_error')), findsOneWidget);
      expect(
        find.text(
          'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง',
        ),
        findsOneWidget,
      );
      expect(find.byKey(const Key('device_detail_retry')), findsOneWidget);
    },
  );

  group('ปุ่ม Override ค่าพารามิเตอร์ (issue #211, ST เท่านั้น)', () {
    testWidgets('role ST -> เห็นปุ่ม', (tester) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        role: UserRole.st,
      );

      expect(
        find.byKey(
          const Key('device_detail_config_override'),
          skipOffstage: false,
        ),
        findsOneWidget,
      );
    });

    testWidgets('role OT -> ไม่เห็นปุ่ม (OT ไม่มีสิทธิ์ override เลย)', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        role: UserRole.ot,
      );

      expect(
        find.byKey(
          const Key('device_detail_config_override'),
          skipOffstage: false,
        ),
        findsNothing,
      );
    });

    testWidgets('role Operation -> ไม่เห็นปุ่ม', (tester) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        role: UserRole.operation,
      );

      expect(
        find.byKey(
          const Key('device_detail_config_override'),
          skipOffstage: false,
        ),
        findsNothing,
      );
    });
  });

  group('ปุ่ม ขอ Firmware Override (issue #256, ST เท่านั้น)', () {
    for (final entry in {
      UserRole.st: true,
      UserRole.ot: false,
      UserRole.operation: false,
    }.entries) {
      testWidgets(
        'role ${entry.key} -> ${entry.value ? 'เห็น' : 'ไม่เห็น'}ปุ่ม',
        (tester) async {
          await _pump(
            tester,
            repo: _FakeDeviceSearchRepository(),
            role: entry.key,
          );

          expect(
            find.byKey(
              const Key('device_detail_firmware_override'),
              skipOffstage: false,
            ),
            entry.value ? findsOneWidget : findsNothing,
          );
        },
      );
    }
  });

  // docs/27 §9 (B3) — โหมด central ส่ง Firmware ผ่านคำขอ ("อัปโหลด" แท็บ Firmware)
  group('โหมด central (applyMode = central)', () {
    testWidgets(
      'ซ่อน Firmware Override และยืนยันติดตั้ง Firmware · ปุ่มอื่นยังอยู่',
      (tester) async {
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          role: UserRole.st,
          centralMode: true,
        );
        await tester.pump();

        expect(
          find.byKey(
            const Key('device_detail_firmware_override'),
            skipOffstage: false,
          ),
          findsNothing,
        );
        expect(
          find.byKey(
            const Key('device_detail_confirm_firmware'),
            skipOffstage: false,
          ),
          findsNothing,
        );
        expect(
          find.byKey(const Key('device_detail_upload'), skipOffstage: false),
          findsOneWidget,
        );
        expect(
          find.byKey(
            const Key('device_detail_config_override'),
            skipOffstage: false,
          ),
          findsOneWidget,
        );
      },
    );

    testWidgets('ไม่ใช่โหมด central -> ปุ่มเดิมอยู่ครบ', (tester) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        role: UserRole.st,
      );
      await tester.pump();

      expect(
        find.byKey(
          const Key('device_detail_confirm_firmware'),
          skipOffstage: false,
        ),
        findsOneWidget,
      );
    });
  });

  // docs/22 §7.2 / §8 (Batch 4) — ปุ่ม Field Report ในหน้า Device Detail สำหรับ ST/OT
  // เปิดฟอร์มพร้อม pre-fill อุปกรณ์ผ่าน `?deviceId=` ที่ route รองรับอยู่แล้ว
  group('ปุ่ม Field Report (docs/22 Batch 4, ST + OT)', () {
    for (final entry in {
      UserRole.st: true,
      UserRole.ot: true,
      UserRole.operation: false,
    }.entries) {
      testWidgets(
        'role ${entry.key} -> ${entry.value ? 'เห็น' : 'ไม่เห็น'}ปุ่ม',
        (tester) async {
          await _pump(
            tester,
            repo: _FakeDeviceSearchRepository(),
            role: entry.key,
          );

          expect(
            find.byKey(const Key('device_detail_field_report')),
            entry.value ? findsOneWidget : findsNothing,
          );
        },
      );
    }

    testWidgets('แตะแล้วเปิดฟอร์มพร้อม deviceId ของเครื่องนี้', (tester) async {
      String? openedDeviceId;
      final router = GoRouter(
        initialLocation: AppRoutes.deviceDetail('DEV-0117'),
        routes: [
          GoRoute(
            path: AppRoutes.deviceDetailPattern,
            builder: (_, state) =>
                DeviceDetailPage(deviceId: state.pathParameters['deviceId']!),
          ),
          GoRoute(
            path: AppRoutes.incidentReport,
            builder: (_, state) {
              openedDeviceId = state.uri.queryParameters['deviceId'];
              return const Text('FIELD_REPORT_PAGE');
            },
          ),
        ],
      );
      addTearDown(router.dispose);
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        role: UserRole.ot,
        router: router,
      );

      await tester.tap(find.byKey(const Key('device_detail_field_report')));
      await tester.pumpAndSettle();

      expect(find.text('FIELD_REPORT_PAGE'), findsOneWidget);
      expect(openedDeviceId, 'DEV-0117');
    });

    testWidgets('โหลดเครื่องไม่สำเร็จ -> ไม่มีปุ่มใดๆ บนหัวหน้าจอ', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(
          getError: ApiException('not found', statusCode: 404),
        ),
        role: UserRole.st,
      );

      expect(find.byKey(const Key('app_page_header_actions')), findsNothing);
    });
  });

  group('ปุ่ม ยืนยันติดตั้ง Firmware (issue #261, ST + OT)', () {
    for (final entry in {
      UserRole.st: true,
      UserRole.ot: true,
      UserRole.operation: false,
    }.entries) {
      testWidgets(
        'role ${entry.key} -> ${entry.value ? 'เห็น' : 'ไม่เห็น'}ปุ่ม',
        (tester) async {
          await _pump(
            tester,
            repo: _FakeDeviceSearchRepository(),
            role: entry.key,
          );

          expect(
            find.byKey(
              const Key('device_detail_confirm_firmware'),
              skipOffstage: false,
            ),
            entry.value ? findsOneWidget : findsNothing,
          );
        },
      );
    }
  });
}

void _statusTests() {
  group('สถานะ Config / Firmware (GET /devices/{deviceId}/status)', () {
    testWidgets(
      'pendingFirmwareOverride ไม่ null -> เห็น banner รอ Operation อนุมัติ + เหตุผล',
      (tester) async {
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          statusRepo: _FakeDeviceStatusRepository(
            status: _makeStatus(
              pendingFirmwareOverride: const DeviceFirmwareOverride(
                id: 'fo-1',
                deviceId: 'DEV-0117',
                firmwareId: 'fw-1',
                versionNumber: 1,
                reason: 'ลูกค้าขอใช้รุ่นนี้',
                status: 'pending',
                overriddenBy: 'st-1',
                overriddenAt: '2026-10-06T00:00:00.000Z',
              ),
            ),
          ),
        );
        await tester.pump();

        expect(
          find.byKey(
            const Key('firmware_override_pending_banner'),
            skipOffstage: false,
          ),
          findsOneWidget,
        );
        expect(
          find.text('เหตุผล: ลูกค้าขอใช้รุ่นนี้', skipOffstage: false),
          findsOneWidget,
        );
      },
    );

    testWidgets('pendingFirmwareOverride เป็น null -> ไม่เห็น banner', (
      tester,
    ) async {
      await _pump(tester, repo: _FakeDeviceSearchRepository());
      await tester.pump();

      expect(
        find.byKey(
          const Key('firmware_override_pending_banner'),
          skipOffstage: false,
        ),
        findsNothing,
      );
    });

    testWidgets('เรียก getDeviceStatus ด้วย deviceId ของหน้า', (tester) async {
      final statusRepo = _FakeDeviceStatusRepository();
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        statusRepo: statusRepo,
      );
      await tester.pump();

      expect(statusRepo.calls, ['DEV-0117']);
    });

    for (final (status, label) in [
      (DevicePayloadStatus.upToDate, 'เป็นปัจจุบัน'),
      (DevicePayloadStatus.failed, 'ล้มเหลว'),
      (DevicePayloadStatus.pending, 'รอรับ Config'),
      (DevicePayloadStatus.unknown, 'ยังไม่เคยอยู่ใน Rollout'),
    ]) {
      testWidgets('configStatus ${status.wireName} -> "$label"', (
        tester,
      ) async {
        // firmware ตั้งต่างจาก config เพื่อให้ตรวจ label ของ config แยกได้
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          statusRepo: _FakeDeviceStatusRepository(
            status: _makeStatus(
              config: status,
              firmware: status == DevicePayloadStatus.failed
                  ? DevicePayloadStatus.upToDate
                  : DevicePayloadStatus.failed,
            ),
          ),
        );
        await tester.pump();

        expect(find.text('สถานะ Config'), findsOneWidget);
        expect(find.text('สถานะ Firmware'), findsOneWidget);
        expect(find.text(label), findsWidgets);
      });
    }

    testWidgets('config และ firmware แสดงแยกกันถูกแถว', (tester) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        statusRepo: _FakeDeviceStatusRepository(
          status: _makeStatus(
            config: DevicePayloadStatus.failed,
            firmware: DevicePayloadStatus.pending,
          ),
        ),
      );
      await tester.pump();

      expect(_rowValue('สถานะ Config', 'ล้มเหลว'), findsOneWidget);
      expect(_rowValue('สถานะ Firmware', 'รอติดตั้ง Firmware'), findsOneWidget);
    });

    testWidgets('มี lastCheckInMessage -> แสดงข้อความ', (tester) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        statusRepo: _FakeDeviceStatusRepository(
          status: _makeStatus(message: 'เช็คอินเมื่อสักครู่'),
        ),
      );
      await tester.pump();

      expect(find.text('เช็คอินเมื่อสักครู่'), findsOneWidget);
    });

    testWidgets('lastCheckInMessage เป็น null -> แสดง "-"', (tester) async {
      await _pump(tester, repo: _FakeDeviceSearchRepository());
      await tester.pump();

      expect(find.text('เช็คอินล่าสุด'), findsOneWidget);
      expect(_rowValue('เช็คอินล่าสุด', '-'), findsOneWidget);
    });

    testWidgets('ออนไลน์/ออฟไลน์ เป็น "ไม่ทราบ" คงที่ (placeholder)', (
      tester,
    ) async {
      // แม้ status อื่นๆ จะเป็นค่าที่รู้ ช่อง online/offline ยังเป็น "ไม่ทราบ"
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        statusRepo: _FakeDeviceStatusRepository(
          status: _makeStatus(
            config: DevicePayloadStatus.upToDate,
            firmware: DevicePayloadStatus.upToDate,
            message: 'ok',
          ),
        ),
      );
      await tester.pump();

      expect(find.text('ออนไลน์/ออฟไลน์'), findsOneWidget);
      expect(find.text('ไม่ทราบ'), findsOneWidget);
    });

    testWidgets('กำลังโหลด -> แสดง loading ของ status แต่ device ยังแสดง', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        statusRepo: _NeverCompletesStatusRepository(),
      );
      await tester.pump();

      expect(find.byKey(const Key('device_status_loading')), findsOneWidget);
      expect(find.text('DEV-0117'), findsOneWidget);
    });

    for (final (error, expected) in [
      (ApiException('x', statusCode: 404), 'ไม่พบสถานะอุปกรณ์นี้'),
      (ApiException('x', statusCode: 403), 'ไม่มีสิทธิ์ดูสถานะอุปกรณ์นี้'),
      (
        ApiException('เซิร์ฟเวอร์ขัดข้อง', statusCode: 500),
        'เซิร์ฟเวอร์ขัดข้อง',
      ),
      (Exception('boom'), 'โหลดสถานะอุปกรณ์ไม่สำเร็จ'),
    ]) {
      testWidgets('error $error -> "$expected" และ device record ยังแสดงอยู่', (
        tester,
      ) async {
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          statusRepo: _FakeDeviceStatusRepository(error: error),
        );
        await tester.pump();

        expect(find.text(expected), findsOneWidget);
        expect(find.byKey(const Key('device_status_retry')), findsOneWidget);
        // status ล้มเหลวต้องไม่บังข้อมูลอุปกรณ์
        expect(find.text('0812345678'), findsOneWidget);
      });
    }

    testWidgets('ปุ่มลองอีกครั้ง -> โหลดซ้ำแล้วแสดงสถานะ', (tester) async {
      final statusRepo = _FakeDeviceStatusRepository(
        error: ApiException('ล่ม', statusCode: 500),
      );
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        statusRepo: statusRepo,
      );
      await tester.pump();
      expect(find.text('ล่ม'), findsOneWidget);

      statusRepo.error = null;
      await tester.tap(find.byKey(const Key('device_status_retry')));
      await tester.pump();
      await tester.pump();

      expect(statusRepo.calls.length, 2);
      expect(find.text('สถานะ Config'), findsOneWidget);
      expect(find.byKey(const Key('device_status_error')), findsNothing);
    });
  });
}

const _pendingBanner = Key('device_detail_config_override_pending');

/// UX audit #2 — ส่งคำขอ Config Override แล้วย้อนกลับมา หน้าอุปกรณ์ต้องบอกว่า
/// มีคำขอรอ Operation อนุมัติอยู่ (เดิมไม่มีอะไรบอกเลย)
void _pendingConfigOverrideTests() {
  group('คำขอ Config Override ที่รออนุมัติ (UX audit #2)', () {
    testWidgets(
      'ST + มีคำขอ pending -> แสดง banner พร้อม field ที่ขอแก้และเหตุผล',
      (tester) async {
        final overrideRepo = _FakeConfigOverrideRepository()
          ..pending = _pendingOverride();
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          role: UserRole.st,
          overrideRepo: overrideRepo,
        );
        await tester.pump();

        expect(find.byKey(_pendingBanner), findsOneWidget);
        expect(
          find.descendant(
            of: find.byKey(_pendingBanner),
            matching: find.textContaining('REPORT_INTERVAL_MOVING'),
          ),
          findsOneWidget,
        );
        // ไม่แสดงค่า (field อาจเป็น sensitive — banner ไม่รู้ definition)
        expect(
          find.descendant(
            of: find.byKey(_pendingBanner),
            matching: find.textContaining('60'),
          ),
          findsNothing,
        );
        expect(
          find.descendant(
            of: find.byKey(_pendingBanner),
            matching: find.textContaining('ลูกค้าขอปรับรอบส่งพิกัด'),
          ),
          findsOneWidget,
        );
      },
    );

    testWidgets('ST + ไม่มีคำขอ pending -> ไม่มี banner', (tester) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        role: UserRole.st,
        overrideRepo: _FakeConfigOverrideRepository(),
      );
      await tester.pump();

      expect(find.byKey(_pendingBanner), findsNothing);
      expect(find.text('DEV-0117'), findsOneWidget);
    });

    testWidgets(
      'โหลด Config ไม่สำเร็จ (เช่น 404 เครื่องยังไม่มี Config) -> ไม่มี banner '
      'และไม่ขึ้น error ทับหน้า',
      (tester) async {
        final overrideRepo = _FakeConfigOverrideRepository()
          ..error = ApiException('ไม่พบ Config', statusCode: 404);
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          role: UserRole.st,
          overrideRepo: overrideRepo,
        );
        await tester.pump();

        expect(find.byKey(_pendingBanner), findsNothing);
        expect(find.text('ไม่พบ Config'), findsNothing);
        expect(find.text('DEV-0117'), findsOneWidget);
      },
    );

    testWidgets('role อื่น (ขอ override ไม่ได้) -> ไม่เรียก API นี้เลย', (
      tester,
    ) async {
      final overrideRepo = _FakeConfigOverrideRepository()
        ..pending = _pendingOverride();
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        role: UserRole.operation,
        overrideRepo: overrideRepo,
      );
      await tester.pump();

      expect(overrideRepo.getCalls, 0);
      expect(find.byKey(_pendingBanner), findsNothing);
    });

    testWidgets(
      'ไปหน้า Override ส่งคำขอแล้วย้อนกลับมา -> โหลดใหม่และเห็น banner ทันที',
      (tester) async {
        final overrideRepo = _FakeConfigOverrideRepository();
        final router = GoRouter(
          initialLocation: AppRoutes.deviceDetail('DEV-0117'),
          routes: [
            GoRoute(
              path: AppRoutes.deviceDetailPattern,
              builder: (_, state) =>
                  DeviceDetailPage(deviceId: state.pathParameters['deviceId']!),
            ),
            GoRoute(
              path: AppRoutes.deviceConfigOverridePattern,
              builder: (_, _) => const Text('OVERRIDE_PAGE'),
            ),
          ],
        );
        addTearDown(router.dispose);
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          role: UserRole.st,
          overrideRepo: overrideRepo,
          router: router,
        );
        await tester.pump();
        expect(find.byKey(_pendingBanner), findsNothing);

        await tester.tap(
          find.byKey(const Key('device_detail_config_override')),
        );
        await tester.pumpAndSettle();
        expect(find.text('OVERRIDE_PAGE'), findsOneWidget);

        // ระหว่างอยู่หน้า Override: ส่งคำขอสำเร็จ -> backend มีคำขอ pending
        overrideRepo.pending = _pendingOverride();
        router.pop();
        await tester.pumpAndSettle();

        expect(find.byKey(_pendingBanner), findsOneWidget);
      },
    );
  });

  group('docs/28 — อัปโหลด / เริ่มงาน (ST + OT)', () {
    GoRouter routerWith(void Function(String path) onOpen) => GoRouter(
      initialLocation: AppRoutes.deviceDetail('DEV-0117'),
      routes: [
        GoRoute(
          path: AppRoutes.deviceDetailPattern,
          builder: (_, state) =>
              DeviceDetailPage(deviceId: state.pathParameters['deviceId']!),
        ),
        GoRoute(
          path: AppRoutes.deviceApplyPattern,
          builder: (_, state) {
            onOpen(state.uri.toString());
            return const Text('APPLY_PAGE');
          },
        ),
        GoRoute(
          path: AppRoutes.taskDetailPattern,
          builder: (_, state) {
            onOpen(state.uri.toString());
            return const Text('TASK_PAGE');
          },
        ),
      ],
    );

    for (final role in [UserRole.st, UserRole.ot]) {
      testWidgets('role $role -> เห็นปุ่มอัปโหลด (ปุ่มหลัก) และเริ่มงาน', (
        tester,
      ) async {
        await _pump(tester, repo: _FakeDeviceSearchRepository(), role: role);

        expect(find.byKey(const Key('device_detail_upload')), findsOneWidget);
        expect(
          find.byKey(const Key('device_detail_start_task')),
          findsOneWidget,
        );
        expect(find.text('เริ่มงาน'), findsOneWidget);
      });
    }

    testWidgets('Operation -> ไม่เห็นปุ่มอัปโหลด/เริ่มงาน', (tester) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        role: UserRole.operation,
      );

      expect(find.byKey(const Key('device_detail_upload')), findsNothing);
      expect(find.byKey(const Key('device_detail_start_task')), findsNothing);
    });

    testWidgets(
      'แตะอัปโหลด -> เปิดหน้าเลือก Config ของเครื่องนี้ (ไม่มี taskId)',
      (tester) async {
        String? opened;
        final router = routerWith((path) => opened = path);
        addTearDown(router.dispose);
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          role: UserRole.st,
          router: router,
        );

        await tester.tap(find.byKey(const Key('device_detail_upload')));
        await tester.pumpAndSettle();

        expect(find.text('APPLY_PAGE'), findsOneWidget);
        expect(opened, '/devices/DEV-0117/apply');
      },
    );

    testWidgets('แตะเริ่มงาน -> POST /tasks/start แล้วไปหน้างานที่ได้', (
      tester,
    ) async {
      String? opened;
      final router = routerWith((path) => opened = path);
      addTearDown(router.dispose);
      final fieldTasks = FakeFieldTaskRepository();
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        role: UserRole.st,
        router: router,
        fieldTaskRepo: fieldTasks,
      );

      await tester.tap(find.byKey(const Key('device_detail_start_task')));
      await tester.pumpAndSettle();

      expect(fieldTasks.startCalls, 1);
      expect(fieldTasks.lastDeviceId, 'DEV-0117');
      expect(find.text('TASK_PAGE'), findsOneWidget);
      expect(opened, '/tasks/t-new');
    });

    testWidgets(
      'เริ่มงานไม่สำเร็จ -> snackbar ข้อความของ backend อยู่หน้าเดิม',
      (tester) async {
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          role: UserRole.st,
          fieldTaskRepo: FakeFieldTaskRepository(
            error: ApiException(
              'เครื่อง DEV-0117 ปลดระวางแล้ว',
              statusCode: 409,
            ),
          ),
        );

        await tester.tap(find.byKey(const Key('device_detail_start_task')));
        await tester.pump();

        expect(
          find.text('เริ่มงานไม่สำเร็จ: เครื่อง DEV-0117 ปลดระวางแล้ว'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'มีงานเปิดอยู่แล้ว -> ปุ่มเป็น "ไปที่งาน" แตะแล้วไปงานนั้นโดยไม่เรียก start',
      (tester) async {
        String? opened;
        final router = routerWith((path) => opened = path);
        addTearDown(router.dispose);
        final fieldTasks = FakeFieldTaskRepository();
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          role: UserRole.st,
          router: router,
          fieldTaskRepo: fieldTasks,
          openTask: Task(
            id: 't-open',
            title: 'งานเดิม',
            assignedTo: 'tech-1',
            status: TaskStatus.inProgress,
            createdAt: DateTime.utc(2026, 10, 26),
            updatedAt: DateTime.utc(2026, 10, 26),
            deviceId: 'DEV-0117',
          ),
        );
        await tester.pump();

        expect(find.text('ไปที่งาน'), findsOneWidget);
        await tester.tap(find.byKey(const Key('device_detail_start_task')));
        await tester.pumpAndSettle();

        expect(fieldTasks.startCalls, 0);
        expect(opened, '/tasks/t-open');
      },
    );
  });
}
