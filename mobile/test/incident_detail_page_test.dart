import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/incident/incident_detail_page.dart';
import 'package:mobile/features/incident/incident_list_page.dart';
import 'package:mobile/features/incident/incident_repository.dart';

Incident _incident({
  String id = 'inc-1',
  String title = 'เขียน Config ไม่สำเร็จ',
  String? description = 'config-sync-writer เขียนไม่สำเร็จหลัง retry 3 ครั้ง',
  String? source = 'config-sync-writer',
  String? relatedConfigId = 'cfg-123',
  String? relatedFirmwareId,
  Map<String, dynamic>? metadata,
}) => Incident(
  id: id,
  title: title,
  description: description,
  severity: IncidentSeverity.high,
  status: IncidentStatus.investigating,
  source: source,
  relatedConfigId: relatedConfigId,
  relatedFirmwareId: relatedFirmwareId,
  metadata: metadata,
  createdAt: DateTime(2026, 9, 9, 14, 30),
  updatedAt: DateTime(2026, 9, 10, 8, 5),
);

class _FakeIncidentRepository implements IncidentRepository {
  _FakeIncidentRepository({List<Incident>? incidents, this.detailError})
    : _incidents = incidents ?? [_incident()];

  final List<Incident> _incidents;
  Object? detailError;
  final List<String> detailCalls = [];

  @override
  Future<List<Incident>> listIncidents() async => _incidents;

  @override
  Future<Incident> createFieldReport({
    required String title,
    required String description,
    required IncidentSeverity severity,
    String? deviceId,
  }) => throw UnimplementedError();

  @override
  Future<Incident> getIncident(String id) async {
    detailCalls.add(id);
    if (detailError != null) throw detailError!;
    return _incidents.firstWhere((i) => i.id == id);
  }
}

Future<void> _pumpDetail(
  WidgetTester tester,
  IncidentRepository repo, {
  String id = 'inc-1',
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [incidentRepositoryProvider.overrideWithValue(repo)],
      child: MaterialApp(home: IncidentDetailPage(incidentId: id)),
    ),
  );
  await tester.pump(); // resolve getIncident
}

