import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/config/app_config.dart';
import 'package:mobile/features/incident/incident_repository.dart';

class _RecordingIncidentRepository implements IncidentRepository {
  int listCalls = 0;

  @override
  Future<List<Incident>> listIncidents() async {
    listCalls++;
    return const [];
  }
}

void main() {
  group('incidentRepositoryProvider', () {
    test('picks the implementation from API_MOCK_MODE', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final repo = container.read(incidentRepositoryProvider);
      if (AppConfig.apiMockMode) {
        expect(repo, isA<MockIncidentRepository>());
      } else {
        expect(repo, isA<ApiIncidentRepository>());
      }
    });
  });

  group('incidentListProvider', () {
    test('hits the repository (no role gate)', () async {
      final repo = _RecordingIncidentRepository();
      final container = ProviderContainer(
        overrides: [incidentRepositoryProvider.overrideWithValue(repo)],
      );
      addTearDown(container.dispose);

      final incidents = await container.read(incidentListProvider.future);
      expect(incidents, isEmpty);
      expect(repo.listCalls, 1);
    });
  });

  group('MockIncidentRepository', () {
    test('listIncidents returns the seeded incidents', () async {
      final repo = MockIncidentRepository();
      final incidents = await repo.listIncidents();
      expect(incidents, isNotEmpty);
      expect(incidents.first.severity, isA<IncidentSeverity>());
      expect(incidents.first.status, isA<IncidentStatus>());
    });
  });
}
