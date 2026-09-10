import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/incident/incident_list_page.dart';
import 'package:mobile/features/incident/incident_repository.dart';

Incident _incident({
  String id = 'inc-1',
  String title = 'เขียน Config ไม่สำเร็จ',
  IncidentSeverity severity = IncidentSeverity.high,
  IncidentStatus status = IncidentStatus.open,
}) => Incident(
  id: id,
  title: title,
  severity: severity,
  status: status,
  source: 'config-sync-writer',
  createdAt: DateTime(2026, 9, 9, 14, 30),
  updatedAt: DateTime(2026, 9, 9, 14, 30),
);

class _FakeIncidentRepository implements IncidentRepository {
  _FakeIncidentRepository({List<Incident>? incidents, this.listError})
    : _incidents = incidents ?? [_incident()];

  final List<Incident> _incidents;
  final Object? listError;

  int listCalls = 0;

  @override
  Future<List<Incident>> listIncidents() async {
    listCalls++;
    if (listError != null) throw listError!;
    return _incidents;
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required IncidentRepository repo,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [incidentRepositoryProvider.overrideWithValue(repo)],
      child: const MaterialApp(home: IncidentListPage()),
    ),
  );
  await tester.pump(); // resolve listIncidents
}

void main() {
  testWidgets('loading -> list ของ incident จาก repository', (tester) async {
    await _pump(
      tester,
      repo: _FakeIncidentRepository(
        incidents: [
          _incident(id: 'inc-1', title: 'A'),
          _incident(id: 'inc-2', title: 'B'),
        ],
      ),
    );

    expect(find.text('A'), findsOneWidget);
    expect(find.text('B'), findsOneWidget);
    expect(find.byKey(const Key('incident_card_0')), findsOneWidget);
    expect(find.byKey(const Key('incident_card_1')), findsOneWidget);
    // read-only — ไม่มีปุ่มสร้าง/แก้ไข (FAB หรือ edit icon)
    expect(find.byType(FloatingActionButton), findsNothing);
  });

  testWidgets('severity label ครบ 4 กรณี', (tester) async {
    await _pump(
      tester,
      repo: _FakeIncidentRepository(
        incidents: [
          _incident(
            id: 'c',
            title: 'crit',
            severity: IncidentSeverity.critical,
          ),
          _incident(id: 'h', title: 'high', severity: IncidentSeverity.high),
          _incident(id: 'm', title: 'med', severity: IncidentSeverity.medium),
          _incident(id: 'l', title: 'low', severity: IncidentSeverity.low),
        ],
      ),
    );

    expect(find.text('วิกฤต'), findsOneWidget);
    expect(find.text('สูง'), findsOneWidget);
    expect(find.text('ปานกลาง'), findsOneWidget);
    expect(find.text('ต่ำ'), findsOneWidget);
  });

  testWidgets('status label ภาษาไทยครบ 4 กรณี', (tester) async {
    await _pump(
      tester,
      repo: _FakeIncidentRepository(
        incidents: [
          _incident(id: 'o', title: 'o', status: IncidentStatus.open),
          _incident(id: 'i', title: 'i', status: IncidentStatus.investigating),
          _incident(id: 'r', title: 'r', status: IncidentStatus.rolledBack),
          _incident(id: 'x', title: 'x', status: IncidentStatus.resolved),
        ],
      ),
    );

    expect(find.text('เปิดอยู่'), findsOneWidget);
    expect(find.text('กำลังตรวจสอบ'), findsOneWidget);
    expect(find.text('Rollback แล้ว'), findsOneWidget);
    expect(find.text('แก้ไขแล้ว'), findsOneWidget);
  });

  testWidgets('ไม่มี incident -> empty state', (tester) async {
    await _pump(tester, repo: _FakeIncidentRepository(incidents: const []));

    expect(find.byKey(const Key('incidents_empty')), findsOneWidget);
    expect(find.text('ยังไม่มี Incident'), findsOneWidget);
  });

  testWidgets('error -> error card + ปุ่มลองอีกครั้ง (กดแล้วยิงซ้ำ)', (
    tester,
  ) async {
    final repo = _FakeIncidentRepository(
      listError: ApiException('เซิร์ฟเวอร์ล่ม', statusCode: 500),
    );
    await _pump(tester, repo: repo);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('incidents_error')), findsOneWidget);
    expect(find.text('เซิร์ฟเวอร์ล่ม'), findsOneWidget);
    expect(repo.listCalls, 1);

    await tester.tap(find.byKey(const Key('incidents_retry')));
    await tester.pump();
    expect(repo.listCalls, 2);
  });

  testWidgets('pull-to-refresh -> เรียก repository ใหม่', (tester) async {
    final repo = _FakeIncidentRepository(incidents: [_incident()]);
    await _pump(tester, repo: repo);
    expect(repo.listCalls, 1);

    await tester.fling(
      find.byKey(const Key('incident_card_0')),
      const Offset(0, 400),
      1000,
    );
    await tester.pumpAndSettle();

    expect(repo.listCalls, 2);
  });
}
