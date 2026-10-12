import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider

/// "ยืนยันติดตั้ง Firmware" (issue #261) — ST/OT ยืนยันว่าติดตั้ง Firmware เข้า
/// อุปกรณ์เสร็จแล้วผ่าน `POST /devices/{deviceId}/confirm-firmware-install`
/// endpoint นี้ **ไม่ได้ส่งอะไรไปที่อุปกรณ์** แค่บันทึก AuditLog (ระบบเป็น PULL
/// model) และไม่คำนวณ `Firmware.deviceUpdateStatus`.
abstract class ConfirmFirmwareInstallRepository {
  /// [rolloutId] = `DeviceStatus.firmwareRolloutId` (issue #265) — ส่งเฉพาะตอน
  /// มีค่า
  Future<ConfirmFirmwareInstallResult> confirm({
    required String deviceId,
    required String firmwareId,
    String? rolloutId,
  });
}

/// Talks to the real backend. No mock implementation — same reasoning as
/// `ApiConfirmInstallRepository`: the action only makes sense against a real
/// Device/Firmware record.
class ApiConfirmFirmwareInstallRepository
    implements ConfirmFirmwareInstallRepository {
  ApiConfirmFirmwareInstallRepository(this._api);

  final ApiClient _api;

  @override
  Future<ConfirmFirmwareInstallResult> confirm({
    required String deviceId,
    required String firmwareId,
    String? rolloutId,
  }) => _api.confirmFirmwareInstall(
    deviceId: deviceId,
    firmwareId: firmwareId,
    rolloutId: rolloutId,
  );
}

final confirmFirmwareInstallRepositoryProvider =
    Provider<ConfirmFirmwareInstallRepository>(
      (ref) =>
          ApiConfirmFirmwareInstallRepository(ref.watch(apiClientProvider)),
    );

/// 409 ของ `confirm-firmware-install` ที่แปลว่า "Firmware ไม่ตรงแผน Campaign
/// และไม่มี override ที่ใช้ได้" — ทางออกคือขอ Firmware Override. Backend ไม่มี
/// error code แยก (ทุก 409 เป็นแค่ข้อความ) จึงแยกจากข้อความที่ backend ส่ง:
/// ทั้งกรณี "ไม่ตรงแผน" และ "override ถูกใช้ไปแล้ว" ลงท้ายด้วยการให้ "ขอ
/// Firmware Override" ส่วน 409 อื่น (Device ยังไม่ installed, Firmware ยังไม่
/// approved ฯลฯ) ไม่พูดถึง override เลย · ถ้า backend เปลี่ยนข้อความ ปุ่มลิงก์
/// จะไม่ขึ้น (ข้อความ error ยังแสดงตามปกติ — ไม่เสียหาย)
bool isFirmwareGateConflict(ApiException e) =>
    e.statusCode == 409 && e.message.contains('Firmware Override');
