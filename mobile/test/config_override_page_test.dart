import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/ui/app_page_header.dart';
import 'package:mobile/core/ui/app_sensitive_value.dart';
import 'package:mobile/features/config_override/config_override_page.dart';
import 'package:mobile/features/config_override/config_override_repository.dart';
import 'package:mobile/features/task/apply_mode_provider.dart';
import 'package:mobile/features/task/config_apply_request_repository.dart';

import 'support/fake_config_apply_request_repository.dart';

const _apnDef = ConfigFieldDefinition(
  id: 'def-apn',
  fieldName: 'APN',
  dataType: 'string',
  allowedValues: [],
  required: true,
  stOverridable: true,
  sensitive: false,
  supportedModels: [],
);

const _modeDef = ConfigFieldDefinition(
  id: 'def-mode',
  fieldName: 'REPORT_MODE',
  dataType: 'string',
  allowedValues: ['normal', 'sos'],
  required: false,
  stOverridable: true,
  sensitive: false,
  supportedModels: [],
);

const _passwordDef = ConfigFieldDefinition(
  id: 'def-password',
  fieldName: 'COMMAND_PASSWORD',
  dataType: 'string',
  allowedValues: [],
  required: false,
  stOverridable: false,
  sensitive: true,
  supportedModels: [],
);

ConfigFieldDefinition _defOf(String name, String dataType) =>
    ConfigFieldDefinition(
      id: 'def-$name',
      fieldName: name,
      dataType: dataType,
      allowedValues: const [],
      required: false,
      stOverridable: true,
      sensitive: false,
      supportedModels: const [],
    );

const _defaultConfig = DeviceConfigDraft(
  id: 'cfg-1',
  name: 'GT06N · ตั้งค่ามาตรฐาน',
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: ConfigStatus.approved,
  fields: {
    'APN': 'internet',
    'REPORT_MODE': 'normal',
    'COMMAND_PASSWORD': '123456',
  },
);

class _FakeConfigOverrideRepository implements ConfigOverrideRepository {
  _FakeConfigOverrideRepository({
    DeviceConfigDraft? config,
    this.configError,
    List<ConfigFieldDefinition>? definitions,
    this.overrideError,
  }) : _config = config ?? _defaultConfig,
       _definitions = definitions ?? const [_apnDef, _modeDef, _passwordDef];

  final DeviceConfigDraft _config;
  final Object? configError;
  final List<ConfigFieldDefinition> _definitions;
  final Object? overrideError;

  String? lastDeviceId;
  Map<String, dynamic>? lastFields;
  String? lastReason;

  @override
  Future<DeviceConfigDraft> getCurrentConfig(String deviceId) async {
    if (configError != null) throw configError!;
    return _config;
  }

  @override
  Future<List<ConfigFieldDefinition>> listDefinitions() async => _definitions;

  @override
  Future<DeviceConfigOverride> overrideConfig({
    required String deviceId,
    required Map<String, dynamic> fields,
    required String reason,
  }) async {
    lastDeviceId = deviceId;
    lastFields = fields;
    lastReason = reason;
    if (overrideError != null) throw overrideError!;
    return DeviceConfigOverride(
      id: 'ov-1',
      deviceId: deviceId,
      configId: _config.id ?? 'cfg-1',
      versionNumber: 1,
      fields: fields,
      reason: reason,
      status: 'pending',
      overriddenBy: 'st-1',
      overriddenAt: DateTime.now().toIso8601String(),
    );
  }
}

Future<_FakeConfigOverrideRepository> _pump(
  WidgetTester tester, {
  _FakeConfigOverrideRepository? repo,
}) async {
  final fake = repo ?? _FakeConfigOverrideRepository();
  // หัวหน้าจอแบบ AppPageHeader (docs/22 Batch 4) กินพื้นที่บนจอ 800x600 ค่าเริ่มต้น
  // จนปุ่มส่งพ้นจอ — ใช้จอสูงแบบโทรศัพท์แนวตั้งให้เห็นทั้งฟอร์ม
  tester.view.physicalSize = const Size(400 * 3, 1200 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [configOverrideRepositoryProvider.overrideWithValue(fake)],
      child: const MaterialApp(home: ConfigOverridePage(deviceId: 'DEV-0117')),
    ),
  );
  await tester.pumpAndSettle();
  return fake;
}

