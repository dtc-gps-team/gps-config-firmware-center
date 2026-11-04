import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/ui/app_badge.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/ui/app_info_row.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/config_override/config_override_repository.dart';
import 'package:mobile/features/device_search/device_history_repository.dart';
import 'package:mobile/features/task/config_apply_request_repository.dart';
import 'package:mobile/features/device_search/device_detail_page.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';
import 'package:mobile/features/device_search/device_central_repository.dart';
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
  String? reportedFirmwareVersion,
}) => Device(
  id: 'uuid-1',
  deviceId: 'DEV-0117',
  simNumber: '0812345678',
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: status,
  registeredAt: DateTime(2026, 6, 1, 9),
  installedAt: installedAt ?? DateTime(2026, 6, 3, 14, 30),
  reportedFirmwareVersion: reportedFirmwareVersion,
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
    String? configId,
  }) => throw UnimplementedError();
}

DeviceStatus _makeStatus({
  DevicePayloadStatus config = DevicePayloadStatus.unknown,
  DevicePayloadStatus firmware = DevicePayloadStatus.unknown,
  String? message,
  DeviceFirmwareOverride? pendingFirmwareOverride,
  DateTime? lastSeenAt,
  bool online = false,
}) => DeviceStatus(
  deviceId: 'DEV-0117',
  configStatus: config,
  firmwareStatus: firmware,
  lastCheckInMessage: message,
  pendingFirmwareOverride: pendingFirmwareOverride,
  lastSeenAt: lastSeenAt,
  online: online,
);

/// `GET /devices/{id}/central` ปลอม — [central] `null` = โหลดไม่สำเร็จ (throw)
class _FakeCentralRepository implements DeviceCentralRepository {
  _FakeCentralRepository([this.central]);

  final DeviceCentral? central;

  @override
  Future<DeviceCentral> getDeviceCentral(String deviceId) async {
    if (central == null) throw ApiException('Server กลางล่ม', statusCode: 500);
    return central!;
  }
}

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
  DeviceCentralRepository? centralRepo,
  DeviceHistoryResult? history,
  DeviceApplyOptions? applyOptions,
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
        deviceCentralRepositoryProvider.overrideWithValue(
          centralRepo ??
              _FakeCentralRepository(const DeviceCentral(reachable: false)),
        ),
        // R4-04 — การ์ดสถานะเครื่องใช้ summary ของประวัติ · คำขอค้างจาก apply-options
        deviceHistoryProvider.overrideWith(
          (ref, _) async => history ?? const DeviceHistoryResult(items: []),
        ),
        deviceApplyOptionsProvider.overrideWith(
          (ref, id) async =>
              applyOptions ??
              DeviceApplyOptions(
                deviceId: id,
                deviceInstalled: true,
                configs: const [],
              ),
        ),
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
/// ค่าของแถวหรือช่องสี่เหลี่ยมในการ์ดสถานะ (`_StatusTile` เป็น private จึงเทียบชื่อชนิด)
Finder _rowValue(String label, String value) => find.descendant(
  of: find
      .ancestor(
        of: find.text(label),
        matching: find.byWidgetPredicate(
          (w) => w is AppInfoRow || w.runtimeType.toString() == '_StatusTile',
        ),
      )
      .first,
  matching: find.text(value),
);

/// สถานะเครื่อง (ติดตั้งแล้ว ฯลฯ) เป็นป้ายที่หัวการ์ดตาม mockup
Finder _lifecycle(String value) => find.descendant(
  of: find.byKey(const Key('device_detail_lifecycle')),
  matching: find.text(value),
);

