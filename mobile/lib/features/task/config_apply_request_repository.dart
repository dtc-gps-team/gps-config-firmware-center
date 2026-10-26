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

  Future<ConfigApplyRequest> create(String taskId);

  Future<ConfigApplyRequest> cancel(String requestId);

  /// ช่างกดส่งคำขอที่อนุมัติแล้วเข้ากล่อง (docs/27)
  Future<ConfigApplyRequest> release(String requestId);
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
  Future<ConfigApplyRequest> create(String taskId) =>
      _api.createConfigApplyRequest(taskId);

  @override
  Future<ConfigApplyRequest> cancel(String requestId) =>
      _api.cancelConfigApplyRequest(requestId);

  @override
  Future<ConfigApplyRequest> release(String requestId) =>
      _api.releaseConfigApplyRequest(requestId);
}

final configApplyRequestRepositoryProvider =
    Provider<ConfigApplyRequestRepository>(
      (ref) => ApiConfigApplyRequestRepository(ref.watch(apiClientProvider)),
    );

/// คำขอล่าสุดของงาน (`null` = ยังไม่เคยขอ) — การ์ด "ส่ง Config เข้าเครื่อง" ใน
/// Task Detail แสดงตามค่านี้ · invalidate หลังขอ/ยกเลิก
final latestConfigApplyRequestProvider = FutureProvider.autoDispose
    .family<ConfigApplyRequest?, String>((ref, taskId) async {
      final requests = await ref
          .watch(configApplyRequestRepositoryProvider)
          .listForTask(taskId);
      return requests.isEmpty ? null : requests.first;
    });