void main() {
  testWidgets('field stOverridable:true -> แก้ไขได้ (TextField)', (
    tester,
  ) async {
    await _pump(tester);

    expect(find.byKey(const Key('config_override_input_APN')), findsOneWidget);
  });

  testWidgets('field allowedValues ไม่ว่าง -> เป็น dropdown', (tester) async {
    await _pump(tester);

    expect(
      find.byKey(const Key('config_override_input_REPORT_MODE')),
      findsOneWidget,
    );
    expect(find.byType(DropdownButton<String>), findsOneWidget);
  });

  testWidgets(
    'field stOverridable:false -> read-only + label "(แก้ไขไม่ได้)" ไม่มี input',
    (tester) async {
      await _pump(tester);

      expect(
        find.byKey(const Key('config_override_input_COMMAND_PASSWORD')),
        findsNothing,
      );
      expect(find.textContaining('(แก้ไขไม่ได้)'), findsOneWidget);
    },
  );

  testWidgets('ไม่กรอกเหตุผล -> submit -> error "กรอกเหตุผลก่อน override"', (
    tester,
  ) async {
    final fake = await _pump(tester);

    await tester.enterText(
      find.byKey(const Key('config_override_input_APN')),
      'new-apn',
    );
    await tester.tap(find.byKey(const Key('config_override_submit')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('config_override_error')), findsOneWidget);
    expect(find.text('กรอกเหตุผลก่อน override'), findsOneWidget);
    expect(fake.lastDeviceId, isNull); // ไม่เรียก repository เลย
  });

  testWidgets(
    'กรอกเหตุผลแต่ไม่แก้ค่าไหนเลย -> submit -> error "ยังไม่ได้แก้ค่าไหนเลย"',
    (tester) async {
      final fake = await _pump(tester);

      await tester.enterText(
        find.byKey(const Key('config_override_reason_input')),
        'เหตุผลทดสอบ',
      );
      await tester.tap(find.byKey(const Key('config_override_submit')));
      await tester.pumpAndSettle();

      expect(find.text('ยังไม่ได้แก้ค่าไหนเลย'), findsOneWidget);
      expect(fake.lastDeviceId, isNull);
    },
  );

  testWidgets(
    'แก้ค่า + กรอกเหตุผล -> submit สำเร็จ -> เรียก repository ด้วย fields/reason ถูกต้อง',
    (tester) async {
      final fake = await _pump(tester);

      await tester.enterText(
        find.byKey(const Key('config_override_input_APN')),
        'new-apn',
      );
      await tester.enterText(
        find.byKey(const Key('config_override_reason_input')),
        'ลูกค้าขอเปลี่ยนค่าหน้างาน',
      );
      await tester.tap(find.byKey(const Key('config_override_submit')));
      await tester.pumpAndSettle();

      expect(fake.lastDeviceId, 'DEV-0117');
      expect(fake.lastFields, {'APN': 'new-apn'});
      expect(fake.lastReason, 'ลูกค้าขอเปลี่ยนค่าหน้างาน');
      expect(find.text('ส่งคำขอแล้ว รอ Operation อนุมัติ'), findsOneWidget);
      expect(find.byKey(const Key('config_override_error')), findsNothing);
    },
  );

  testWidgets(
    'submit แล้ว backend 400 (field ไม่อนุญาต) -> แสดง error message + errorList',
    (tester) async {
      final fake = await _pump(
        tester,
        repo: _FakeConfigOverrideRepository(
          overrideError: ApiException(
            'ค่าที่ขอ override ไม่ผ่านการตรวจสอบ',
            statusCode: 400,
            details: const ['field "APN" ไม่อนุญาตให้ override'],
          ),
        ),
      );

      await tester.enterText(
        find.byKey(const Key('config_override_input_APN')),
        'new-apn',
      );
      await tester.enterText(
        find.byKey(const Key('config_override_reason_input')),
        'ทดสอบ',
      );
      await tester.tap(find.byKey(const Key('config_override_submit')));
      await tester.pumpAndSettle();

      expect(fake.lastDeviceId, 'DEV-0117');
      expect(find.byKey(const Key('config_override_error')), findsOneWidget);
      expect(find.text('ค่าที่ขอ override ไม่ผ่านการตรวจสอบ'), findsOneWidget);
      expect(find.text('• field "APN" ไม่อนุญาตให้ override'), findsOneWidget);
    },
  );

  group('dataType ครบทุกชนิด (PR #255 / issue #258)', () {
    Future<_FakeConfigOverrideRepository> pumpTyped(
      WidgetTester tester, {
      required String type,
      required dynamic current,
    }) {
      return _pump(
        tester,
        repo: _FakeConfigOverrideRepository(
          config: DeviceConfigDraft(
            id: 'cfg-1',
            name: 'cfg',
            deviceModel: 'GT06N',
            protocol: 'TCP',
            status: ConfigStatus.approved,
            fields: {'F': current},
          ),
          definitions: [_defOf('F', type)],
        ),
      );
    }

    Future<void> submitWithReason(WidgetTester tester) async {
      await tester.enterText(
        find.byKey(const Key('config_override_reason_input')),
        'ทดสอบ',
      );
      await tester.tap(find.byKey(const Key('config_override_submit')));
      await tester.pumpAndSettle();
    }

    Future<void> editAndSubmit(WidgetTester tester, String value) async {
      await tester.enterText(
        find.byKey(const Key('config_override_input_F')),
        value,
      );
      await submitWithReason(tester);
    }

    // type: [ค่าปัจจุบัน, ค่าที่พิมพ์, ค่าที่ต้องถูกส่งไป backend]
    final okCases = <String, List<Object?>>{
      'integer': [1, '8080', 8080],
      'decimal': [1.0, '12.5', 12.5],
      'number': [1, '90', 90], // legacy alias
      'string': ['a', 'b', 'b'],
      'text': ['a', 'b c', 'b c'],
      'date': ['2026-01-01', '2026-10-06', '2026-10-06'],
      'datetime': [
        '2026-01-01T00:00:00',
        '2026-10-06T08:30:00',
        '2026-10-06T08:30:00',
      ],
      'json': [
        {'a': 1},
        '{"b": 2}',
        {'b': 2},
      ],
      'array': [
        [1],
        '[2, 3]',
        [2, 3],
      ],
      'uuid': [
        '123e4567-e89b-12d3-a456-426614174000',
        '223e4567-e89b-12d3-a456-426614174000',
        '223e4567-e89b-12d3-a456-426614174000',
      ],
    };

    okCases.forEach((type, c) {
      testWidgets('$type: ค่าถูกต้อง -> ส่งชนิดข้อมูลตรงตาม dataType', (
        tester,
      ) async {
        final fake = await pumpTyped(tester, type: type, current: c[0]);
        await editAndSubmit(tester, c[1] as String);

        expect(fake.lastFields, {'F': c[2]});
        expect(find.byKey(const Key('config_override_error')), findsNothing);
      });
    });

    testWidgets('boolean: เลือกจาก dropdown -> ส่งเป็น bool จริง', (
      tester,
    ) async {
      final fake = await pumpTyped(tester, type: 'boolean', current: 'false');
      await tester.tap(find.byKey(const Key('config_override_input_F')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('true').last);
      await tester.pumpAndSettle();
      await submitWithReason(tester);

      expect(fake.lastFields, {'F': true});
    });

    final badCases = <String, String>{
      'integer': '1.5',
      'decimal': 'abc',
      'number': '0x10',
      'date': '2026-02-31',
      'datetime': '2026-10-06',
      'json': '[1]',
      'array': '{"a": 1}',
      'uuid': 'nope',
    };

    badCases.forEach((type, bad) {
      testWidgets('$type: ค่าผิด -> error ที่ฟอร์ม ไม่เรียก API ไม่ throw', (
        tester,
      ) async {
        final fake = await pumpTyped(
          tester,
          type: type,
          current: type == 'json'
              ? {'a': 1}
              : type == 'array'
              ? [1]
              : 'x',
        );
        await editAndSubmit(tester, bad);

        expect(tester.takeException(), isNull);
        expect(fake.lastDeviceId, isNull);
        expect(find.byKey(const Key('config_override_error')), findsOneWidget);
        expect(find.textContaining('F: '), findsOneWidget);
      });
    });

    testWidgets('json เสีย (parse ไม่ได้) -> error ที่ฟอร์ม ไม่ throw', (
      tester,
    ) async {
      final fake = await pumpTyped(tester, type: 'json', current: {'a': 1});
      await editAndSubmit(tester, '{');

      expect(tester.takeException(), isNull);
      expect(fake.lastDeviceId, isNull);
      expect(find.text('JSON ไม่ถูกต้อง'), findsWidgets);
    });

    testWidgets('error รายช่องหายเมื่อผู้ใช้แก้ค่าใหม่', (tester) async {
      await pumpTyped(tester, type: 'integer', current: 1);
      await editAndSubmit(tester, '1.5');
      expect(find.text('ต้องเป็นจำนวนเต็ม'), findsWidgets);

      await tester.enterText(
        find.byKey(const Key('config_override_input_F')),
        '2',
      );
      await tester.pump();
      expect(
        find.descendant(
          of: find.byKey(const Key('config_override_field_F')),
          matching: find.text('ต้องเป็นจำนวนเต็ม'),
        ),
        findsNothing,
      );
    });

    testWidgets(
      'json: ค่าเดิมแสดงเป็น JSON จริง และไม่แก้ = ไม่นับว่าเปลี่ยน',
      (tester) async {
        final fake = await pumpTyped(tester, type: 'json', current: {'a': 1});
        final field = tester.widget<TextField>(
          find.byKey(const Key('config_override_input_F')),
        );
        expect(field.controller!.text, '{"a":1}');
        expect(field.maxLines, greaterThan(1)); // multiline

        await submitWithReason(tester);
        expect(find.text('ยังไม่ได้แก้ค่าไหนเลย'), findsOneWidget);
        expect(fake.lastDeviceId, isNull);
      },
    );

    testWidgets('keyboard: integer ไม่มีจุดทศนิยม / decimal มี', (
      tester,
    ) async {
      await pumpTyped(tester, type: 'integer', current: 1);
      var f = tester.widget<TextField>(
        find.byKey(const Key('config_override_input_F')),
      );
      expect(f.keyboardType.decimal, isFalse);

      await pumpTyped(tester, type: 'decimal', current: 1.5);
      f = tester.widget<TextField>(
        find.byKey(const Key('config_override_input_F')),
      );
      expect(f.keyboardType.decimal, isTrue);
    });
  });

  group('badge hasDeviceOverride (issue #223)', () {
    testWidgets('config.hasDeviceOverride:true -> เห็น badge', (tester) async {
      await _pump(
        tester,
        repo: _FakeConfigOverrideRepository(
          config: const DeviceConfigDraft(
            id: 'cfg-1',
            name: 'GT06N · ตั้งค่ามาตรฐาน',
            deviceModel: 'GT06N',
            protocol: 'TCP',
            status: ConfigStatus.approved,
            fields: {'APN': 'internet'},
            hasDeviceOverride: true,
          ),
        ),
      );

      expect(
        find.byKey(const Key('config_override_has_override_badge')),
        findsOneWidget,
      );
    });

    testWidgets('config.hasDeviceOverride:false -> ไม่เห็น badge', (
      tester,
    ) async {
      await _pump(
        tester,
      ); // _defaultConfig: hasDeviceOverride ค่า default false

      expect(
        find.byKey(const Key('config_override_has_override_badge')),
        findsNothing,
      );
    });
  });

  group('pendingOverride banner (มติ 2026-09-24, PR #225)', () {
    testWidgets(
      'config.pendingOverride ไม่ null -> เห็น banner รอ Operation อนุมัติ',
      (tester) async {
        await _pump(
          tester,
          repo: _FakeConfigOverrideRepository(
            config: DeviceConfigDraft(
              id: 'cfg-1',
              name: 'GT06N · ตั้งค่ามาตรฐาน',
              deviceModel: 'GT06N',
              protocol: 'TCP',
              status: ConfigStatus.approved,
              fields: const {'APN': 'internet'},
              pendingOverride: DeviceConfigOverride(
                id: 'ov-1',
                deviceId: 'DEV-0117',
                configId: 'cfg-1',
                versionNumber: 1,
                fields: const {'APN': 'new-apn'},
                reason: 'ลูกค้าขอเปลี่ยนค่าหน้างาน',
                status: 'pending',
                overriddenBy: 'st-1',
                overriddenAt: '2026-09-24T00:00:00.000Z',
              ),
            ),
          ),
        );

        expect(
          find.byKey(const Key('config_override_pending_banner')),
          findsOneWidget,
        );
        expect(
          find.text('มีคำขอ override รอ Operation อนุมัติอยู่'),
          findsOneWidget,
        );
        expect(find.text('เหตุผล: ลูกค้าขอเปลี่ยนค่าหน้างาน'), findsOneWidget);
      },
    );

    testWidgets('config.pendingOverride เป็น null -> ไม่เห็น banner', (
      tester,
    ) async {
      await _pump(tester); // _defaultConfig: pendingOverride ค่า default null

      expect(
        find.byKey(const Key('config_override_pending_banner')),
        findsNothing,
      );
    });
  });

  testWidgets(
    'อุปกรณ์ยังไม่มี Config ที่ยืนยันติดตั้ง (404) -> ข้อความเฉพาะ + ปุ่มลองอีกครั้ง',
    (tester) async {
      await _pump(
        tester,
        repo: _FakeConfigOverrideRepository(
          configError: ApiException('not found', statusCode: 404),
        ),
      );

      expect(
        find.byKey(const Key('config_override_load_error')),
        findsOneWidget,
      );
      expect(
        find.text('อุปกรณ์นี้ยังไม่มี Config ที่ยืนยันติดตั้งแล้ว'),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('config_override_load_retry')),
        findsOneWidget,
      );
    },
  );

  /// เลื่อนจนเห็นปุ่ม "ยืนยัน Override" แล้วคืน finder ของปุ่ม — ปุ่มอยู่ท้าย
  /// ListView ถ้าแถวด้านบนสูงขึ้น (เช่น #334 ย้ายป้าย "(override ไม่ได้)" ลง
  /// บรรทัดล่าง) ปุ่มจะเลยพื้นที่จอของเทส (800x600) จน ListView ไม่สร้าง
  Future<Finder> revealSubmit(WidgetTester tester) async {
    final submit = find.byKey(const Key('config_override_submit'));
    await tester.scrollUntilVisible(
      submit,
      200,
      scrollable: find.byType(Scrollable).first,
    );
    return submit;
  }

  // UX audit #16 — เดิมเช็คเหตุผลก่อนแล้ว return ทันที ค่าที่ผิดชนิดในช่องอื่น
  // ไม่ขึ้น error จนกว่าจะกดส่งรอบสอง
  group('ตรวจครบทุกช่องในการกดส่งครั้งเดียว (UX audit #16)', () {
    String? errorTextOf(WidgetTester tester, String key) =>
        tester.widget<TextField>(find.byKey(Key(key))).decoration?.errorText;

    testWidgets(
      'เหตุผลว่าง + ค่าผิดชนิด -> กดส่งครั้งเดียวเห็น errorText ทั้งสองช่อง',
      (tester) async {
        final fake = await _pump(
          tester,
          repo: _FakeConfigOverrideRepository(
            config: const DeviceConfigDraft(
              id: 'cfg-1',
              name: 'cfg',
              deviceModel: 'GT06N',
              protocol: 'TCP',
              status: ConfigStatus.approved,
              fields: {'F': 30},
            ),
            definitions: [_defOf('F', 'integer')],
          ),
        );

        await tester.enterText(
          find.byKey(const Key('config_override_input_F')),
          'abc',
        );
        await tester.tap(await revealSubmit(tester));
        await tester.pumpAndSettle();

        expect(errorTextOf(tester, 'config_override_input_F'), isNotNull);
        expect(
          errorTextOf(tester, 'config_override_reason_input'),
          'กรอกเหตุผลก่อน override',
        );
        expect(fake.lastDeviceId, isNull);
      },
    );

    testWidgets('เหตุผลว่าง + ไม่ได้แก้ค่าไหน -> บอกทั้งสองเรื่องในรอบเดียว', (
      tester,
    ) async {
      final fake = await _pump(tester);

      await tester.tap(await revealSubmit(tester));
      await tester.pumpAndSettle();

      expect(
        errorTextOf(tester, 'config_override_reason_input'),
        'กรอกเหตุผลก่อน override',
      );
      expect(find.text('ยังไม่ได้แก้ค่าไหนเลย'), findsOneWidget);
      expect(fake.lastDeviceId, isNull);
    });

    testWidgets('errorText ของเหตุผลหายเมื่อเริ่มพิมพ์เหตุผล', (tester) async {
      await _pump(tester);
      await tester.tap(await revealSubmit(tester));
      await tester.pumpAndSettle();
      expect(errorTextOf(tester, 'config_override_reason_input'), isNotNull);

      await tester.enterText(
        find.byKey(const Key('config_override_reason_input')),
        'ล',
      );
      await tester.pump();

      expect(errorTextOf(tester, 'config_override_reason_input'), isNull);
    });
  });

  // UX audit #17 — ส่งตอนออฟไลน์ คำขอนี้ไม่เข้าคิว sync (ต่างจากการเปลี่ยน
  // สถานะงาน) ข้อความต้องบอกว่าส่งไม่สำเร็จ ให้กดส่งเอง และค่าที่กรอกต้องอยู่
  // ครบ · ไม่ยืนยันว่า "ยังไม่ได้ส่ง" เพราะ receive timeout คำขออาจถึง server
  // แล้ว (รีวิว A บน #333) — ส่งซ้ำได้ 409 จึงปลอดภัย
  group('ส่งตอนออฟไลน์ (UX audit #17)', () {
    const offlineMessage =
        'ส่งไม่สำเร็จ ต้องใช้อินเทอร์เน็ต ค่าที่กรอกไว้ยังอยู่ในฟอร์ม '
        'ลองกดส่งอีกครั้ง';

    Future<void> fillAndSubmit(WidgetTester tester) async {
      await tester.enterText(
        find.byKey(const Key('config_override_input_APN')),
        'new-apn',
      );
      await tester.enterText(
        find.byKey(const Key('config_override_reason_input')),
        'ลูกค้าขอเปลี่ยนค่าหน้างาน',
      );
      await tester.tap(await revealSubmit(tester));
      await tester.pumpAndSettle();
    }

    String fieldText(WidgetTester tester, String key) => tester
        .widget<EditableText>(
          find.descendant(
            of: find.byKey(Key(key)),
            matching: find.byType(EditableText),
          ),
        )
        .controller
        .text;

    testWidgets('ไม่มีเน็ต (ไม่มี HTTP response) -> บอกว่าส่งไม่สำเร็จ '
        'ฟอร์มยังเปิด ค่าที่กรอกอยู่ครบ กดส่งใหม่ได้', (tester) async {
      await _pump(
        tester,
        repo: _FakeConfigOverrideRepository(
          overrideError: ApiException(
            'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง',
          ),
        ),
      );

      await fillAndSubmit(tester);

      expect(find.text(offlineMessage), findsOneWidget);
      expect(find.byType(ConfigOverridePage), findsOneWidget);
      expect(fieldText(tester, 'config_override_input_APN'), 'new-apn');
      expect(
        fieldText(tester, 'config_override_reason_input'),
        'ลูกค้าขอเปลี่ยนค่าหน้างาน',
      );
      expect(find.text('ส่งคำขอแล้ว รอ Operation อนุมัติ'), findsNothing);
      final submit = await revealSubmit(tester);
      expect(tester.widget<FilledButton>(submit).onPressed, isNotNull);
    });

    testWidgets(
      'ออนไลน์ส่งสำเร็จ -> พฤติกรรมเดิม (snackbar รออนุมัติ ล้างฟอร์ม)',
      (tester) async {
        final fake = await _pump(tester);

        await fillAndSubmit(tester);

        expect(fake.lastFields, {'APN': 'new-apn'});
        expect(find.text('ส่งคำขอแล้ว รอ Operation อนุมัติ'), findsOneWidget);
        expect(find.text(offlineMessage), findsNothing);
        expect(fieldText(tester, 'config_override_reason_input'), '');
      },
    );

    testWidgets('server ตอบ error (มี statusCode) -> ยังใช้ข้อความของ server '
        'ไม่ใช่ข้อความออฟไลน์', (tester) async {
      await _pump(
        tester,
        repo: _FakeConfigOverrideRepository(
          overrideError: ApiException(
            'มีคำขอ override รออนุมัติอยู่แล้ว',
            statusCode: 409,
          ),
        ),
      );

      await fillAndSubmit(tester);

      expect(find.text('มีคำขอ override รออนุมัติอยู่แล้ว'), findsOneWidget);
      expect(find.text(offlineMessage), findsNothing);
    });
  });

  // docs/22 §7.1 (AppSensitiveValue, Batch 4) + docs/21 #20 — ค่า sensitive ซ่อนเป็นค่า
  // เริ่มต้น ปุ่มรูปตามี label ให้ screen reader
  group('ค่า sensitive (AppSensitiveValue)', () {
    testWidgets('override ไม่ได้ -> ซ่อนค่า กดปุ่ม "แสดงค่า" แล้วเห็นค่าจริง', (
      tester,
    ) async {
      await _pump(tester);

      expect(find.text('123456'), findsNothing);
      expect(find.text(AppSensitiveValue.masked), findsOneWidget);

      await tester.tap(find.byTooltip('แสดงค่า'));
      await tester.pump();

      expect(find.text('123456'), findsOneWidget);
      expect(find.byTooltip('ซ่อนค่า'), findsOneWidget);
    });

    testWidgets('แก้ได้ -> ช่องกรอกซ่อนตัวอักษร ปุ่มรูปตาสลับการแสดงผล', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeConfigOverrideRepository(
          config: const DeviceConfigDraft(
            id: 'cfg-1',
            name: 'GT06N · ตั้งค่ามาตรฐาน',
            deviceModel: 'GT06N',
            protocol: 'TCP',
            status: ConfigStatus.approved,
            fields: {'SERVER_TOKEN': 'abc'},
          ),
          definitions: const [
            ConfigFieldDefinition(
              id: 'def-token',
              fieldName: 'SERVER_TOKEN',
              dataType: 'string',
              allowedValues: [],
              required: false,
              stOverridable: true,
              sensitive: true,
              supportedModels: [],
            ),
          ],
        ),
      );

      EditableText field() => tester.widget<EditableText>(
        find.descendant(
          of: find.byKey(const Key('config_override_input_SERVER_TOKEN')),
          matching: find.byType(EditableText),
        ),
      );
      expect(field().obscureText, isTrue);

      await tester.tap(find.byTooltip('แสดงค่า'));
      await tester.pump();
      expect(field().obscureText, isFalse);
    });
  });

  testWidgets(
    'มี override เครื่องนี้ -> ป้ายบนหัวหน้าจอ + ชื่อ Config ใน meta',
    (tester) async {
      await _pump(
        tester,
        repo: _FakeConfigOverrideRepository(
          config: const DeviceConfigDraft(
            id: 'cfg-1',
            name: 'GT06N · ตั้งค่ามาตรฐาน',
            deviceModel: 'GT06N',
            protocol: 'TCP',
            status: ConfigStatus.approved,
            fields: {'APN': 'internet'},
            hasDeviceOverride: true,
          ),
        ),
      );

      expect(
        find.descendant(
          of: find.byType(AppPageHeader),
          matching: find.byKey(const Key('config_override_has_override_badge')),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byType(AppPageHeader),
          matching: find.text('GT06N · ตั้งค่ามาตรฐาน'),
        ),
        findsOneWidget,
      );
    },
  );

  // docs/30 §6 — ช่วงค่าตัวเลข + โหมด central (Override = คำขอส่งเข้ากล่อง)
  testWidgets(
    'มีคำอธิบาย -> แสดงชื่อเรียกง่ายเป็นหัว และชื่อพารามิเตอร์จริงตัวเล็กด้านล่าง',
    (tester) async {
      final fake = _FakeConfigOverrideRepository(
        config: const DeviceConfigDraft(
          id: 'cfg-1',
          name: 'BOX · มาตรฐาน',
          deviceModel: 'ESP32-DEVKIT-V1',
          protocol: 'HTTP',
          status: ConfigStatus.approved,
          fields: {'gps.send_interval_sec': 10, 'gps.baud_rate': 9600},
        ),
        definitions: const [
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
        ],
      );
      await _pump(tester, repo: fake);

      expect(
        find.byKey(const Key('config_override_label_gps.send_interval_sec')),
        findsOneWidget,
      );
      expect(find.text('รอบส่ง GPS (วินาที)'), findsOneWidget);
      expect(find.text('gps.send_interval_sec'), findsOneWidget);
      // ไม่มีคำอธิบาย -> ใช้ชื่อพารามิเตอร์อย่างเดียว ไม่มีหัวซ้ำ
      expect(
        find.byKey(const Key('config_override_label_gps.baud_rate')),
        findsNothing,
      );
      expect(find.text('gps.baud_rate'), findsOneWidget);
    },
  );

  testWidgets(
    'ค่าที่กล่องใช้อยู่แต่ไม่อยู่ใน Config -> แสดงด้วยแบบแก้ไม่ได้ ไม่ซ้ำกับค่าใน Config',
    (tester) async {
      final fake = _FakeConfigOverrideRepository(
        config: const DeviceConfigDraft(
          id: 'cfg-1',
          name: 'BOX · ส่งพิกัดทุก 10 วินาที',
          deviceModel: 'ESP32-DEVKIT-V1',
          protocol: 'HTTP',
          status: ConfigStatus.approved,
          fields: {'gps.send_interval_sec': 10},
          boxFields: BoxFields(
            fields: {'gps.send_interval_sec': 10, 'led.enabled': true},
            reportedAt: null,
          ),
        ),
        definitions: const [
          ConfigFieldDefinition(
            id: 'def-interval',
            fieldName: 'gps.send_interval_sec',
            dataType: 'integer',
            allowedValues: [],
            required: false,
            stOverridable: true,
            sensitive: false,
            supportedModels: [],
          ),
          ConfigFieldDefinition(
            id: 'def-led',
            fieldName: 'led.enabled',
            dataType: 'boolean',
            allowedValues: [],
            required: false,
            // แก้ผ่าน Override ได้ แต่ไม่อยู่ใน Config นี้ -> ยังแก้ไม่ได้
            stOverridable: true,
            sensitive: false,
            supportedModels: [],
            description: 'เปิดไฟ LED',
          ),
        ],
      );
      await _pump(tester, repo: fake);

      expect(
        find.byKey(const Key('config_override_field_gps.send_interval_sec')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('config_override_input_gps.send_interval_sec')),
        findsOneWidget,
      );
      final led = find.byKey(const Key('config_override_field_led.enabled'));
      expect(led, findsOneWidget);
      expect(
        find.descendant(of: led, matching: find.text('เปิดไฟ LED')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: led, matching: find.text('true')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: led, matching: find.text('(แก้ไขไม่ได้)')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('config_override_input_led.enabled')),
        findsNothing,
      );
    },
  );

  group('ค่าในกล่องกับค่าที่อนุมัติแล้วรอส่ง (delivery v3.71)', () {
    const speedDef = ConfigFieldDefinition(
      id: 'def-speed',
      fieldName: 'speed_limit.max_kmh',
      dataType: 'integer',
      allowedValues: [],
      required: false,
      stOverridable: true,
      sensitive: false,
      supportedModels: [],
      unit: 'km/h',
    );

    Future<void> pumpWithDelivery(
      WidgetTester tester,
      ConfigDelivery? delivery,
    ) async {
      final fake = _FakeConfigOverrideRepository(
        config: DeviceConfigDraft(
          id: 'cfg-1',
          name: 'BOX · มาตรฐาน',
          deviceModel: 'ESP32-DEVKIT-V1',
          protocol: 'HTTP',
          status: ConfigStatus.approved,
          fields: const {'speed_limit.max_kmh': 100},
          hasDeviceOverride: true,
          delivery: delivery,
        ),
        definitions: const [speedDef],
      );
      await _pump(tester, repo: fake);
    }

    testWidgets(
      'อนุมัติแล้วยังไม่ส่ง -> แถบบอกจำนวนค่าที่รอส่ง + ใต้ช่องบอกค่าในกล่องตอนนี้',
      (tester) async {
        await pumpWithDelivery(
          tester,
          ConfigDelivery(
            fields: const {'speed_limit.max_kmh': 80},
            confirmedAt: DateTime.utc(2026, 10, 27, 9, 31),
            pendingFieldNames: const ['speed_limit.max_kmh'],
          ),
        );

        expect(
          find.byKey(const Key('config_override_undelivered_notice')),
          findsOneWidget,
        );
        expect(
          find.textContaining('1 ค่าที่อนุมัติแล้วแต่ยังไม่ได้ส่งเข้ากล่อง'),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('config_override_in_box_speed_limit.max_kmh')),
          findsOneWidget,
        );
        expect(find.text('ในกล่องตอนนี้ 80 · รอส่งเข้ากล่อง'), findsOneWidget);
      },
    );

    testWidgets(
      'ค่าในกล่องตรงกับที่อนุมัติ -> ไม่มีแถบ ไม่มีบรรทัดค่าในกล่อง',
      (tester) async {
        await pumpWithDelivery(
          tester,
          ConfigDelivery(
            fields: const {'speed_limit.max_kmh': 100},
            confirmedAt: DateTime.utc(2026, 10, 27, 9, 31),
            pendingFieldNames: const [],
          ),
        );

        expect(
          find.byKey(const Key('config_override_undelivered_notice')),
          findsNothing,
        );
        expect(find.textContaining('ในกล่องตอนนี้'), findsNothing);
      },
    );

    testWidgets('ไม่มีข้อมูลการส่ง (delivery = null) -> แสดงแบบเดิม', (
      tester,
    ) async {
      await pumpWithDelivery(tester, null);

      expect(
        find.byKey(const Key('config_override_undelivered_notice')),
        findsNothing,
      );
      expect(find.textContaining('ในกล่องตอนนี้'), findsNothing);
    });
  });

  group('docs/30 — ช่วงค่าและโหมด central', () {
    const speedDef = ConfigFieldDefinition(
      id: 'def-speed',
      fieldName: 'speed_limit.max_kmh',
      dataType: 'integer',
      allowedValues: [],
      required: false,
      stOverridable: true,
      sensitive: false,
      supportedModels: [],
      unit: 'km/h',
      minValue: 1,
      maxValue: 200,
    );
    const speedConfig = DeviceConfigDraft(
      id: 'cfg-1',
      name: 'BOX · มาตรฐาน',
      deviceModel: 'ESP32-DEVKIT-V1',
      protocol: 'HTTP',
      status: ConfigStatus.approved,
      fields: {'speed_limit.max_kmh': 80},
    );
    const speedInput = Key('config_override_input_speed_limit.max_kmh');

    Future<_FakeConfigOverrideRepository> pumpMode(
      WidgetTester tester, {
      required bool central,
      FakeConfigApplyRequestRepository? applyRepo,
    }) async {
      final fake = _FakeConfigOverrideRepository(
        config: speedConfig,
        definitions: const [speedDef],
      );
      tester.view.physicalSize = const Size(400 * 3, 1200 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final router = GoRouter(
        routes: [
          GoRoute(
            path: '/',
            builder: (_, _) => const ConfigOverridePage(deviceId: 'DEV-0117'),
          ),
          GoRoute(
            path: '/tasks/:id',
            builder: (_, state) =>
                Text('task-page-${state.pathParameters['id']}'),
          ),
        ],
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            configOverrideRepositoryProvider.overrideWithValue(fake),
            centralApplyModeProvider.overrideWith((ref) async => central),
            configApplyRequestRepositoryProvider.overrideWithValue(
              applyRepo ?? FakeConfigApplyRequestRepository(),
            ),
          ],
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      return fake;
    }

    Future<void> fillAndSubmit(WidgetTester tester, String value) async {
      await tester.enterText(find.byKey(speedInput), value);
      await tester.enterText(
        find.byKey(const Key('config_override_reason_input')),
        'ลูกค้าขอจำกัดความเร็ว',
      );
      final submit = find.byKey(const Key('config_override_submit'));
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
    }

    testWidgets('ช่องตัวเลขที่มีช่วง -> บอกช่วงพร้อมหน่วยใต้ช่อง', (
      tester,
    ) async {
      await pumpMode(tester, central: false);

      expect(find.text('ช่วง 1–200 km/h'), findsOneWidget);
    });

    testWidgets('ค่านอกช่วง -> error ใต้ช่อง ไม่ส่งคำขอ', (tester) async {
      final fake = await pumpMode(tester, central: false);

      await fillAndSubmit(tester, '250');

      expect(fake.lastFields, isNull);
      expect(find.text('ต้องอยู่ระหว่าง 1–200 km/h'), findsWidgets);
    });

    testWidgets('โหมดเดิม: ส่งสำเร็จอยู่หน้าเดิม ไม่ถามหางาน', (tester) async {
      final applyRepo = FakeConfigApplyRequestRepository();
      final fake = await pumpMode(tester, central: false, applyRepo: applyRepo);

      expect(find.text('ยืนยัน Override'), findsOneWidget);
      await fillAndSubmit(tester, '60');

      expect(fake.lastFields, {'speed_limit.max_kmh': 60});
      expect(applyRepo.optionsCalls, 0);
      expect(find.text('ส่งคำขอแล้ว รอ Operation อนุมัติ'), findsOneWidget);
    });

    testWidgets(
      'โหมด central: ปุ่ม/คำอธิบายบอกว่าเป็นคำขอส่งเข้ากล่อง · ส่งแล้วไปหน้างานของคำขอ',
      (tester) async {
        final applyRepo = FakeConfigApplyRequestRepository(
          options: fakeApplyOptions(
            deviceId: 'DEV-0117',
            openRequest: const ApplyOptionOpenRequest(
              kind: FieldApplyKind.config,
              status: ConfigApplyRequestStatus.pending,
              taskId: 'task-9',
            ),
          ),
        );
        final fake = await pumpMode(
          tester,
          central: true,
          applyRepo: applyRepo,
        );

        expect(find.text('ขออนุมัติและรอส่งเข้ากล่อง'), findsOneWidget);
        expect(find.textContaining('กดส่งเข้ากล่องจากหน้างาน'), findsOneWidget);
        await fillAndSubmit(tester, '60');

        expect(fake.lastFields, {'speed_limit.max_kmh': 60});
        expect(applyRepo.optionsCalls, 1);
        expect(find.text('task-page-task-9'), findsOneWidget);
      },
    );

    testWidgets(
      'โหมด central แต่หางานของคำขอไม่เจอ -> อยู่หน้าเดิม พร้อมข้อความบอกไปกดส่งที่หน้างาน',
      (tester) async {
        final applyRepo = FakeConfigApplyRequestRepository(
          options: fakeApplyOptions(deviceId: 'DEV-0117'),
        );
        await pumpMode(tester, central: true, applyRepo: applyRepo);

        await fillAndSubmit(tester, '60');

        expect(find.byType(ConfigOverridePage), findsOneWidget);
        expect(
          find.text(ConfigOverridePage.centralSubmittedMessage),
          findsOneWidget,
        );
      },
    );
  });
}
