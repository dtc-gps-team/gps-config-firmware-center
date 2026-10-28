import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/config_override/config_override_repository.dart';
import 'package:mobile/features/task/apply_config_params_page.dart';
import 'package:mobile/features/task/apply_config_picker_page.dart';
import 'package:mobile/features/task/config_apply_request_repository.dart';
import 'package:mobile/features/task/field_task_repository.dart';
import 'package:mobile/features/task/task_repository.dart';

import 'support/fake_config_apply_request_repository.dart';
import 'support/fake_field_task_repository.dart';

/// บันทึกคำขอแก้ค่า (Override) จากหน้าเลือก — ใช้แค่ `overrideConfig`
class _FakeOverrideRepository implements ConfigOverrideRepository {
  int calls = 0;
  String? lastDeviceId;
  Map<String, dynamic>? lastFields;
  String? lastReason;
  String? lastConfigId;

  @override
  Future<DeviceConfigOverride> overrideConfig({
    required String deviceId,
    required Map<String, dynamic> fields,
    required String reason,
    String? configId,
  }) async {
    calls++;
    lastDeviceId = deviceId;
    lastFields = fields;
    lastReason = reason;
    lastConfigId = configId;
    return DeviceConfigOverride(
      id: 'ov-1',
      deviceId: deviceId,
      configId: configId ?? 'cfg-1',
      versionNumber: 1,
      fields: fields,
      reason: reason,
      status: 'pending',
      overriddenBy: 'st-1',
      overriddenAt: '2026-10-28T00:00:00.000Z',
    );
  }

  @override
  Future<DeviceConfigDraft> getCurrentConfig(String deviceId) =>
      throw UnimplementedError();

  @override
  Future<List<ConfigFieldDefinition>> listDefinitions() async => const [
    ConfigFieldDefinition(
      id: 'def-interval',
      fieldName: 'gps.send_interval_sec',
      dataType: 'integer',
      allowedValues: [],
      required: false,
      stOverridable: true,
      sensitive: false,
      supportedModels: [],
      description: 'รอบส่ง GPS (วินาที)',
    ),
    ConfigFieldDefinition(
      id: 'def-led',
      fieldName: 'led.enabled',
      dataType: 'boolean',
      allowedValues: [],
      required: false,
      stOverridable: false,
      sensitive: false,
      supportedModels: [],
      description: 'เปิดไฟ LED',
    ),
    ConfigFieldDefinition(
      id: 'def-speed-on',
      fieldName: 'speed_limit.enabled',
      dataType: 'boolean',
      allowedValues: [],
      required: false,
      stOverridable: true,
      sensitive: false,
      supportedModels: [],
      description: 'เปิดตรวจสอบความเร็วเกิน',
    ),
    ConfigFieldDefinition(
      id: 'def-mode',
      fieldName: 'gps.mode',
      dataType: 'string',
      allowedValues: ['normal', 'eco'],
      required: false,
      stOverridable: true,
      sensitive: false,
      supportedModels: [],
      description: 'โหมด GPS',
    ),
  ];
}

