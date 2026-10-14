import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';

/// Reads the incident list for the "Incident" screen, and (design issue #236)
/// lets ST/OT file a field report.
///
/// `GET /incidents` is open to every logged-in role (RBAC "R" for all), so —
/// unlike [TaskRepository] — there is no client-side role gate. **Create**
/// (`createFieldReport`, `POST /incidents`) is ST/OT-only (RBAC `incidents`
/// `Create`, backend PR #267) — the server enforces it; the Home shortcut is
/// just a UI hint.
abstract class IncidentRepository {
  Future<List<Incident>> listIncidents();

  /// `POST /incidents` (issue #236, backend PR #267). ไม่
  /// auto-pause/rollback — Operation เป็นคนตัดสินใจ throws [ApiException].
  Future<Incident> createFieldReport({
    required String title,
    required String description,
    required IncidentSeverity severity,
    String? deviceId,
  });

  /// `GET /incidents/{id}` — throws [ApiException] (404) if not found.
  Future<Incident> getIncident(String id);
}

/// Talks to the real backend. Default outside `API_MOCK_MODE` — the Incident
/// read endpoints are live on `main` (PR #139).
class ApiIncidentRepository implements IncidentRepository {
  ApiIncidentRepository(this._api);

  final ApiClient _api;

  @override
  Future<List<Incident>> listIncidents() => _api.listIncidents();

  @override
  Future<Incident> getIncident(String id) => _api.getIncident(id);

  @override
  Future<Incident> createFieldReport({
    required String title,
    required String description,
    required IncidentSeverity severity,
    String? deviceId,
  }) => _api.createIncident(
    title: title,
    description: description,
    severity: severity,
    deviceId: deviceId,
  );
}

/// In-memory fake for `API_MOCK_MODE` (dev/demo without a backend). Same
/// pattern as [MockTaskRepository] / [MockDeviceSearchRepository].
class MockIncidentRepository implements IncidentRepository {
  // `source` มีแค่ 2 ค่าจริงที่ backend เขียน — 'field-report' (#236) และ
  // 'config-sync-writer' (auto-detect) ตามที่ตรวจไว้ใน PR #310 — ของเดิมมี
  // 'mobile-simulator-test' ที่ไม่มีอยู่จริง แก้เป็นค่าจริงไปด้วยตอนขยาย ·
  // deviceId ทุกตัวตรงกับ MockDeviceSearchRepository จริง (auto-detect ไม่มี
  // deviceId ตาม design เดิม — ผูกกับ Config ไม่ใช่อุปกรณ์)
  final List<Incident> _incidents = [
    Incident(
      id: 'mock-incident-1',
      title: 'เขียน Config เข้าระบบเดิมไม่สำเร็จ (v3)',
      description:
          'config-sync-writer เขียน Config เข้า config.dtc.co.th:909 '
          'ไม่สำเร็จหลัง retry 3 ครั้ง',
      severity: IncidentSeverity.high,
      status: IncidentStatus.open,
      source: 'config-sync-writer',
      relatedConfigId: 'mock-cfg-1',
      createdAt: DateTime(2026, 9, 9, 14, 30),
      updatedAt: DateTime(2026, 9, 9, 14, 30),
    ),
    Incident(
      id: 'mock-incident-2',
      title: 'เครื่องรีบูตเองทุก 10 นาที',
      description: 'ช่างแจ้งว่าเครื่องรีสตาร์ทเองหลังติดตั้งไม่ถึงวัน',
      severity: IncidentSeverity.medium,
      status: IncidentStatus.investigating,
      source: 'field-report',
      deviceId: 'DEV-0092',
      reportedBy: 'mock-st-user',
      reviewedBy: 'mock-operation-user',
      reviewedAt: DateTime(2026, 9, 6, 10, 0),
      reviewNote: 'ต้องอัปเดต Firmware — ส่งต่อเป็น Campaign แล้ว',
      createdAt: DateTime(2026, 9, 5, 9, 12),
      updatedAt: DateTime(2026, 9, 6, 10, 0),
    ),
    Incident(
      id: 'mock-incident-3',
      title: 'ปุ่ม SOS กดแล้วไม่ส่งแจ้งเตือน',
      severity: IncidentSeverity.critical,
      status: IncidentStatus.open,
      source: 'field-report',
      deviceId: 'DEV-0231',
      reportedBy: 'mock-ot-user',
      // ยังไม่ถูกตัดสินใจ — reviewedBy/reviewedAt/reviewNote ว่างทั้งหมด
      // (ทดสอบว่าไม่มีการ์ด "ผลการตรวจสอบ" โผล่มา)
      createdAt: DateTime(2026, 9, 8, 13, 0),
      updatedAt: DateTime(2026, 9, 8, 13, 0),
    ),
    Incident(
      id: 'mock-incident-4',
      title: 'สายไฟหลวม ไฟกระพริบเป็นระยะ',
      severity: IncidentSeverity.high,
      status: IncidentStatus.resolved,
      source: 'field-report',
      deviceId: 'DEV-0305',
      reportedBy: 'mock-st-user',
      reviewedBy: 'mock-operation-user',
      reviewedAt: DateTime(2026, 9, 4, 16, 45),
      reviewNote: 'ช่างเข้าไปขันสายใหม่แล้ว ใช้งานปกติ',
      createdAt: DateTime(2026, 9, 3, 9, 0),
      updatedAt: DateTime(2026, 9, 4, 16, 45),
    ),
    Incident(
      id: 'mock-incident-5',
      title: 'แจ้งซ้ำกับรายงานก่อนหน้า',
      severity: IncidentSeverity.low,
      status: IncidentStatus.dismissed,
      source: 'field-report',
      deviceId: 'DEV-0410',
      reportedBy: 'mock-ot-user',
      reviewedBy: 'mock-operation-user',
      reviewedAt: DateTime(2026, 9, 2, 11, 30),
      reviewNote: 'ซ้ำกับรายการเดิม',
      createdAt: DateTime(2026, 9, 2, 8, 0),
      updatedAt: DateTime(2026, 9, 2, 11, 30),
    ),
    Incident(
      id: 'mock-incident-6',
      title: 'Rollback Config หลัง Rollout ล้มเหลวเกิน 5%',
      description: 'Auto Pause trigger แล้ว Operation สั่ง Rollback กลับ',
      severity: IncidentSeverity.medium,
      status: IncidentStatus.rolledBack,
      source: 'config-sync-writer',
      relatedConfigId: 'mock-cfg-2',
      createdAt: DateTime(2026, 8, 28, 15, 0),
      updatedAt: DateTime(2026, 8, 29, 9, 0),
    ),
  ];

