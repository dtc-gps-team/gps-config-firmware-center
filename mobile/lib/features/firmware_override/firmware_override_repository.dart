import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';

/// Firmware Override — Phase 2 (Mobile, issue #256), per-device (PR #257).
/// ST **ส่งคำขอ**ให้อุปกรณ์เครื่องนี้ติดตั้ง Firmware ตัวที่เลือกได้ แม้ไม่ตรง
/// กับแผน Campaign Rollout ที่ `active` กำหนดไว้ — ต้องผ่าน Operation อนุมัติ
/// ก่อน และใช้ได้ครั้งเดียว (single-use) mirror `config_override/` แต่ง่ายกว่า:
/// Firmware เป็นเวอร์ชันเดียวทั้งก้อน ไม่มี `fields` ให้แก้
abstract class FirmwareOverrideRepository {
  /// `GET /firmware`
  Future<List<Firmware>> listFirmware();

  /// `POST /devices/{deviceId}/firmware-override` — คืนคำขอสถานะ `pending`
  /// เสมอ (409 = Firmware ติดตั้งไม่ได้ หรือมีคำขอ pending อยู่แล้ว)
  Future<DeviceFirmwareOverride> overrideFirmware({
    required String deviceId,
    required String firmwareId,
    required String reason,
  });
}

/// Talks to the real backend.
class ApiFirmwareOverrideRepository implements FirmwareOverrideRepository {
  ApiFirmwareOverrideRepository(this._api);

  final ApiClient _api;

  @override
  Future<List<Firmware>> listFirmware() => _api.listFirmware();

  @override
  Future<DeviceFirmwareOverride> overrideFirmware({
    required String deviceId,
    required String firmwareId,
    required String reason,
  }) => _api.overrideDeviceFirmware(
    deviceId: deviceId,
    firmwareId: firmwareId,
    reason: reason,
  );
}

/// In-memory fake for `API_MOCK_MODE`.
class MockFirmwareOverrideRepository implements FirmwareOverrideRepository {
  static const _firmware = [
    Firmware(
      id: 'mock-fw-1',
      version: '2.1.0',
      deviceModelCompatibility: ['GT06N'],
      uploadStatus: 'stored',
      approvalStatus: 'approved',
    ),
    Firmware(
      id: 'mock-fw-2',
      version: '2.0.3',
      deviceModelCompatibility: ['GT06N', 'TK103'],
      uploadStatus: 'stored',
      approvalStatus: 'approved',
    ),
    Firmware(
      id: 'mock-fw-3',
      version: '2.2.0-rc1',
      deviceModelCompatibility: ['GT06N'],
      uploadStatus: 'stored',
      approvalStatus: 'pending_review',
    ),
  ];

  /// mirror backend: เครื่องหนึ่งมีคำขอ pending ได้ทีละ 1 รายการ — mock ไม่มี
  /// ทาง approve (Operation อนุมัติบน Web) จึงค้าง pending ใน session นี้
  DeviceFirmwareOverride? _pending;
  int _nextVersion = 1;

  @override
  Future<List<Firmware>> listFirmware() async {
    await Future<void>.delayed(const Duration(milliseconds: 150));
    return List.unmodifiable(_firmware);
  }

  @override
  Future<DeviceFirmwareOverride> overrideFirmware({
    required String deviceId,
    required String firmwareId,
    required String reason,
  }) async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    if (reason.trim().isEmpty) {
      throw ApiException(
        'กรอกเหตุผลก่อนส่งคำขอ',
        statusCode: 400,
        details: const ['reason ห้ามว่าง'],
      );
    }
    final matches = _firmware.where((f) => f.id == firmwareId);
    if (matches.isEmpty) {
      throw ApiException('ไม่พบ Firmware นี้', statusCode: 404);
    }
    if (_pending != null) {
      throw ApiException(
        'อุปกรณ์นี้มีคำขอ override ที่รอ Operation อนุมัติอยู่แล้ว — รอผลก่อนส่งคำขอใหม่',
        statusCode: 409,
      );
    }
    if (!matches.first.isInstallableOn('')) {
      throw ApiException(
        'Firmware สถานะอนุมัติคุณภาพปัจจุบัน (${matches.first.approvalStatus}) ยังยืนยันติดตั้งไม่ได้',
        statusCode: 409,
      );
    }
    final override = DeviceFirmwareOverride(
      id: 'mock-fw-override-$_nextVersion',
      deviceId: deviceId,
      firmwareId: firmwareId,
      versionNumber: _nextVersion++,
      reason: reason,
      status: 'pending',
      overriddenBy: 'mock-st-user',
      overriddenAt: DateTime.now().toIso8601String(),
    );
    _pending = override;
    return override;
  }
}

final firmwareOverrideRepositoryProvider = Provider<FirmwareOverrideRepository>(
  (ref) {
    if (AppConfig.apiMockMode) return MockFirmwareOverrideRepository();
    return ApiFirmwareOverrideRepository(ref.watch(apiClientProvider));
  },
);

/// รายการ Firmware ทั้งหมด — โหลดครั้งเดียวใช้ทั้งหน้า
final firmwareListProvider = FutureProvider.autoDispose<List<Firmware>>((ref) {
  return ref.watch(firmwareOverrideRepositoryProvider).listFirmware();
});