void main() {
  _statusTests();
  _pendingConfigOverrideTests();
  _r4Tests();

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
            installedAt: DateTime(2026, 6, 3, 14, 30),
            imei: '860000000000117',
            serialNumber: 'SNGT06N000117',
            blackboxId: '7100000117',
            hardwareRevisionCode: 'RevA',
            bootloader: 'BL-2.1',
            customer: const Customer(id: 'c1', companyName: 'ขนส่งสมมติ จำกัด'),
          ),
        ),
      );

      expect(find.text('ข้อมูลอุปกรณ์'), findsOneWidget);
      expect(find.text('ลูกค้า'), findsOneWidget);
      expect(_rowValue('รุ่น', 'GT06N'), findsOneWidget);
      expect(_rowValue('เบอร์ซิม', '0812345678'), findsOneWidget);
      expect(_rowValue('ติดตั้งเมื่อ', '03/06/2026 14:30'), findsOneWidget);
      expect(find.text('IMEI'), findsNothing);
      await tester.tap(find.byKey(const Key('device_detail_info_expand')));
      await tester.pump();
      expect(_rowValue('IMEI', '860000000000117'), findsOneWidget);
      expect(_rowValue('Serial Number', 'SNGT06N000117'), findsOneWidget);
      expect(_rowValue('Blackbox ID', '7100000117'), findsOneWidget);
      expect(_rowValue('Hardware revision', 'RevA'), findsOneWidget);
      expect(_rowValue('Bootloader', 'BL-2.1'), findsOneWidget);
      expect(_rowValue('ลูกค้า', 'ขนส่งสมมติ จำกัด'), findsOneWidget);
    });

    testWidgets('เป็น null ทั้งหมด -> แสดง "-" ทุกแถว ไม่ซ่อนแถว ไม่ crash', (
      tester,
    ) async {
      await _pump(tester, repo: _FakeDeviceSearchRepository());

      expect(tester.takeException(), isNull);
      expect(find.text('IMEI'), findsNothing);
      await tester.tap(find.byKey(const Key('device_detail_info_expand')));
      await tester.pump();
      expect(
        _rowValue(
          'ยังไม่มีข้อมูล',
          'IMEI, Serial Number, Blackbox ID, Hardware revision, Bootloader',
        ),
        findsOneWidget,
      );
      expect(_rowValue('ลูกค้า', '-'), findsOneWidget);
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
    expect(find.text('TCP'), findsNothing);
    await tester.tap(find.byKey(const Key('device_detail_info_expand')));
    await tester.pump();
    expect(find.text('TCP'), findsOneWidget);
    // R4-04 — สถานะเครื่องเป็นคำไทยในการ์ด "สถานะเครื่อง" (ภาพ r4)
    expect(_lifecycle('ติดตั้งแล้ว'), findsOneWidget);
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
    expect(_lifecycle('ลงทะเบียนแล้ว ยังไม่ติดตั้ง'), findsOneWidget);
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

        expect(find.text('Config ปัจจุบัน'), findsOneWidget);
        expect(find.text('Firmware'), findsOneWidget);
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

      expect(_rowValue('Config ปัจจุบัน', 'ล้มเหลว'), findsOneWidget);
      expect(_rowValue('Firmware', 'รอติดตั้ง Firmware'), findsOneWidget);
    });

    // issue #386 ข้อ 5 — ออนไลน์จาก Server กลางก่อน ไม่งั้นจาก /status
    /// สีของป้ายในแถว "การเชื่อมต่อ"
    AppBadgeTone onlineTone(WidgetTester tester) => tester
        .widget<AppBadge>(find.byKey(const Key('device_online_row')))
        .tone;

    group('การเชื่อมต่อ (ออนไลน์/ออฟไลน์)', () {
      testWidgets(
        'ไม่เคยติดต่อ + Server กลางไม่รู้จัก -> "ไม่ทราบ" (ไม่บอกว่าออฟไลน์)',
        (tester) async {
          await _pump(tester, repo: _FakeDeviceSearchRepository());
          await tester.pump();

          expect(
            find.descendant(
              of: find.byKey(const Key('device_online_row')),
              matching: find.text('ไม่ทราบ'),
            ),
            findsOneWidget,
          );
          // ไม่เคยติดต่อ = ไม่มีบรรทัดเวลา
          expect(
            find.byKey(const Key('device_detail_last_seen')),
            findsNothing,
          );
          expect(find.text('Firmware ในกล่อง'), findsNothing);
          expect(onlineTone(tester), AppBadgeTone.neutral);
        },
      );

      testWidgets('/status ออนไลน์ -> "ออนไลน์" + เวลาติดต่อล่าสุด', (
        tester,
      ) async {
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          statusRepo: _FakeDeviceStatusRepository(
            status: _makeStatus(
              online: true,
              lastSeenAt: DateTime(2026, 10, 26, 17, 2),
            ),
          ),
        );
        await tester.pump();

        expect(
          find.descendant(
            of: find.byKey(const Key('device_online_row')),
            matching: find.text('ออนไลน์'),
          ),
          findsOneWidget,
        );
        // เกิน 1 วันแสดงวันเวลาจริง
        expect(find.text('ติดต่อเมื่อ 26/10 17:02'), findsOneWidget);
        expect(onlineTone(tester), AppBadgeTone.success);
        expect(
          find.descendant(
            of: find.byKey(const Key('device_detail_status_card')),
            matching: find.text('ออนไลน์'),
          ),
          findsOneWidget,
        );
      });

      testWidgets('/status เคยติดต่อแต่เกิน 5 นาที -> "ออฟไลน์"', (
        tester,
      ) async {
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          statusRepo: _FakeDeviceStatusRepository(
            status: _makeStatus(lastSeenAt: DateTime(2026, 10, 20, 9)),
          ),
        );
        await tester.pump();

        expect(
          find.descendant(
            of: find.byKey(const Key('device_online_row')),
            matching: find.text('ออฟไลน์'),
          ),
          findsOneWidget,
        );
        expect(onlineTone(tester), AppBadgeTone.danger);
      });

      testWidgets(
        'กล่องโหมด central -> ใช้ค่าจาก Server กลาง แม้ /status บอกไม่เคยติดต่อ + แสดงเวอร์ชันที่กล่องรายงาน',
        (tester) async {
          await _pump(
            tester,
            repo: _FakeDeviceSearchRepository(),
            centralRepo: _FakeCentralRepository(
              DeviceCentral(
                reachable: true,
                device: CentralDeviceInfo(
                  online: true,
                  lastSeenAt: DateTime(2026, 10, 26, 17, 7),
                  reportedFirmwareVersion: '1.2.0',
                  reportedConfigVersion: 12,
                ),
              ),
            ),
          );
          await tester.pump();

          expect(
            find.descendant(
              of: find.byKey(const Key('device_online_row')),
              matching: find.text('ออนไลน์'),
            ),
            findsOneWidget,
          );
          expect(find.text('ติดต่อเมื่อ 26/10 17:07'), findsOneWidget);
          expect(_rowValue('Firmware', '1.2.0'), findsOneWidget);
          expect(
            _rowValue('Config ปัจจุบัน', 'ในกล่องเป็นรุ่นที่ 12'),
            findsOneWidget,
          );
        },
      );

      testWidgets('โหลดจาก Server กลางไม่สำเร็จ -> ใช้ /status ไม่แสดง error', (
        tester,
      ) async {
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          statusRepo: _FakeDeviceStatusRepository(
            status: _makeStatus(
              online: true,
              lastSeenAt: DateTime(2026, 10, 26, 17, 2),
            ),
          ),
          centralRepo: _FakeCentralRepository(),
        );
        await tester.pump();

        expect(onlineTone(tester), AppBadgeTone.success);
        expect(find.byKey(const Key('device_status_error')), findsNothing);
      });
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
      expect(find.text('Config ปัจจุบัน'), findsOneWidget);
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
      'มีงานเปิดอยู่แล้ว -> ปุ่มเป็น "รายละเอียดงาน" แตะแล้วไปงานนั้นโดยไม่เรียก start',
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

        expect(find.text('รายละเอียดงาน'), findsOneWidget);
        await tester.tap(find.byKey(const Key('device_detail_start_task')));
        await tester.pumpAndSettle();

        expect(fieldTasks.startCalls, 0);
        expect(opened, '/tasks/t-open');
      },
    );
  });
}

