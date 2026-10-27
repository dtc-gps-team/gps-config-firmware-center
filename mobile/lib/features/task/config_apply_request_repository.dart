import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider

/// "ขอส่ง Config เข้าเครื่อง" (docs/25) — แทนปุ่มเดิมที่เรียก
/// `POST /devices/{deviceId}/apply-config` (mock fire-and-forget) ด้วยคำขอที่
/// Operation **อีกคน** ต้องอนุมัติก่อน ระบบจึงส่งเข้ากล่องจริงผ่าน Rollout
/// เครื่องเดียว
abstract class ConfigApplyRequestRepository {
  /// คำขอทั้งหมดของงาน ใหม่สุดก่อน
  Future<List<ConfigApplyRequest>> listForTask(String taskId);

  /// [configId] = Config ที่ช่างเลือก (docs/28 §5.3) · `null` = ใช้ Config ที่
  /// Operation ผูกไว้กับงาน (พฤติกรรมเดิมของ docs/25)
  Future<ConfigApplyRequest> create(
    String taskId, {
    String? configId,
    String? note,
  });

  Future<ConfigApplyRequest> cancel(String requestId);

  /// ช่างกดส่งคำขอที่อนุมัติแล้วเข้ากล่อง (docs/27)
  Future<ConfigApplyRequest> release(String requestId);

  /// Config ที่ช่างเลือกส่งเข้ากล่องนี้ได้ (docs/28 §5.2)
  Future<DeviceApplyOptions> applyOptions(String deviceId);
}

/// เรียก backend จริงเสมอไม่ว่า `API_MOCK_MODE` จะเป็นอะไร — แบบเดียวกับปุ่ม
/// "ส่ง Config เข้าเครื่อง" เดิม: การขอมีความหมายกับ Task/Device/Config จริงเท่านั้น
/// และกดได้เฉพาะตอนออนไลน์ (docs/25 §3.3 — ไม่เข้าคิว offline)
class ApiConfigApplyRequestRepository implements ConfigApplyRequestRepository {
  ApiConfigApplyRequestRepository(this._api);

  final ApiClient _api;

  @override
  Future<List<ConfigApplyRequest>> listForTask(String taskId) =>
      _api.listTaskConfigApplyRequests(taskId);

  @override
  Future<ConfigApplyRequest> create(
    String taskId, {
    String? configId,
    String? note,
  }) => _api.createConfigApplyRequest(taskId, configId: configId, note: note);

  @override
  Future<ConfigApplyRequest> cancel(String requestId) =>
      _api.cancelConfigApplyRequest(requestId);

  @override
  Future<ConfigApplyRequest> release(String requestId) =>
      _api.releaseConfigApplyRequest(requestId);

  @override
  Future<DeviceApplyOptions> applyOptions(String deviceId) =>
      _api.getDeviceApplyOptions(deviceId);
}

final configApplyRequestRepositoryProvider =
    Provider<ConfigApplyRequestRepository>(
      (ref) => ApiConfigApplyRequestRepository(ref.watch(apiClientProvider)),
    );

/// คำขอทั้งหมดของงาน ใหม่สุดก่อน (docs/28 — งาน 1 ใบขอได้หลายครั้ง) ·
/// **invalidate ตัวนี้** หลังขอ/ยกเลิก/กดส่ง หรือตอน poll
final taskConfigApplyRequestsProvider = FutureProvider.autoDispose
    .family<List<ConfigApplyRequest>, String>(
      (ref, taskId) =>
          ref.watch(configApplyRequestRepositoryProvider).listForTask(taskId),
    );

/// คำขอล่าสุดของงาน (`null` = ยังไม่เคยขอ) — การ์ด "ส่ง Config เข้าเครื่อง" ใน
/// Task Detail แสดงตามค่านี้ · มาจาก [taskConfigApplyRequestsProvider]
final latestConfigApplyRequestProvider = FutureProvider.autoDispose
    .family<ConfigApplyRequest?, String>((ref, taskId) async {
      final requests = await ref.watch(
        taskConfigApplyRequestsProvider(taskId).future,
      );
      return requests.isEmpty ? null : requests.first;
    });

/// ตัวเลือก Config ของกล่อง (docs/28 §5.2) — หน้าเลือกอัปโหลด
final deviceApplyOptionsProvider = FutureProvider.autoDispose
    .family<DeviceApplyOptions, String>(
      (ref, deviceId) => ref
          .watch(configApplyRequestRepositoryProvider)
          .applyOptions(deviceId),
    );
