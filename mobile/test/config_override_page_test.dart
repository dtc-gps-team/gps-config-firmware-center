import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/config_override/config_override_page.dart';
import 'package:mobile/features/config_override/config_override_repository.dart';

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
    'field stOverridable:false -> read-only + label "(override ไม่ได้)" ไม่มี input',
    (tester) async {
      await _pump(tester);

      expect(
        find.byKey(const Key('config_override_input_COMMAND_PASSWORD')),
        findsNothing,
      );
      expect(find.textContaining('(override ไม่ได้)'), findsOneWidget);
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
}