/// หน้าเลือก Config (docs/28 §6) — เปิดจากหน้ากล่อง (เริ่มงานให้ก่อน) หรือจาก
/// หน้างาน (`?taskId=`) · แตะ Config แล้วไปหน้าพารามิเตอร์ (docs/27 §2.2) ซึ่ง
/// เทสที่นี่ด้วยกันทั้งเส้นทาง
void main() {
  late FakeConfigApplyRequestRepository applyRepo;
  late FakeFieldTaskRepository fieldTasks;
  late _FakeOverrideRepository overrides;

  setUp(() {
    applyRepo = FakeConfigApplyRequestRepository();
    fieldTasks = FakeFieldTaskRepository();
    overrides = _FakeOverrideRepository();
  });

  /// เส้นทาง: หน้าแรก → หน้าเลือก (push) → หน้าพารามิเตอร์ → หน้างาน ·
  /// [startAt] = path ของหน้าเลือก
  Future<GoRouter> pump(WidgetTester tester, {required String startAt}) async {
    tester.view.physicalSize = const Size(1080, 4000);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    final router = GoRouter(
      initialLocation: '/start',
      routes: [
        GoRoute(
          path: '/start',
          builder: (context, _) => Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () => context.push(startAt),
                child: const Text('OPEN'),
              ),
            ),
          ),
        ),
        GoRoute(
          path: AppRoutes.deviceApplyPattern,
          builder: (_, state) => ApplyConfigPickerPage(
            deviceId: state.pathParameters['deviceId']!,
            taskId: state.uri.queryParameters['taskId'],
            initialKind: FieldApplyKind.fromWire(
              state.uri.queryParameters['kind'],
            ),
          ),
        ),
        GoRoute(
          path: AppRoutes.deviceApplyConfigPattern,
          builder: (_, state) => ApplyConfigParamsPage(
            deviceId: state.pathParameters['deviceId']!,
            configId: state.pathParameters['configId']!,
            taskId: state.uri.queryParameters['taskId'],
          ),
        ),
        GoRoute(
          path: AppRoutes.taskDetailPattern,
          builder: (_, state) => Text('TASK ${state.pathParameters['id']}'),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          configApplyRequestRepositoryProvider.overrideWithValue(applyRepo),
          configOverrideRepositoryProvider.overrideWithValue(overrides),
          fieldTaskRepositoryProvider.overrideWithValue(fieldTasks),
          // ไม่ให้ไปโหลดรายการงานจริง (cache/DB) — หน้านี้แค่ invalidate
          taskListProvider.overrideWith((ref) async => const <Task>[]),
          openTaskForDeviceProvider.overrideWith((ref, _) async => null),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.tap(find.text('OPEN'));
    await tester.pumpAndSettle();
    return router;
  }

  Finder option(String id) => find.byKey(Key('apply_option_$id'));
  final submit = find.byKey(const Key('apply_submit_button'));

  /// แตะ Config ในหน้าเลือก -> หน้าพารามิเตอร์ของตัวนั้น
  Future<void> openParams(WidgetTester tester, String configId) async {
    await tester.tap(option(configId));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'แสดง Config ทุกตัว · ตัวที่ Operation แนะนำมีป้าย · ไม่มีปุ่มส่งบนหน้าเลือก',
    (tester) async {
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));

      expect(option('cfg-1'), findsOneWidget);
      expect(option('cfg-2'), findsOneWidget);
      expect(find.byKey(const Key('apply_option_suggested')), findsOneWidget);
      expect(find.text('เวอร์ชัน 3'), findsOneWidget);
      expect(find.text('ยังไม่มีเวอร์ชันที่บันทึก'), findsOneWidget);
      // พารามิเตอร์/ปุ่มส่งอยู่หน้าถัดไป ไม่อัดในหน้านี้
      expect(submit, findsNothing);
      expect(find.byKey(const Key('apply_params')), findsNothing);
    },
  );

  testWidgets(
    'แตะ Config -> หน้าพารามิเตอร์ของตัวนั้น · ย้อนกลับมาเลือกใหม่ได้',
    (tester) async {
      final router = await pump(
        tester,
        startAt: AppRoutes.deviceApply('DVC-1'),
      );

      await openParams(tester, 'cfg-2');
      expect(find.byType(ApplyConfigParamsPage), findsOneWidget);
      expect(find.text('GT06N ลูกค้าพิเศษ'), findsOneWidget);
      expect(find.text('ส่งเข้ากล่อง'), findsOneWidget);

      router.pop();
      await tester.pumpAndSettle();
      expect(option('cfg-1'), findsOneWidget);
      expect(applyRepo.createCalls, 0);
    },
  );

  testWidgets(
    'เปิดจากหน้ากล่อง ไม่แก้ค่า: เริ่มงาน -> ส่งตรง (direct) -> กดส่งเข้ากล่องให้เลย -> ไปหน้างาน',
    (tester) async {
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));

      await openParams(tester, 'cfg-2');
      expect(find.text('ส่งเข้ากล่อง'), findsOneWidget);
      // ไม่มีอะไรให้ Operation อนุมัติ -> ไม่มีช่องหมายเหตุ/เหตุผล
      expect(find.byKey(const Key('apply_note_field')), findsNothing);
      await tester.tap(submit);
      await tester.pumpAndSettle();

      expect(fieldTasks.startCalls, 1);
      expect(fieldTasks.lastDeviceId, 'DVC-1');
      expect(applyRepo.lastCreateTaskId, 't-new');
      expect(applyRepo.lastCreateConfigId, 'cfg-2');
      expect(applyRepo.lastCreateDirect, isTrue);
      expect(applyRepo.releaseCalls, 1);
      expect(applyRepo.lastReleaseId, 'car-new-1');
      expect(overrides.calls, 0);
      expect(find.text('TASK t-new'), findsOneWidget);
    },
  );

  testWidgets(
    'เปิดจากหน้างาน (?taskId=): ไม่เริ่มงานใหม่ ส่งตรงให้งานนั้นแล้วปิดทั้งสองหน้า',
    (tester) async {
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1', taskId: 't1'));

      await openParams(tester, 'cfg-1');
      await tester.tap(submit);
      await tester.pumpAndSettle();

      expect(fieldTasks.startCalls, 0);
      expect(applyRepo.lastCreateTaskId, 't1');
      expect(applyRepo.lastCreateConfigId, 'cfg-1');
      expect(applyRepo.lastCreateDirect, isTrue);
      expect(applyRepo.releaseCalls, 1);
      expect(find.text('OPEN'), findsOneWidget);
    },
  );

  testWidgets(
    'ส่งตรงแล้วกดส่งเข้ากล่องไม่ผ่าน (กล่องออฟไลน์) -> ยังไปหน้างาน (คำขออนุมัติแล้ว กดส่งใหม่ที่นั่นได้)',
    (tester) async {
      applyRepo.releaseError = ApiException(
        'กล่องออฟไลน์อยู่ ส่งไม่ได้',
        statusCode: 409,
      );
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));

      await openParams(tester, 'cfg-1');
      await tester.tap(submit);
      await tester.pumpAndSettle();

      expect(applyRepo.lastCreateDirect, isTrue);
      expect(applyRepo.releaseCalls, 1);
      // หน้างาน (stub ไม่มี Scaffold ให้แสดง SnackBar) — ไปถึงแม้กดส่งไม่ผ่าน
      expect(find.text('TASK t-new'), findsOneWidget);
    },
  );

  group('หน้าพารามิเตอร์ของ Config', () {
    setUp(() {
      applyRepo.options = fakeApplyOptions(
        configs: const [
          ApplyOptionConfig(
            id: 'cfg-1',
            name: 'BOX ส่งพิกัดทุก 10 วินาที',
            latestVersion: 1,
            suggested: true,
            fields: {'gps.send_interval_sec': 10, 'led.enabled': true},
          ),
        ],
      );
    });

    testWidgets('แสดงทุกค่า · แก้ได้มีช่องกรอก · แก้ไม่ได้บอก (แก้ไขไม่ได้)', (
      tester,
    ) async {
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));
      await openParams(tester, 'cfg-1');

      expect(find.text('รอบส่ง GPS (วินาที)'), findsOneWidget);
      expect(
        find.byKey(const Key('apply_param_gps.send_interval_sec')),
        findsOneWidget,
      );
      final led = find.byKey(const Key('apply_param_row_led.enabled'));
      expect(
        find.descendant(of: led, matching: find.text('(แก้ไขไม่ได้)')),
        findsOneWidget,
      );
      expect(
        // ค่าเปิด/ปิดแสดงเป็นคำ ไม่ใช่ true/false
        find.descendant(of: led, matching: find.text('เปิด')),
        findsOneWidget,
      );
      expect(find.byKey(const Key('apply_param_led.enabled')), findsNothing);
    });

    testWidgets(
      'แก้ค่า -> ต้องกรอกเหตุผล แล้วขออนุมัติผ่าน Override ของ Config ที่เลือก (ไม่ส่งตรง)',
      (tester) async {
        await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));
        await openParams(tester, 'cfg-1');

        await tester.enterText(
          find.byKey(const Key('apply_param_gps.send_interval_sec')),
          '20',
        );
        await tester.pump();
        expect(find.text('ขออนุมัติค่าที่แก้'), findsOneWidget);

        // ไม่กรอกเหตุผล -> ไม่ส่ง
        await tester.tap(submit);
        await tester.pumpAndSettle();
        expect(overrides.calls, 0);
        expect(find.text('กรอกเหตุผลที่แก้ค่า'), findsOneWidget);

        await tester.enterText(
          find.byKey(const Key('apply_reason_field')),
          ' ลูกค้าขอส่งถี่ขึ้น ',
        );
        await tester.tap(submit);
        await tester.pumpAndSettle();

        expect(overrides.calls, 1);
        expect(overrides.lastDeviceId, 'DVC-1');
        expect(overrides.lastConfigId, 'cfg-1');
        expect(overrides.lastFields, {'gps.send_interval_sec': 20});
        expect(overrides.lastReason, 'ลูกค้าขอส่งถี่ขึ้น');
        expect(applyRepo.createCalls, 0);
        expect(find.text('TASK t-new'), findsOneWidget);
      },
    );

    testWidgets('ค่าที่แก้ไม่ถูกชนิด -> บอกที่ช่อง ไม่ส่ง', (tester) async {
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));
      await openParams(tester, 'cfg-1');

      await tester.enterText(
        find.byKey(const Key('apply_param_gps.send_interval_sec')),
        'abc',
      );
      await tester.pump();
      await tester.enterText(
        find.byKey(const Key('apply_reason_field')),
        'ทดสอบ',
      );
      await tester.tap(submit);
      await tester.pumpAndSettle();

      expect(overrides.calls, 0);
      expect(
        find.byKey(const Key('apply_param_error_gps.send_interval_sec')),
        findsOneWidget,
      );
    });

    testWidgets('แก้แล้วแก้กลับเป็นค่าเดิม -> กลับเป็นส่งตรง', (tester) async {
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));
      await openParams(tester, 'cfg-1');

      final input = find.byKey(const Key('apply_param_gps.send_interval_sec'));
      await tester.enterText(input, '20');
      await tester.pump();
      await tester.enterText(input, '10');
      await tester.pump();

      expect(find.text('ส่งเข้ากล่อง'), findsOneWidget);
      expect(find.byKey(const Key('apply_reason_field')), findsNothing);
    });

    testWidgets(
      'ค่าเปิด/ปิดที่แก้ได้ = สวิตช์ (ไม่ต้องพิมพ์) · สลับแล้วขออนุมัติด้วยค่า boolean',
      (tester) async {
        applyRepo.options = fakeApplyOptions(
          configs: const [
            ApplyOptionConfig(
              id: 'cfg-1',
              name: 'BOX จำกัดความเร็ว',
              latestVersion: 1,
              suggested: true,
              fields: {'speed_limit.enabled': true},
            ),
          ],
        );
        await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));
        await openParams(tester, 'cfg-1');

        final toggle = find.byKey(const Key('apply_param_speed_limit.enabled'));
        expect(tester.widget<Switch>(toggle).value, isTrue);
        expect(find.text('เปิด'), findsOneWidget);
        expect(
          find.descendant(of: toggle, matching: find.byType(TextField)),
          findsNothing,
        );

        await tester.tap(toggle);
        await tester.pump();
        expect(find.text('ปิด'), findsOneWidget);
        expect(find.text('ขออนุมัติค่าที่แก้'), findsOneWidget);

        await tester.enterText(
          find.byKey(const Key('apply_reason_field')),
          'ลูกค้าขอปิด',
        );
        await tester.tap(submit);
        await tester.pumpAndSettle();
        expect(overrides.lastFields, {'speed_limit.enabled': false});
      },
    );

    testWidgets('ค่าที่มีตัวเลือกกำหนดไว้ = เลือกจากรายการ', (tester) async {
      applyRepo.options = fakeApplyOptions(
        configs: const [
          ApplyOptionConfig(
            id: 'cfg-1',
            name: 'BOX โหมด GPS',
            latestVersion: 1,
            suggested: true,
            fields: {'gps.mode': 'normal'},
          ),
        ],
      );
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));
      await openParams(tester, 'cfg-1');

      await tester.tap(find.byKey(const Key('apply_param_gps.mode')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('eco').last);
      await tester.pumpAndSettle();

      expect(find.text('ขออนุมัติค่าที่แก้'), findsOneWidget);
    });

    testWidgets('Config ไม่อยู่ในรายการของกล่อง -> บอก ไม่มีปุ่มส่ง', (
      tester,
    ) async {
      await pump(
        tester,
        startAt: AppRoutes.deviceApplyConfig('DVC-1', 'cfg-unknown'),
      );

      expect(find.byKey(const Key('apply_params_not_found')), findsOneWidget);
      expect(submit, findsNothing);
    });
  });

  testWidgets(
    'เริ่มงานได้แต่สร้างคำขอไม่ผ่าน -> แสดงข้อความ backend + ลิงก์ไปที่งาน · กดซ้ำไม่เริ่มงานซ้ำ',
    (tester) async {
      applyRepo.createError = ApiException(
        'เครื่องนี้มีคำขอส่ง Config ที่ยังไม่จบอยู่แล้ว',
        statusCode: 409,
      );
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));

      await openParams(tester, 'cfg-1');
      await tester.tap(submit);
      await tester.pumpAndSettle();

      expect(
        find.text('เครื่องนี้มีคำขอส่ง Config ที่ยังไม่จบอยู่แล้ว'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('apply_go_to_task')), findsOneWidget);

      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(fieldTasks.startCalls, 1);
      expect(applyRepo.createCalls, 2);

      await tester.tap(find.byKey(const Key('apply_go_to_task')));
      await tester.pumpAndSettle();
      expect(find.text('TASK t-new'), findsOneWidget);
    },
  );

  testWidgets('กล่องยังไม่ติดตั้ง -> เตือนทั้งสองหน้าและกดส่งไม่ได้', (
    tester,
  ) async {
    applyRepo.options = fakeApplyOptions(deviceInstalled: false);
    await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));

    expect(find.byKey(const Key('apply_device_not_installed')), findsOneWidget);
    await openParams(tester, 'cfg-1');
    expect(find.byKey(const Key('apply_params_not_installed')), findsOneWidget);
    expect(tester.widget<FilledButton>(submit).onPressed, isNull);
  });

  testWidgets('ไม่มี Config สำหรับรุ่นนี้ -> บอกให้แจ้ง Config Engineer', (
    tester,
  ) async {
    applyRepo.options = fakeApplyOptions(configs: const []);
    await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));

    expect(find.byKey(const Key('apply_options_empty')), findsOneWidget);
    expect(submit, findsNothing);
  });

  testWidgets('โหลดตัวเลือกไม่สำเร็จ -> error + ลองใหม่', (tester) async {
    applyRepo.optionsError = ApiException(
      'ไม่พบเครื่อง DVC-1',
      statusCode: 404,
    );
    await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));

    expect(find.text('ไม่พบเครื่อง DVC-1'), findsOneWidget);
    applyRepo.optionsError = null;
    await tester.tap(find.byKey(const Key('apply_options_retry')));
    await tester.pumpAndSettle();
    expect(option('cfg-1'), findsOneWidget);
  });

  group('แท็บ Firmware (docs/27 B3)', () {
    Finder firmware(String id) => find.byKey(Key('apply_firmware_$id'));

    Future<void> openFirmwareTab(WidgetTester tester) async {
      await tester.tap(find.text('Firmware'));
      await tester.pumpAndSettle();
    }

    testWidgets(
      'แสดงเวอร์ชันที่กล่องรันอยู่ + ป้ายรันอยู่/ถอยเวอร์ชัน · ไม่เลือกให้เอง',
      (tester) async {
        await pump(
          tester,
          startAt: AppRoutes.deviceApply('DVC-1', taskId: 't1'),
        );
        await openFirmwareTab(tester);

        expect(
          find.text('กล่องรัน Firmware v1.2.0 อยู่ตอนนี้'),
          findsOneWidget,
        );
        expect(firmware('fw-1.3.0'), findsOneWidget);
        expect(find.byKey(const Key('apply_firmware_current')), findsOneWidget);
        expect(
          find.byKey(const Key('apply_firmware_downgrade')),
          findsOneWidget,
        );
        expect(tester.widget<FilledButton>(submit).onPressed, isNull);
      },
    );

    testWidgets('เวอร์ชันที่รันอยู่เลือกไม่ได้', (tester) async {
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1', taskId: 't1'));
      await openFirmwareTab(tester);

      await tester.tap(firmware('fw-1.2.0'));
      await tester.pump();

      expect(tester.widget<FilledButton>(submit).onPressed, isNull);
    });

    testWidgets('อัปเกรด -> ขอด้วย firmwareId ไม่ส่ง configId ไม่ถามยืนยัน', (
      tester,
    ) async {
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1', taskId: 't1'));
      await openFirmwareTab(tester);

      await tester.tap(firmware('fw-1.3.0'));
      await tester.pump();
      await tester.tap(submit);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('confirm_downgrade')), findsNothing);
      expect(applyRepo.lastCreateTaskId, 't1');
      expect(applyRepo.lastCreateFirmwareId, 'fw-1.3.0');
      expect(applyRepo.lastCreateConfigId, isNull);
    });

    testWidgets(
      'ถอยเวอร์ชัน -> ถามยืนยันก่อน · กลับไปเลือกใหม่ไม่สร้างคำขอ · ยืนยันแล้วจึงขอ',
      (tester) async {
        await pump(
          tester,
          startAt: AppRoutes.deviceApply('DVC-1', taskId: 't1'),
        );
        await openFirmwareTab(tester);

        await tester.tap(firmware('fw-1.0.0'));
        await tester.pump();
        await tester.tap(submit);
        await tester.pumpAndSettle();

        expect(
          find.textContaining('ถอยเวอร์ชันจาก v1.2.0 เป็น v1.0.0'),
          findsOneWidget,
        );
        await tester.tap(find.text('กลับไปเลือกใหม่'));
        await tester.pumpAndSettle();
        expect(applyRepo.createCalls, 0);

        await tester.tap(submit);
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('confirm_downgrade')));
        await tester.pumpAndSettle();
        expect(applyRepo.createCalls, 1);
        expect(applyRepo.lastCreateFirmwareId, 'fw-1.0.0');
      },
    );

    testWidgets('เปิดด้วย ?kind=firmware -> อยู่แท็บ Firmware เลย', (
      tester,
    ) async {
      await pump(
        tester,
        startAt: AppRoutes.deviceApply('DVC-1', taskId: 't1', firmware: true),
      );

      expect(firmware('fw-1.3.0'), findsOneWidget);
      expect(option('cfg-1'), findsNothing);
    });

    testWidgets(
      'ไม่รู้เวอร์ชันในกล่อง / ไม่มี Firmware ให้เลือก -> บอกชัด กดขอไม่ได้',
      (tester) async {
        applyRepo.options = fakeApplyOptions(
          currentFirmwareVersion: null,
          firmwares: const [],
        );
        await pump(
          tester,
          startAt: AppRoutes.deviceApply('DVC-1', taskId: 't1'),
        );
        await openFirmwareTab(tester);

        expect(
          find.textContaining('ไม่ทราบเวอร์ชัน Firmware ที่กล่องรันอยู่'),
          findsOneWidget,
        );
        expect(find.byKey(const Key('apply_firmware_empty')), findsOneWidget);
        expect(tester.widget<FilledButton>(submit).onPressed, isNull);
      },
    );
  });

  group('คำขอที่ยังไม่จบของกล่อง (apply-options openRequest)', () {
    final notice = find.byKey(const Key('apply_open_request'));
    final goToTask = find.byKey(const Key('apply_open_request_go_to_task'));

    testWidgets(
      'คำขอ Firmware อนุมัติแล้วของงานตัวเอง -> บอกตั้งแต่เปิดหน้า + ปุ่มขอปิด + ไปที่งานได้',
      (tester) async {
        applyRepo.options = fakeApplyOptions(
          openRequest: const ApplyOptionOpenRequest(
            kind: FieldApplyKind.firmware,
            status: ConfigApplyRequestStatus.approved,
            firmwareVersion: '1.0.0',
            taskId: 't-open',
          ),
        );
        final router = await pump(
          tester,
          startAt: AppRoutes.deviceApply('DVC-1'),
        );

        expect(notice, findsOneWidget);
        expect(
          find.text(
            'กล่องนี้มีคำขอส่ง Firmware v1.0.0 ค้างอยู่ (อนุมัติแล้ว กดส่งเข้ากล่องได้)',
          ),
          findsOneWidget,
        );
        // เข้าไปดูพารามิเตอร์ได้ แต่กดส่งไม่ได้
        await openParams(tester, 'cfg-1');
        expect(
          find.byKey(const Key('apply_params_open_request')),
          findsOneWidget,
        );
        expect(tester.widget<FilledButton>(submit).onPressed, isNull);
        router.pop();
        await tester.pumpAndSettle();

        await tester.tap(goToTask);
        await tester.pumpAndSettle();
        expect(find.text('TASK t-open'), findsOneWidget);
        expect(fieldTasks.startCalls, 0);
        expect(applyRepo.createCalls, 0);
      },
    );

    testWidgets('เปิดจากหน้างานของคำขอนั้นเอง -> ไปที่งาน = ย้อนกลับ', (
      tester,
    ) async {
      applyRepo.options = fakeApplyOptions(
        openRequest: const ApplyOptionOpenRequest(
          kind: FieldApplyKind.config,
          status: ConfigApplyRequestStatus.pending,
          configName: 'GT06N มาตรฐาน',
          taskId: 't1',
        ),
      );
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1', taskId: 't1'));

      expect(
        find.text(
          'กล่องนี้มีคำขอส่ง Config "GT06N มาตรฐาน" ค้างอยู่ (รอ Operation อนุมัติ)',
        ),
        findsOneWidget,
      );
      await tester.tap(goToTask);
      await tester.pumpAndSettle();
      expect(find.text('OPEN'), findsOneWidget);
    });

    testWidgets('คำขอของงานช่างคนอื่น -> บอกให้รอ ไม่มีปุ่มไปที่งาน', (
      tester,
    ) async {
      applyRepo.options = fakeApplyOptions(
        openRequest: const ApplyOptionOpenRequest(
          kind: FieldApplyKind.config,
          status: ConfigApplyRequestStatus.sending,
        ),
      );
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));

      expect(notice, findsOneWidget);
      expect(
        find.text('คำขอนี้เป็นของงานช่างคนอื่น — ขอใหม่ได้หลังคำขอนี้จบ'),
        findsOneWidget,
      );
      expect(goToTask, findsNothing);
    });

    testWidgets('ไม่มีคำขอค้าง -> ไม่มีแถบเตือน', (tester) async {
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));

      expect(notice, findsNothing);
      await openParams(tester, 'cfg-1');
      expect(tester.widget<FilledButton>(submit).onPressed, isNotNull);
    });
  });
}
