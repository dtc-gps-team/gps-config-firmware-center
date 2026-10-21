import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/core/ui/app_badge.dart';
import 'package:mobile/core/ui/app_card.dart';
import 'package:mobile/core/ui/app_empty_state.dart';
import 'package:mobile/core/ui/app_page_header.dart';
import 'package:mobile/core/ui/app_skeleton.dart';
import 'package:mobile/core/ui/app_v2_theme.dart';
import 'package:mobile/features/incident/incident_list_page.dart';
import 'package:mobile/features/incident/incident_repository.dart';

Incident _incident({
  String id = 'inc-1',
  String title = 'เขียน Config ไม่สำเร็จ',
  IncidentSeverity severity = IncidentSeverity.high,
  IncidentStatus status = IncidentStatus.open,
  String? source = 'config-sync-writer',
  String? deviceId,
}) => Incident(
  id: id,
  title: title,
  severity: severity,
  status: status,
  source: source,
  deviceId: deviceId,
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

  @override
  Future<Incident> createFieldReport({
    required String title,
    required String description,
    required IncidentSeverity severity,
    String? deviceId,
  }) => throw UnimplementedError();

  @override
  Future<Incident> getIncident(String id) async =>
      _incidents.firstWhere((i) => i.id == id);
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

class _FixedAuth extends AuthController {
  _FixedAuth(this._role);

  final UserRole _role;

  @override
  AuthState build() => AuthState(status: AuthStatus.authenticated, role: _role);
}

Future<void> _pumpRouted(
  WidgetTester tester, {
  required IncidentRepository repo,
  UserRole? role,
}) async {
  final router = GoRouter(
    initialLocation: AppRoutes.incidents,
    routes: [
      GoRoute(
        path: AppRoutes.incidents,
        builder: (_, _) => const IncidentListPage(),
      ),
      GoRoute(
        path: AppRoutes.incidentDetailPattern,
        builder: (_, state) => Scaffold(
          body: Text('INCIDENT_DETAIL_STUB ${state.pathParameters['id']}'),
        ),
      ),
      GoRoute(
        path: AppRoutes.deviceDetailPattern,
        builder: (_, state) => Scaffold(
          body: Text('DEVICE_DETAIL_STUB ${state.pathParameters['deviceId']}'),
        ),
      ),
      GoRoute(
        path: AppRoutes.incidentReport,
        builder: (_, _) => const Scaffold(body: Text('FIELD_REPORT_STUB')),
      ),
    ],
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        incidentRepositoryProvider.overrideWithValue(repo),
        if (role != null)
          authControllerProvider.overrideWith(() => _FixedAuth(role)),
      ],
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pump();
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

  testWidgets('severity label ครบ 4 กรณี (อังกฤษตาม Web — docs/22 §6.1)', (
    tester,
  ) async {
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

    expect(find.text('Critical'), findsOneWidget);
    expect(find.text('High'), findsOneWidget);
    expect(find.text('Medium'), findsOneWidget);
    expect(find.text('Low'), findsOneWidget);
    // ป้ายเป็น AppBadge พร้อม dot และ tone ตาม docs/22 §5.2
    final crit = tester.widget<AppBadge>(
      find.widgetWithText(AppBadge, 'Critical'),
    );
    expect(crit.tone, AppBadgeTone.danger);
    expect(crit.dot, isTrue);
  });

  testWidgets('status label ครบ 5 กรณี (ตาม Web — docs/22 §6.1)', (
    tester,
  ) async {
    await _pump(
      tester,
      repo: _FakeIncidentRepository(
        incidents: [
          _incident(id: 'o', title: 'o', status: IncidentStatus.open),
          _incident(id: 'i', title: 'i', status: IncidentStatus.investigating),
          _incident(id: 'r', title: 'r', status: IncidentStatus.rolledBack),
          _incident(id: 'x', title: 'x', status: IncidentStatus.resolved),
          _incident(id: 'd', title: 'd', status: IncidentStatus.dismissed),
        ],
      ),
    );

    expect(find.text('Open'), findsOneWidget);
    expect(find.text('Investigating'), findsOneWidget);
    expect(find.text('Rollback แล้ว'), findsOneWidget);
    expect(find.text('Resolved'), findsOneWidget);
    expect(
      tester.widget<AppBadge>(find.widgetWithText(AppBadge, 'Open')).tone,
      AppBadgeTone.danger,
    );
    // การ์ดใบที่ 5 อยู่นอกจอ (ListView สร้างแบบ lazy) — เลื่อนลงก่อน
    await tester.scrollUntilVisible(
      find.text('ไม่ต้องดำเนินการ'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('ไม่ต้องดำเนินการ'), findsOneWidget);
  });

  group('design system ใหม่ (docs/22 Batch 2)', () {
    testWidgets('theme v2 + AppPageHeader ชื่อ "Incidents" แทน AppBar', (
      tester,
    ) async {
      await _pump(tester, repo: _FakeIncidentRepository());

      expect(find.byType(AppBar), findsNothing);
      expect(find.byType(AppV2Theme), findsOneWidget);
      expect(find.widgetWithText(AppPageHeader, 'Incidents'), findsOneWidget);
      expect(find.byType(AppCard), findsOneWidget);
    });

    testWidgets('กำลังโหลดครั้งแรก -> AppListSkeleton (ไม่ใช่ spinner)', (
      tester,
    ) async {
      final completer = Completer<List<Incident>>();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            incidentListProvider.overrideWith((ref) => completer.future),
          ],
          child: const MaterialApp(home: IncidentListPage()),
        ),
      );
      await tester.pump();

      expect(find.byType(AppListSkeleton), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      completer.complete(const []);
      await tester.pump();
    });

    testWidgets('ลิงก์เลขอุปกรณ์มีพื้นที่กดสูงขึ้น ≥ 40 (docs/21 #18)', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeIncidentRepository(
          incidents: [_incident(deviceId: 'DEV-0092')],
        ),
      );

      final link = find.ancestor(
        of: find.byKey(const Key('incident_card_device_0')),
        matching: find.byType(InkWell),
      );
      expect(tester.getSize(link.first).height, greaterThanOrEqualTo(40));
    });
  });

  testWidgets('ไม่มี incident -> empty state', (tester) async {
    await _pump(tester, repo: _FakeIncidentRepository(incidents: const []));

    expect(find.byKey(const Key('incidents_empty')), findsOneWidget);
    expect(find.text('ยังไม่มี Incident'), findsOneWidget);
    expect(find.byType(AppEmptyState), findsOneWidget);
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

  group('deviceId + source บนการ์ด (gap จาก Mobile UX/UI audit report)', () {
    testWidgets('มี deviceId -> แสดงเลขอุปกรณ์', (tester) async {
      await _pump(
        tester,
        repo: _FakeIncidentRepository(
          incidents: [_incident(deviceId: 'DEV-0103')],
        ),
      );

      expect(find.text('DEV-0103'), findsOneWidget);
    });

    testWidgets('ไม่มี deviceId -> ไม่แสดงแถวอุปกรณ์เลย', (tester) async {
      await _pump(
        tester,
        repo: _FakeIncidentRepository(incidents: [_incident(deviceId: null)]),
      );

      expect(find.byKey(const Key('incident_card_device_0')), findsNothing);
    });

    testWidgets('source field-report -> แสดง "แจ้งจากหน้างาน"', (tester) async {
      await _pump(
        tester,
        repo: _FakeIncidentRepository(
          incidents: [_incident(source: 'field-report')],
        ),
      );

      expect(find.text('แจ้งจากหน้างาน'), findsOneWidget);
    });

    testWidgets('source config-sync-writer -> แสดง "ตรวจพบอัตโนมัติ"', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeIncidentRepository(
          incidents: [_incident(source: 'config-sync-writer')],
        ),
      );

      expect(find.text('ตรวจพบอัตโนมัติ'), findsOneWidget);
    });

    testWidgets('source ว่าง (null) -> ไม่แสดงแถว source', (tester) async {
      await _pump(
        tester,
        repo: _FakeIncidentRepository(incidents: [_incident(source: null)]),
      );

      expect(find.text('แจ้งจากหน้างาน'), findsNothing);
      expect(find.text('ตรวจพบอัตโนมัติ'), findsNothing);
    });

    testWidgets(
      'แตะเลขอุปกรณ์ -> ไปหน้า Device Detail (ไม่ไป Incident Detail)',
      (tester) async {
        await _pumpRouted(
          tester,
          repo: _FakeIncidentRepository(
            incidents: [_incident(id: 'inc-9', deviceId: 'DEV-0103')],
          ),
        );

        await tester.tap(find.byKey(const Key('incident_card_device_0')));
        await tester.pumpAndSettle();

        expect(find.text('DEVICE_DETAIL_STUB DEV-0103'), findsOneWidget);
        expect(find.text('INCIDENT_DETAIL_STUB inc-9'), findsNothing);
      },
    );

    testWidgets('แตะส่วนอื่นของการ์ด -> ยังไป Incident Detail ตามเดิม', (
      tester,
    ) async {
      await _pumpRouted(
        tester,
        repo: _FakeIncidentRepository(
          incidents: [_incident(id: 'inc-9', deviceId: 'DEV-0103')],
        ),
      );

      await tester.tap(find.text('เขียน Config ไม่สำเร็จ'));
      await tester.pumpAndSettle();

      expect(find.text('INCIDENT_DETAIL_STUB inc-9'), findsOneWidget);
    });
  });

  // docs/22 §7.2 — ปุ่ม Field Report ใน actions ของหัวแท็บ Incidents (เว้นไว้จาก
  // Batch 2 เพราะรอโครงแท็บ) · ทางลัด "แจ้งปัญหา" บนหน้าแรกเดิมหายไปพร้อมหน้าแรกใหม่
  group('ปุ่ม Field Report (Batch 3)', () {
    final button = find.byKey(const Key('incidents_field_report'));

    for (final role in [UserRole.st, UserRole.ot]) {
      testWidgets('${role.wireName}: เห็นปุ่ม แตะแล้วไปหน้า Field Report', (
        tester,
      ) async {
        await _pumpRouted(tester, repo: _FakeIncidentRepository(), role: role);

        expect(button, findsOneWidget);
        expect(
          find.descendant(of: button, matching: find.text('Field Report')),
          findsOneWidget,
        );
        await tester.tap(button);
        await tester.pumpAndSettle();

        expect(find.text('FIELD_REPORT_STUB'), findsOneWidget);
      });
    }

    testWidgets('Operation: ไม่เห็นปุ่ม (ซ่อน ไม่ใช่ disable)', (tester) async {
      await _pumpRouted(
        tester,
        repo: _FakeIncidentRepository(),
        role: UserRole.operation,
      );

      expect(button, findsNothing);
      expect(find.text('Field Report'), findsNothing);
    });

    testWidgets('มีปุ่มบัญชีผู้ใช้มุมขวาของหัวแท็บ', (tester) async {
      await _pumpRouted(
        tester,
        repo: _FakeIncidentRepository(),
        role: UserRole.st,
      );
      expect(find.byKey(const Key('account_button')), findsOneWidget);
    });
  });
}