  @override
  Future<List<Incident>> listIncidents() async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return List.unmodifiable(_incidents);
  }

  /// mirror ที่ design #236 ให้ backend ทำ: `status: open`,
  /// `source: 'field-report'`, `reportedBy` จาก JWT (mock ใช้ค่าคงที่) ·
  /// title/description บังคับ (backend คืน 400)
  @override
  Future<Incident> createFieldReport({
    required String title,
    required String description,
    required IncidentSeverity severity,
    String? deviceId,
  }) async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    if (title.trim().isEmpty || description.trim().isEmpty) {
      throw ApiException(
        'ต้องกรอกหัวข้อและรายละเอียดปัญหา',
        statusCode: 400,
        details: const ['title/description ห้ามว่าง'],
      );
    }
    final now = DateTime.now();
    final incident = Incident(
      id: 'mock-field-report-${_incidents.length + 1}',
      title: title.trim(),
      description: description.trim(),
      severity: severity,
      status: IncidentStatus.open,
      source: 'field-report',
      reportedBy: 'mock-st-user',
      deviceId: deviceId,
      createdAt: now,
      updatedAt: now,
    );
    _incidents.insert(0, incident);
    return incident;
  }

  @override
  Future<Incident> getIncident(String id) async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return _incidents.firstWhere(
      (i) => i.id == id,
      orElse: () => throw ApiException('ไม่พบ Incident นี้', statusCode: 404),
    );
  }
}

final incidentRepositoryProvider = Provider<IncidentRepository>((ref) {
  if (AppConfig.apiMockMode) return MockIncidentRepository();
  return ApiIncidentRepository(ref.watch(apiClientProvider));
});

/// The incident list. Every role may call `GET /incidents` (no role gate,
/// unlike `taskListProvider`).
final incidentListProvider = FutureProvider.autoDispose<List<Incident>>((ref) {
  return ref.watch(incidentRepositoryProvider).listIncidents();
});

/// One incident for the detail screen (`GET /incidents/{id}`).
final incidentDetailProvider = FutureProvider.autoDispose
    .family<Incident, String>(
      (ref, id) => ref.watch(incidentRepositoryProvider).getIncident(id),
    );