void main() {
  group('IncidentDetailPage', () {
    testWidgets('loading -> แสดงข้อมูลจาก response', (tester) async {
      final repo = _FakeIncidentRepository(
        incidents: [
          _incident(
            relatedFirmwareId: 'fw-9',
            metadata: {'retries': 3, 'host': 'config.dtc.co.th'},
          ),
        ],
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [incidentRepositoryProvider.overrideWithValue(repo)],
          child: const MaterialApp(
            home: IncidentDetailPage(incidentId: 'inc-1'),
          ),
        ),
      );
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      await tester.pump();

      expect(repo.detailCalls, ['inc-1']);
      expect(find.text('เขียน Config ไม่สำเร็จ'), findsOneWidget);
      expect(
        find.text('config-sync-writer เขียนไม่สำเร็จหลัง retry 3 ครั้ง'),
        findsOneWidget,
      );
      expect(find.text('สูง'), findsOneWidget);
      expect(find.text('กำลังตรวจสอบ'), findsOneWidget);
      expect(find.text('config-sync-writer'), findsOneWidget);
      expect(find.text('cfg-123'), findsOneWidget);
      expect(find.text('fw-9'), findsOneWidget);
      expect(find.text('09/09/2026 14:30'), findsOneWidget);
      expect(find.text('10/09/2026 08:05'), findsOneWidget);
      // metadata: string as-is, non-string JSON-encoded
      expect(find.byKey(const Key('incident_detail_metadata')), findsOneWidget);
      expect(find.text('retries'), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
      expect(find.text('config.dtc.co.th'), findsOneWidget);
    });

    testWidgets(
      'field ที่ไม่มีค่า -> "-" / ไม่มีรายละเอียด, ไม่มีการ์ด metadata',
      (tester) async {
        await _pumpDetail(
          tester,
          _FakeIncidentRepository(
            incidents: [
              _incident(
                description: null,
                source: null,
                relatedConfigId: null,
                metadata: const {},
              ),
            ],
          ),
        );

        expect(find.text('ไม่มีรายละเอียด'), findsOneWidget);
        expect(
          tester
              .widget<Text>(find.byKey(const Key('incident_detail_source')))
              .data,
          '-',
        );
        expect(find.byKey(const Key('incident_detail_metadata')), findsNothing);
      },
    );

    testWidgets('404 -> ข้อความ "ไม่พบ Incident นี้" ไม่ crash', (
      tester,
    ) async {
      await _pumpDetail(
        tester,
        _FakeIncidentRepository(
          detailError: ApiException('Not Found', statusCode: 404),
        ),
      );

      expect(find.text('ไม่พบ Incident นี้'), findsOneWidget);
      expect(find.byKey(const Key('incident_detail_retry')), findsOneWidget);
    });

    testWidgets('error อื่น -> ข้อความจาก ApiException, retry โหลดซ้ำสำเร็จ', (
      tester,
    ) async {
      final repo = _FakeIncidentRepository(
        detailError: ApiException('เซิร์ฟเวอร์ขัดข้อง', statusCode: 500),
      );
      await _pumpDetail(tester, repo);

      expect(find.text('เซิร์ฟเวอร์ขัดข้อง'), findsOneWidget);

      repo.detailError = null;
      await tester.tap(find.byKey(const Key('incident_detail_retry')));
      await tester.pump();
      await tester.pump();

      expect(repo.detailCalls.length, 2);
      expect(find.text('เขียน Config ไม่สำเร็จ'), findsOneWidget);
      expect(find.byKey(const Key('incident_detail_error')), findsNothing);
    });

    testWidgets('error ที่ไม่ใช่ ApiException -> ข้อความ fallback', (
      tester,
    ) async {
      await _pumpDetail(
        tester,
        _FakeIncidentRepository(detailError: StateError('boom')),
      );

      expect(find.text('โหลดรายละเอียด Incident ไม่สำเร็จ'), findsOneWidget);
    });
  });

  group('แตะการ์ดในรายการ', () {
    Future<_FakeIncidentRepository> pumpApp(WidgetTester tester) async {
      final repo = _FakeIncidentRepository(
        incidents: [
          _incident(id: 'inc-1', title: 'A'),
          _incident(id: 'inc-2', title: 'B', description: 'รายละเอียดของ B'),
        ],
      );
      final router = GoRouter(
        initialLocation: AppRoutes.incidents,
        routes: [
          GoRoute(
            path: AppRoutes.incidents,
            builder: (_, _) => const IncidentListPage(),
          ),
          GoRoute(
            path: AppRoutes.incidentDetailPattern,
            builder: (_, state) =>
                IncidentDetailPage(incidentId: state.pathParameters['id']!),
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [incidentRepositoryProvider.overrideWithValue(repo)],
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pump();
      return repo;
    }

    testWidgets('แตะการ์ด -> เปิดหน้า detail ของ incident นั้น', (
      tester,
    ) async {
      final repo = await pumpApp(tester);
      expect(find.text('รายการ Incident'), findsOneWidget);

      await tester.tap(find.byKey(const Key('incident_card_1')));
      await tester.pumpAndSettle();

      expect(find.text('รายละเอียด Incident'), findsOneWidget);
      expect(repo.detailCalls, ['inc-2']);
      expect(find.byKey(const Key('incident_detail_title')), findsOneWidget);
      expect(
        tester
            .widget<Text>(find.byKey(const Key('incident_detail_title')))
            .data,
        'B',
      );
    });

    testWidgets('การ์ดโชว์ description ย่อ 2 บรรทัด', (tester) async {
      await pumpApp(tester);

      final text = tester.widget<Text>(find.text('รายละเอียดของ B'));
      expect(text.maxLines, 2);
      expect(text.overflow, TextOverflow.ellipsis);
    });
  });
}
