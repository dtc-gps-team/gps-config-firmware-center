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

  String? lastConfigId;
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
  Future<DeviceConfigDraft> overrideConfig({
    required String configId,
    required Map<String, dynamic> fields,
    required String reason,
  }) async {
    lastConfigId = configId;
    lastFields = fields;
    lastReason = reason;
    if (overrideError != null) throw overrideError!;
    return _config;
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
      expect(find.textContaining('override ไม่ได้'), findsOneWidget);
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
    expect(fake.lastConfigId, isNull); // ไม่เรียก repository เลย
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
      expect(fake.lastConfigId, isNull);
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

      expect(fake.lastConfigId, 'cfg-1');
      expect(fake.lastFields, {'APN': 'new-apn'});
      expect(fake.lastReason, 'ลูกค้าขอเปลี่ยนค่าหน้างาน');
      expect(find.text('Override สำเร็จ — ค่าถูกเปลี่ยนแล้ว'), findsOneWidget);
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

      expect(fake.lastConfigId, 'cfg-1');
      expect(find.byKey(const Key('config_override_error')), findsOneWidget);
      expect(find.text('ค่าที่ขอ override ไม่ผ่านการตรวจสอบ'), findsOneWidget);
      expect(find.text('• field "APN" ไม่อนุญาตให้ override'), findsOneWidget);
    },
  );

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
