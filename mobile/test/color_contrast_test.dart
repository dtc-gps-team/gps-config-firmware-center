import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/db/providers/database_provider.dart';
import 'package:mobile/core/router/app_shell.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/core/ui/app_badge.dart';
import 'package:mobile/core/ui/status_tones.dart';
import 'package:mobile/features/auth/login_page.dart';
import 'package:mobile/features/task/simulator_repository.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';
import 'package:mobile/features/incident/incident_ui.dart';
import 'package:mobile/features/notification/notification_repository.dart';
import 'package:mobile/features/task/task_repository.dart';
import 'package:mobile/features/task/task_status_ui.dart';
import 'package:package_info_plus/package_info_plus.dart';

// UX audit #10 — ช่างใช้แอปกลางแจ้ง/แสงจ้า ข้อความต้องผ่าน WCAG AA
// (ข้อความ >= 4.5:1, ขอบช่องกรอกซึ่งเป็น UI component >= 3:1 ตาม 1.4.11)
// คำนวณจากค่า Color จริงในโค้ดด้วยสูตร relative luminance ของ WCAG

/// WCAG contrast ratio — `Color.computeLuminance()` คือ relative luminance
/// ตามนิยามของ WCAG 2.x
double contrastRatio(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final hi = la > lb ? la : lb;
  final lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

const _textMin = 4.5;
const _uiMin = 3.0;

void _expectTextContrast(String name, (Color, Color) bgFg) {
  final (bg, fg) = bgFg;
  final ratio = contrastRatio(fg, bg);
  expect(
    ratio,
    greaterThanOrEqualTo(_textMin),
    reason: '$name: ${ratio.toStringAsFixed(2)}:1',
  );
}

class _Auth extends AuthController {
  _Auth(this._state);
  final AuthState _state;

  @override
  AuthState build() => _state;
}

class _Tasks implements TaskRepository {
  @override
  Future<List<Task>> listTasks() async => const [];

  @override
  Future<Task> getTask(String id) => throw UnimplementedError();

  @override
  Future<Task> updateStatus(String id, TaskStatus status) =>
      throw UnimplementedError();
}

class _UnreadNotifications implements NotificationRepository {
  @override
  Future<List<AppNotification>> list({bool? unread}) async => [
    AppNotification(
      id: 'n1',
      userId: 'u1',
      type: NotificationType.taskAssigned,
      payload: const {},
      read: false,
      createdAt: DateTime(2026, 10, 16),
    ),
  ];

  @override
  Future<AppNotification> markRead(String id) => throw UnimplementedError();
}

Future<void> _pump(WidgetTester tester, Widget page, AuthState auth) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authControllerProvider.overrideWith(() => _Auth(auth)),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
        sessionProfileStoreProvider.overrideWithValue(
          InMemorySessionProfileStore(),
        ),
        taskRepositoryProvider.overrideWithValue(_Tasks()),
        notificationRepositoryProvider.overrideWithValue(
          _UnreadNotifications(),
        ),
        pendingTaskIdsProvider.overrideWith(
          (ref) => Stream.value(const <String>{}),
        ),
        // แถบสถานะบน Home (#338) อ่านตัวนี้ด้วย — ตัวจริงคือ drift
        // `watchFailed()` ที่ทิ้ง Timer ค้างหลัง dispose (`!timersPending`)
        failedSyncActionsProvider.overrideWith(
          (ref) => Stream.value(const <PendingActionRow>[]),
        ),
        appDatabaseProvider.overrideWith((ref) {
          final db = AppDatabase.forTesting(NativeDatabase.memory());
          ref.onDispose(db.close);
          return db;
        }),
        simulatorRepositoryProvider.overrideWithValue(
          MockSimulatorRepository(),
        ),
        deviceSearchRepositoryProvider.overrideWithValue(
          MockDeviceSearchRepository(),
        ),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: page),
    ),
  );
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 200));
  }
}

const _st = AuthState(
  status: AuthStatus.authenticated,
  role: UserRole.st,
  username: 'st.test',
);

/// สีขอบตอนปกติ (enabled) ที่ Flutter วาดจริงของทุกช่องกรอกในหน้า —
/// `enabledBorder` ของช่องนั้น ถ้าไม่มีใช้ของ theme ถ้าไม่มีอีก Material 3 ใช้
/// `colorScheme.outline` (สีใน `border:` ไม่ถูกใช้ตอน enabled)
List<Color> _enabledBorderColors(WidgetTester tester) => [
  for (final element in find.byType(InputDecorator).evaluate())
    switch ((element.widget as InputDecorator).decoration.enabledBorder ??
        Theme.of(element).inputDecorationTheme.enabledBorder) {
      final OutlineInputBorder b => b.borderSide.color,
      _ => Theme.of(element).colorScheme.outline,
    },
];