/// R4-04 (docs/29 · ภาพ r4 0175–0264) — การ์ดสถานะเครื่อง คำเตือน ปุ่มตามสิทธิ์ และทางลัด
void _r4Tests() {
  group('R4-04 หน้าอุปกรณ์ตามภาพ r4', () {
    Finder card(String label, String value) => find.descendant(
      of: find.byKey(const Key('device_detail_status_card')),
      matching: _rowValue(label, value),
    );

    GoRouter routerWith(String pattern, void Function(GoRouterState) onOpen) {
      final router = GoRouter(
        initialLocation: AppRoutes.deviceDetail('DEV-0117'),
        routes: [
          GoRoute(
            path: AppRoutes.deviceDetailPattern,
            builder: (_, state) =>
                DeviceDetailPage(deviceId: state.pathParameters['deviceId']!),
          ),
          GoRoute(
            path: pattern,
            builder: (_, state) {
              onOpen(state);
              return const Text('NEXT_PAGE');
            },
          ),
        ],
      );
      addTearDown(router.dispose);
      return router;
    }

    testWidgets('หัวพื้นเข้มบอกเลขเครื่อง รุ่น และซิม', (tester) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        role: UserRole.st,
      );
      await tester.pump();
      final header = find.byKey(const Key('app_ink_header'));
      expect(
        find.descendant(of: header, matching: find.text('DEV-0117')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: header,
          matching: find.text('GT06N · ซิม 0812345678'),
        ),
        findsOneWidget,
      );
    });

    testWidgets(
      'Config ปัจจุบันจาก summary ของประวัติ · Firmware ใช้ค่าที่กล่องรายงานก่อน',
      (tester) async {
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          role: UserRole.st,
          history: const DeviceHistoryResult(
            items: [],
            currentConfigName: 'ส่งพิกัดทุก 15 วินาที',
            currentFirmwareVersion: '1.1.0',
          ),
          centralRepo: _FakeCentralRepository(
            const DeviceCentral(
              reachable: true,
              device: CentralDeviceInfo(
                online: true,
                reportedFirmwareVersion: '1.2.0',
              ),
            ),
          ),
        );
        await tester.pump();
        expect(
          card('Config ปัจจุบัน', 'ส่งพิกัดทุก 15 วินาที'),
          findsOneWidget,
        );
        expect(card('Firmware', '1.2.0'), findsOneWidget);
        expect(
          find.descendant(
            of: find.byKey(const Key('device_online_row')),
            matching: find.text('ออนไลน์'),
          ),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'Server กลางไม่รู้จัก -> Firmware จาก summary · ไม่มี Config -> —',
      (tester) async {
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(
            device: _makeDevice(reportedFirmwareVersion: '1.1.0'),
          ),
          role: UserRole.st,
          history: const DeviceHistoryResult(
            items: [],
            currentFirmwareVersion: '0.9.9',
          ),
        );
        await tester.pump();
        expect(card('Firmware', '1.1.0'), findsOneWidget);
        expect(card('Config ปัจจุบัน', '—'), findsOneWidget);
      },
    );

    testWidgets(
      'ไม่มีค่าที่กล่องรายงานเลย -> Firmware จาก summary ของประวัติ',
      (tester) async {
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          role: UserRole.st,
          history: const DeviceHistoryResult(
            items: [],
            currentFirmwareVersion: '0.9.9',
          ),
        );
        await tester.pump();
        expect(card('Firmware', '0.9.9'), findsOneWidget);
      },
    );

    testWidgets(
      '/status โหลดไม่สำเร็จ -> ชื่อ Config/Firmware ยังแสดง ซ่อนแค่ป้ายสถานะ',
      (tester) async {
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          role: UserRole.st,
          statusRepo: _FakeDeviceStatusRepository(error: Exception('boom')),
          history: const DeviceHistoryResult(
            items: [],
            currentConfigName: 'ส่งพิกัดทุก 15 วินาที',
            currentFirmwareVersion: '1.2.1',
          ),
        );
        await tester.pump();
        expect(
          card('Config ปัจจุบัน', 'ส่งพิกัดทุก 15 วินาที'),
          findsOneWidget,
        );
        expect(card('Firmware', '1.2.1'), findsOneWidget);
        expect(find.byKey(const Key('device_status_retry')), findsOneWidget);
      },
    );

    testWidgets('เครื่องยังไม่ติดตั้ง -> เตือน และปุ่มส่งค่า/แก้ค่ากดไม่ได้', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(
          device: _makeDevice(status: DeviceLifecycleStatus.registered),
        ),
        role: UserRole.st,
      );
      await tester.pump();
      expect(
        find.byKey(const Key('device_detail_not_installed')),
        findsOneWidget,
      );
      final upload = tester.widget<FilledButton>(
        find.descendant(
          of: find.byKey(const Key('device_detail_upload')),
          matching: find.byType(FilledButton),
        ),
      );
      final override = tester.widget<OutlinedButton>(
        find.descendant(
          of: find.byKey(const Key('device_detail_config_override')),
          matching: find.byType(OutlinedButton),
        ),
      );
      expect(upload.onPressed, isNull);
      expect(override.onPressed, isNull);
    });

    testWidgets(
      'คำขอค้างในงานของตัวเอง -> แถบเตือนพร้อมปุ่มเปิดคำขอไปหน้างาน',
      (tester) async {
        String? opened;
        final router = routerWith(
          AppRoutes.taskDetailPattern,
          (state) => opened = state.pathParameters['id'],
        );
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          role: UserRole.st,
          router: router,
          applyOptions: const DeviceApplyOptions(
            deviceId: 'DEV-0117',
            deviceInstalled: true,
            configs: [],
            openRequest: ApplyOptionOpenRequest(
              kind: FieldApplyKind.config,
              status: ConfigApplyRequestStatus.pending,
              configName: 'ส่งพิกัดทุก 15 วินาที',
              taskId: 't-mine',
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.textContaining('มีคำขอที่ยังไม่จบ'), findsOneWidget);
        expect(find.textContaining('ในงานของคุณ'), findsOneWidget);
        await tester.tap(
          find.byKey(const Key('device_detail_open_request_go')),
        );
        await tester.pumpAndSettle();
        expect(opened, 't-mine');
      },
    );

    testWidgets(
      'central: คำขอแก้ค่าอยู่ในคำขอส่งเข้ากล่อง -> แถบเดียว พร้อมขอแก้/เหตุผล',
      (tester) async {
        final overrideRepo = _FakeConfigOverrideRepository()
          ..pending = _pendingOverride();
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          role: UserRole.st,
          overrideRepo: overrideRepo,
          applyOptions: const DeviceApplyOptions(
            deviceId: 'DEV-0117',
            deviceInstalled: true,
            configs: [],
            openRequest: ApplyOptionOpenRequest(
              kind: FieldApplyKind.config,
              status: ConfigApplyRequestStatus.pending,
              configName: 'ส่งพิกัดทุก 15 วินาที',
              taskId: 't-mine',
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.byKey(_pendingBanner), findsNothing);
        final notice = find.byKey(const Key('device_detail_open_request'));
        expect(notice, findsOneWidget);
        expect(
          find.descendant(
            of: notice,
            matching: find.textContaining('REPORT_INTERVAL_MOVING'),
          ),
          findsOneWidget,
        );
        expect(
          find.descendant(
            of: notice,
            matching: find.textContaining('ลูกค้าขอปรับรอบส่งพิกัด'),
          ),
          findsOneWidget,
        );
      },
    );

    testWidgets('คำขอค้างของช่างคนอื่น -> บอกให้รอ ไม่มีปุ่มเปิดคำขอ', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        role: UserRole.ot,
        applyOptions: const DeviceApplyOptions(
          deviceId: 'DEV-0117',
          deviceInstalled: true,
          configs: [],
          openRequest: ApplyOptionOpenRequest(
            kind: FieldApplyKind.config,
            status: ConfigApplyRequestStatus.approved,
            configName: 'โหมดประหยัดแบตเตอรี่',
          ),
        ),
      );
      await tester.pump();
      expect(find.textContaining('รอผู้ถืองานกดส่ง'), findsOneWidget);
      expect(find.textContaining('ในงานของช่างคนอื่น'), findsOneWidget);
      expect(
        find.byKey(const Key('device_detail_open_request_go')),
        findsNothing,
      );
    });

    testWidgets(
      'Operation -> ดูอย่างเดียว ไม่มีปุ่มส่งค่า มีทางลัด Incidents/ประวัติ',
      (tester) async {
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          role: UserRole.operation,
        );
        await tester.pump();
        expect(
          find.byKey(const Key('device_detail_view_only')),
          findsOneWidget,
        );
        expect(find.byKey(const Key('device_detail_upload')), findsNothing);
        expect(
          find.byKey(const Key('device_detail_open_request')),
          findsNothing,
        );
        expect(
          find.byKey(const Key('device_detail_incidents')),
          findsOneWidget,
        );
        expect(find.byKey(const Key('device_detail_history')), findsOneWidget);
      },
    );

    testWidgets('ทางลัดประวัติเครื่อง -> หน้าประวัติของเครื่องนี้', (
      tester,
    ) async {
      String? opened;
      final router = routerWith(
        AppRoutes.deviceHistoryPattern,
        (state) => opened = state.pathParameters['deviceId'],
      );
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        role: UserRole.st,
        router: router,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('device_detail_history')));
      await tester.pumpAndSettle();
      expect(opened, 'DEV-0117');
    });
  });
}
