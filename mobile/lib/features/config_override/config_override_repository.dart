import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';

/// Config Override — Phase 2 (Mobile, issue #211), per-device (issue #223).
/// ST อ่าน Config ปัจจุบันของอุปกรณ์แล้ว**ส่งคำขอ**แก้ค่าบาง field ที่
/// `stOverridable: true` — เขียนลง `DeviceConfigOverride` ผูกกับอุปกรณ์เครื่อง
/// นี้เท่านั้น ไม่กระทบอุปกรณ์อื่นที่ใช้ Config เดียวกัน **มติ 2026-09-24
/// (PR #225): ต้องผ่าน Operation อนุมัติก่อนถึงมีผลจริง** ไม่ใช่ apply ทันที
/// เหมือนที่เคยเป็น (mirror UX ของ
/// `web/src/app/(app)/config/config-override-panel.tsx` แต่ endpoint คนละตัว
/// กับที่ Web เรียก — ดู `overrideDeviceConfig`).
abstract class ConfigOverrideRepository {
  /// `GET /devices/{deviceId}/config`
  Future<DeviceConfigDraft> getCurrentConfig(String deviceId);

  /// `GET /config-definitions`
  Future<List<ConfigFieldDefinition>> listDefinitions();

  /// `POST /devices/{deviceId}/config-override` (issue #223) — **ไม่ใช่**
  /// `POST /config/{configId}/override` เดิม (issue #185) ที่ Web ยังใช้อยู่
  /// — endpoint นั้นแก้ Config ทั้งชุดทันที กระทบทุกอุปกรณ์ที่ใช้ Config
  /// เดียวกัน Mobile เปลี่ยนมาใช้ endpoint per-device นี้เท่านั้นตั้งแต่ #223
  /// — คืนคำขอสถานะ `pending` เสมอ (มติ 2026-09-24) ไม่ใช่ Config ที่ merge แล้ว
  Future<DeviceConfigOverride> overrideConfig({
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
  Future<DeviceConfigOverride> overrideConfig({
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
  final DeviceConfigDraft _config = const DeviceConfigDraft(
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

  /// คำขอที่ยัง pending ของ session นี้ — mirror `DeviceService
  /// .overrideDeviceConfig()` ฝั่ง backend: เครื่องหนึ่งมีคำขอ pending ได้
  /// ทีละ 1 รายการ (มติ 2026-09-24) ไม่มีทาง approve จาก Mobile ในรอบนี้
  /// (Operation อนุมัติผ่านช่องทางอื่น) จึงค้าง pending ต่อไปเรื่อยๆ ใน mock
  DeviceConfigOverride? _pending;
  int _nextVersion = 1;

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
    return DeviceConfigDraft(
      id: _config.id,
      name: _config.name,
      deviceModel: _config.deviceModel,
      protocol: _config.protocol,
      status: _config.status,
      fields: _config.fields,
      hasDeviceOverride: _config.hasDeviceOverride,
      pendingOverride: _pending,
    );
  }

  @override
  Future<List<ConfigFieldDefinition>> listDefinitions() async {
    await Future<void>.delayed(const Duration(milliseconds: 150));
    return List.unmodifiable(_definitions);
  }

  @override
  Future<DeviceConfigOverride> overrideConfig({
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
    if (_pending != null) {
      throw ApiException(
        'อุปกรณ์นี้มีคำขอ override ที่รอ Operation อนุมัติอยู่แล้ว — รอผลก่อนส่งคำขอใหม่',
        statusCode: 409,
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
    // มติ 2026-09-24 (PR #225): สร้างคำขอสถานะ pending เท่านั้น ไม่แก้
    // `_config` ทันทีเหมือนเดิม — ต้องรอ Operation อนุมัติก่อนถึงมีผลจริง
    final override = DeviceConfigOverride(
      id: 'mock-override-$_nextVersion',
      deviceId: deviceId,
      configId: _config.id ?? '',
      versionNumber: _nextVersion++,
      fields: {...?_config.fields, ...fields},
      reason: reason,
      status: 'pending',
      overriddenBy: 'mock-st-user',
      overriddenAt: DateTime.now().toIso8601String(),
    );
    _pending = override;
    return override;
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