void main() {
  group('ป้ายสีทุกแบบในแอป ข้อความ >= 4.5:1 (UX audit #10)', () {
    test('ป้ายความเร่งด่วน (รวม "ใกล้ถึงกำหนด")', () {
      for (final u in TaskUrgency.values.where((u) => u != TaskUrgency.none)) {
        _expectTextContrast('urgency $u', TaskUrgencyStyle.colors(u));
      }
    });

    test('ป้ายสถานะงาน', () {
      for (final s in TaskStatus.values) {
        _expectTextContrast('task $s', TaskStatusStyle.colors(s));
      }
    });

    test('ป้ายความรุนแรงและสถานะ Incident', () {
      for (final s in IncidentSeverity.values) {
        _expectTextContrast('severity $s', IncidentStyle.severityColors(s));
      }
      for (final s in IncidentStatus.values) {
        _expectTextContrast('incident $s', IncidentStyle.statusColors(s));
      }
    });

    // ป้ายสถานะอุปกรณ์เป็น AppBadge แล้ว (docs/22 Batch 4) — วัดสีจริงของ tone ที่ใช้
    // (ตัวอักษรโปร่งแสงผสมกับพื้นก่อนวัด)
    test('ป้ายสถานะอุปกรณ์', () {
      for (final s in DeviceLifecycleStatus.values) {
        final style = deviceLifecycleTone(s).style;
        _expectTextContrast('device $s', (
          style.background,
          Color.alphaBlend(style.foreground, style.background),
        ));
      }
    });

    test('ป้าย "เสร็จสิ้น" บน Home (mockSuccess) ทั้งบนพื้นป้ายและพื้นขาว', () {
      _expectTextContrast('success soft', (
        AppTheme.mockSuccessSoft,
        AppTheme.mockSuccess,
      ));
      _expectTextContrast('success white', (
        AppTheme.surface,
        AppTheme.mockSuccess,
      ));
    });
  });

  // กระดิ่งบนหัวหน้าแรกย้ายมาเป็นตัวเลขบนแท็บแจ้งเตือน (docs/22 §7.2)
  testWidgets('badge จำนวนแจ้งเตือนบนแท็บ ข้อความ >= 4.5:1 '
      '(UX audit #10)', (tester) async {
    await _pump(
      tester,
      Scaffold(
        bottomNavigationBar: AppTabBar(
          tabs: AppTab.values,
          selectedIndex: 0,
          onSelected: (_) {},
        ),
      ),
      _st,
    );

    final badgeFinder = find.byType(Badge);
    expect(badgeFinder, findsOneWidget);
    final badge = tester.widget<Badge>(badgeFinder);
    final scheme = Theme.of(tester.element(badgeFinder)).colorScheme;
    final bg = badge.backgroundColor ?? scheme.error;
    final fg = badge.textColor ?? scheme.onError;
    _expectTextContrast('bell badge', (bg, fg));
  });

  group('ขอบช่องกรอก >= 3:1 (UX audit #10, WCAG 1.4.11)', () {
    test('สีขอบช่องกรอกกับพื้นการ์ดและพื้นหน้า', () {
      for (final bg in [AppTheme.surface, AppTheme.background]) {
        final ratio = contrastRatio(AppTheme.inputBorder, bg);
        expect(ratio, greaterThanOrEqualTo(_uiMin), reason: '$bg $ratio');
      }
    });

    test('ช่องกรอกที่ไม่ได้ตั้งขอบเอง (Material colorScheme.outline)', () {
      final outline = AppTheme.light().colorScheme.outline;
      for (final bg in [AppTheme.surface, AppTheme.background]) {
        expect(contrastRatio(outline, bg), greaterThanOrEqualTo(_uiMin));
      }
    });

    testWidgets('หน้า login', (tester) async {
      PackageInfo.setMockInitialValues(
        appName: 'mobile',
        packageName: 'com.example.mobile',
        version: '1.0.0',
        buildNumber: '1',
        buildSignature: '',
      );
      await _pump(
        tester,
        const LoginPage(),
        const AuthState(status: AuthStatus.unauthenticated),
      );
      final colors = _enabledBorderColors(tester);
      expect(colors, isNotEmpty);
      for (final c in colors) {
        expect(
          contrastRatio(c, AppTheme.surface),
          greaterThanOrEqualTo(_uiMin),
        );
      }
    });
  });
}
