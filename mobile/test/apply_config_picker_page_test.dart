import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/task/apply_config_picker_page.dart';
import 'package:mobile/features/task/config_apply_request_repository.dart';
import 'package:mobile/features/task/field_task_repository.dart';
import 'package:mobile/features/task/task_repository.dart';

import 'support/fake_config_apply_request_repository.dart';
import 'support/fake_field_task_repository.dart';

/// หน้าเลือก Config (docs/28 §6) — เปิดจากหน้ากล่อง (เริ่มงานให้ก่อน) หรือจาก
/// หน้างาน (`?taskId=`)
void main() {
  late FakeConfigApplyRequestRepository applyRepo;
  late FakeFieldTaskRepository fieldTasks;

  setUp(() {
    applyRepo = FakeConfigApplyRequestRepository();
    fieldTasks = FakeFieldTaskRepository();
  });

  /// เส้นทาง: หน้าแรก → หน้าเลือก (push) → หน้างาน · [startAt] = path ของหน้าเลือก
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

  testWidgets(
    'แสดง Config ทุกตัว · ตัวที่ Operation แนะนำมีป้ายและถูกเลือกไว้ก่อน',
    (tester) async {
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));

      expect(option('cfg-1'), findsOneWidget);
      expect(option('cfg-2'), findsOneWidget);
      expect(find.byKey(const Key('apply_option_suggested')), findsOneWidget);
      expect(find.text('เวอร์ชัน 3'), findsOneWidget);
      expect(find.text('ยังไม่มีเวอร์ชันที่บันทึก'), findsOneWidget);
      expect(tester.widget<FilledButton>(submit).onPressed, isNotNull);
    },
  );

  testWidgets('ไม่มีตัวแนะนำ -> ต้องเลือกก่อนถึงกดขอได้', (tester) async {
    applyRepo.options = fakeApplyOptions(
      configs: const [
        ApplyOptionConfig(
          id: 'cfg-2',
          name: 'GT06N ลูกค้าพิเศษ',
          latestVersion: 1,
          suggested: false,
        ),
      ],
    );
    await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));

    expect(tester.widget<FilledButton>(submit).onPressed, isNull);
    await tester.tap(option('cfg-2'));
    await tester.pump();
    expect(tester.widget<FilledButton>(submit).onPressed, isNotNull);
  });

  testWidgets(
    'เปิดจากหน้ากล่อง: เริ่มงานก่อน แล้วสร้างคำขอด้วย Config ที่เลือก+หมายเหตุ แล้วไปหน้างาน',
    (tester) async {
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));

      await tester.tap(option('cfg-2'));
      await tester.enterText(
        find.byKey(const Key('apply_note_field')),
        ' ลูกค้าขอ ',
      );
      await tester.tap(submit);
      await tester.pumpAndSettle();

      expect(fieldTasks.startCalls, 1);
      expect(fieldTasks.lastDeviceId, 'DVC-1');
      expect(applyRepo.lastCreateTaskId, 't-new');
      expect(applyRepo.lastCreateConfigId, 'cfg-2');
      expect(applyRepo.lastCreateNote, 'ลูกค้าขอ');
      expect(find.text('TASK t-new'), findsOneWidget);
    },
  );

  testWidgets(
    'เปิดจากหน้างาน (?taskId=): ไม่เริ่มงานใหม่ สร้างคำขอให้งานนั้นแล้วปิดหน้า',
    (tester) async {
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1', taskId: 't1'));

      await tester.tap(submit);
      await tester.pumpAndSettle();

      expect(fieldTasks.startCalls, 0);
      expect(applyRepo.lastCreateTaskId, 't1');
      expect(applyRepo.lastCreateConfigId, 'cfg-1');
      expect(applyRepo.lastCreateNote, isNull);
      expect(find.text('OPEN'), findsOneWidget);
    },
  );

  testWidgets(
    'เริ่มงานได้แต่สร้างคำขอไม่ผ่าน -> แสดงข้อความ backend + ลิงก์ไปที่งาน · กดซ้ำไม่เริ่มงานซ้ำ',
    (tester) async {
      applyRepo.createError = ApiException(
        'เครื่องนี้มีคำขอส่ง Config ที่ยังไม่จบอยู่แล้ว',
        statusCode: 409,
      );
      await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));

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

  testWidgets('กล่องยังไม่ติดตั้ง -> เตือนและกดขอไม่ได้', (tester) async {
    applyRepo.options = fakeApplyOptions(deviceInstalled: false);
    await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));

    expect(find.byKey(const Key('apply_device_not_installed')), findsOneWidget);
    expect(tester.widget<FilledButton>(submit).onPressed, isNull);
  });

  testWidgets('ไม่มี Config สำหรับรุ่นนี้ -> บอกให้แจ้ง Config Engineer', (
    tester,
  ) async {
    applyRepo.options = fakeApplyOptions(configs: const []);
    await pump(tester, startAt: AppRoutes.deviceApply('DVC-1'));

    expect(find.byKey(const Key('apply_options_empty')), findsOneWidget);
    expect(tester.widget<FilledButton>(submit).onPressed, isNull);
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
}
