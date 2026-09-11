import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';

/// Reads the incident list for the "Incident" screen (read-only).
///
/// `GET /incidents` is open to every logged-in role (RBAC "R" for all), so —
/// unlike [TaskRepository] — there is no client-side role gate. No create /
/// update: field staff (ST/OT) have no Create permission (see RBAC_Matrix.md).
abstract class IncidentRepository {
  Future<List<Incident>> listIncidents();
}

/// Talks to the real backend. Default outside `API_MOCK_MODE` — the Incident
/// read endpoints are live on `main` (PR #139).
class ApiIncidentRepository implements IncidentRepository {
  ApiIncidentRepository(this._api);

  final ApiClient _api;

  @override
  Future<List<Incident>> listIncidents() => _api.listIncidents();
}

/// In-memory fake for `API_MOCK_MODE` (dev/demo without a backend). Same
/// pattern as [MockTaskRepository] / [MockDeviceSearchRepository].
class MockIncidentRepository implements IncidentRepository {
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
      title: 'ทดสอบสัญญาณอุปกรณ์หน้างานไม่ผ่าน',
      severity: IncidentSeverity.medium,
      status: IncidentStatus.resolved,
      source: 'mobile-simulator-test',
      createdAt: DateTime(2026, 9, 5, 9, 12),
      updatedAt: DateTime(2026, 9, 6, 10, 0),
    ),
  ];

  @override
  Future<List<Incident>> listIncidents() async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return List.unmodifiable(_incidents);
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
