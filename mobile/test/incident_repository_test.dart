import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
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

  @override
  Future<Incident> createFieldReport({
    required String title,
    required String description,
    required IncidentSeverity severity,
    String? deviceId,
  }) => throw UnimplementedError();

  @override
  Future<Incident> getIncident(String id) => throw UnimplementedError();
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

  group('MockIncidentRepository.createFieldReport (design issue #236)', () {
    test(
      'สร้าง field report: open + source field-report + อยู่ในรายการ',
      () async {
        final repo = MockIncidentRepository();

        final created = await repo.createFieldReport(
          title: '  ไม่ส่งสัญญาณ ',
          description: ' หลังติดตั้ง ',
          severity: IncidentSeverity.high,
          deviceId: 'DEV-0001',
        );

        expect(created.title, 'ไม่ส่งสัญญาณ'); // trim
        expect(created.description, 'หลังติดตั้ง');
        expect(created.status, IncidentStatus.open);
        expect(created.isFieldReport, isTrue);
        expect(created.deviceId, 'DEV-0001');
        expect(created.reportedBy, isNotNull);
        final all = await repo.listIncidents();
        expect(all.first.id, created.id);
        expect((await repo.getIncident(created.id)).title, 'ไม่ส่งสัญญาณ');
      },
    );

    test('title/description ว่าง -> 400 ไม่สร้าง', () async {
      final repo = MockIncidentRepository();
      final before = (await repo.listIncidents()).length;

      await expectLater(
        repo.createFieldReport(
          title: ' ',
          description: 'x',
          severity: IncidentSeverity.low,
        ),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 's', 400)),
      );
      await expectLater(
        repo.createFieldReport(
          title: 'x',
          description: '',
          severity: IncidentSeverity.low,
        ),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 's', 400)),
      );
      expect((await repo.listIncidents()).length, before);
    });
  });
}
