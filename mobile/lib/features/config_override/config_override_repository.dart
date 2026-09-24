import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';

/// Config Override — Phase 2 (Mobile, issue #211), per-device (issue #223).
/// ST อ่าน Config ปัจจุบันของอุปกรณ์แล้วแก้ค่าบาง field ที่ `stOverridable:
/// true` โดยตรง ไม่ผ่าน Approval Center ปกติ — เขียนลง `DeviceConfigOverride`
/// ผูกกับอุปกรณ์เครื่องนี้เท่านั้น ไม่กระทบอุปกรณ์อื่นที่ใช้ Config เดียวกัน
/// (mirror UX ของ `web/src/app/(app)/config/config-override-panel.tsx` แต่
/// endpoint คนละตัวกับที่ Web เรียก — ดู `overrideDeviceConfig`).
abstract class ConfigOverrideRepository {
  /// `GET /devices/{deviceId}/config`
  Future<DeviceConfigDraft> getCurrentConfig(String deviceId);

  /// `GET /config-definitions`
  Future<List<ConfigFieldDefinition>> listDefinitions();

  /// `POST /devices/{deviceId}/config-override` (issue #223) — **ไม่ใช่**
  /// `POST /config/{configId}/override` เดิม (issue #185) ที่ Web ยังใช้อยู่
  /// — endpoint นั้นแก้ Config ทั้งชุด กระทบทุกอุปกรณ์ที่ใช้ Config เดียวกัน
  /// Mobile เปลี่ยนมาใช้ endpoint per-device นี้เท่านั้นตั้งแต่ #223
  Future<DeviceConfigDraft> overrideConfig({
    required String deviceId,
    required Map<String, dynamic> fields,
    required String reason,
  });
}

/// Talks to the real backend.
class ApiConfigOverrideRepository implements ConfigOverrideRepository {
  ApiConfigOverrideRepository(this._api);

  final ApiClient _api;

  @override
  Future<DeviceConfigDraft> getCurrentConfig(String deviceId) =>
      _api.getDeviceCurrentConfig(deviceId);

  @override
  Future<List<ConfigFieldDefinition>> listDefinitions() =>
      _api.listConfigDefinitions();

  @override
  Future<DeviceConfigDraft> overrideConfig({
    required String deviceId,
    required Map<String, dynamic> fields,
    required String reason,
  }) => _api.overrideDeviceConfig(
    deviceId: deviceId,
    fields: fields,
    reason: reason,
  );
}

/// In-memory fake for `API_MOCK_MODE`.
class MockConfigOverrideRepository implements ConfigOverrideRepository {
  DeviceConfigDraft _config = const DeviceConfigDraft(
    id: 'mock-config-override-1',
    name: 'GT06N · ตั้งค่ามาตรฐาน',
    deviceModel: 'GT06N',
    protocol: 'TCP',
    status: ConfigStatus.approved,
    fields: {
      'APN': 'internet',
      'REPORT_INTERVAL_MOVING': 30,
      'COMMAND_PASSWORD': '123456',
    },
  );

  final List<ConfigFieldDefinition> _definitions = const [
    ConfigFieldDefinition(
      id: 'mock-def-apn',
      fieldName: 'APN',
      dataType: 'string',
      allowedValues: [],
      required: true,
      stOverridable: true,
      sensitive: false,
      supportedModels: [
        ConfigFieldModelSupport(deviceModel: 'GT06N', protocol: 'TCP'),
      ],
    ),
    ConfigFieldDefinition(
      id: 'mock-def-interval',
      fieldName: 'REPORT_INTERVAL_MOVING',
      dataType: 'number',
      allowedValues: [],
      required: false,
      stOverridable: true,
      sensitive: false,
      unit: 'วินาที',
      supportedModels: [
        ConfigFieldModelSupport(deviceModel: 'GT06N', protocol: 'TCP'),
      ],
    ),
    ConfigFieldDefinition(
      id: 'mock-def-password',
      fieldName: 'COMMAND_PASSWORD',
      dataType: 'string',
      allowedValues: [],
      required: false,
      stOverridable: false,
      sensitive: true,
      supportedModels: [
        ConfigFieldModelSupport(deviceModel: 'GT06N', protocol: 'TCP'),
      ],
    ),
  ];

  @override
  Future<DeviceConfigDraft> getCurrentConfig(String deviceId) async {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    if (deviceId.trim().isEmpty) {
      throw ApiException(
        'อุปกรณ์นี้ยังไม่มี Config ที่ยืนยันติดตั้งแล้ว',
        statusCode: 404,
      );
    }
    return _config;
  }

  @override
  Future<List<ConfigFieldDefinition>> listDefinitions() async {
    await Future<void>.delayed(const Duration(milliseconds: 150));
    return List.unmodifiable(_definitions);
  }

  @override
  Future<DeviceConfigDraft> overrideConfig({
    required String deviceId,
    required Map<String, dynamic> fields,
    required String reason,
  }) async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    if (reason.trim().isEmpty) {
      throw ApiException(
        'กรอกเหตุผลก่อน override',
        statusCode: 400,
        details: const ['reason ห้ามว่าง'],
      );
    }
    final defByName = {for (final d in _definitions) d.fieldName: d};
    final errors = <String>[];
    for (final key in fields.keys) {
      final def = defByName[key];
      if (def == null) {
        errors.add('ไม่รู้จัก field "$key"');
      } else if (!def.stOverridable) {
        errors.add('field "$key" ไม่อนุญาตให้ override');
      }
    }
    if (errors.isNotEmpty) {
      throw ApiException(
        'ค่าที่ขอ override ไม่ผ่านการตรวจสอบ',
        statusCode: 400,
        details: errors,
      );
    }
    _config = DeviceConfigDraft(
      id: _config.id,
      name: _config.name,
      deviceModel: _config.deviceModel,
      protocol: _config.protocol,
      status: _config.status,
      fields: {...?_config.fields, ...fields},
      hasDeviceOverride: true,
    );
    return _config;
  }
}

final configOverrideRepositoryProvider = Provider<ConfigOverrideRepository>((
  ref,
) {
  if (AppConfig.apiMockMode) return MockConfigOverrideRepository();
  return ApiConfigOverrideRepository(ref.watch(apiClientProvider));
});

/// Config ปัจจุบันของอุปกรณ์ที่กำลังเปิดหน้า Override — key ด้วย `deviceId`
/// (`Device.deviceId`, เลขเครื่องจริง).
final currentConfigProvider = FutureProvider.autoDispose
    .family<DeviceConfigDraft, String>((ref, deviceId) {
      return ref
          .watch(configOverrideRepositoryProvider)
          .getCurrentConfig(deviceId);
    });

/// คลัง field definition ทั้งหมด — โหลดครั้งเดียวใช้ทั้งหน้า (mirror
/// `deployableConfigListProvider`/`useConfigDefinitions` ฝั่ง Web).
final configFieldDefinitionListProvider =
    FutureProvider.autoDispose<List<ConfigFieldDefinition>>((ref) {
      return ref.watch(configOverrideRepositoryProvider).listDefinitions();
    });
