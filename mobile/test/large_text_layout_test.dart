import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/db/providers/database_provider.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/features/config_override/config_override_page.dart';
import 'package:mobile/features/config_override/config_override_repository.dart';
import 'package:mobile/features/task/task_list_page.dart';
import 'package:mobile/features/task/task_repository.dart';
import 'package:mobile/features/task/task_status_ui.dart';

// ช่างหน้างานตั้งตัวอักษรระบบใหญ่ได้ (Android ถึง 2.0 เท่า) — ทดสอบทุกหน้าที่
// จอแคบสุดที่รองรับ (320dp) คู่กับ textScale 2.0 เป็นหลัก (UX audit #8, #9, #23)
//
// ใช้ฟอนต์ทดสอบของ Flutter (ทุกตัวอักษรกว้าง 1em) ซึ่งกว้างกว่าฟอนต์จริงบน
// Android — layout ที่ผ่านที่นี่จึงผ่านบนเครื่องจริงด้วย

/// จอ 320dp + ตัวอักษร 2 เท่า · สูงมากพอให้ ListView สร้างทุก widget
void useLargeTextNarrowScreen(WidgetTester tester) {
  tester.view.physicalSize = const Size(320 * 3, 8000 * 3);
  tester.view.devicePixelRatio = 3;
  tester.platformDispatcher.textScaleFactorTestValue = 2.0;
  addTearDown(tester.view.reset);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
}

/// ข้อความที่ถูกตัดขึ้นบรรทัดใหม่กลางคำภาษาอังกฤษ/ตัวเลข (เช่น "Firmwar|e")
/// ภาษาไทยไม่นับ เพราะตัดตามพจนานุกรมอยู่แล้ว
List<String> midWordBreaks(WidgetTester tester, Finder text) {
  final word = RegExp(r'[A-Za-z0-9_]');
  final out = <String>[];
  for (final element in text.evaluate()) {
    final paragraph = element.renderObject;
    if (paragraph is! RenderParagraph) continue;
    final s = paragraph.text.toPlainText();
    double? prevTop;
    for (var i = 0; i < s.length; i++) {
      final boxes = paragraph.getBoxesForSelection(
        TextSelection(baseOffset: i, extentOffset: i + 1),
      );
      if (boxes.isEmpty) continue;
      final top = boxes.first.top;
      if (prevTop != null &&
          top > prevTop + 1 &&
          word.hasMatch(s[i - 1]) &&
          word.hasMatch(s[i])) {
        out.add('${s.substring(0, i)}|${s.substring(i)}');
      }
      prevTop = top;
    }
  }
  return out;
}

// ---------------------------------------------------------------- #8 ----

const _apnDef = ConfigFieldDefinition(
  id: 'd-apn',
  fieldName: 'APN',
  dataType: 'string',
  allowedValues: [],
  required: true,
  stOverridable: true,
  sensitive: false,
  supportedModels: [],
);

const _passwordDef = ConfigFieldDefinition(
  id: 'd-pw',
  fieldName: 'COMMAND_PASSWORD',
  dataType: 'string',
  allowedValues: [],
  required: false,
  stOverridable: false,
  sensitive: true,
  supportedModels: [],
);

const _intervalDef = ConfigFieldDefinition(
  id: 'd-int',
  fieldName: 'REPORT_INTERVAL_MOVING',
  dataType: 'integer',
  allowedValues: [],
  required: false,
  stOverridable: false,
  sensitive: false,
  supportedModels: [],
);

class _FakeConfigOverrideRepository implements ConfigOverrideRepository {
  @override
  Future<DeviceConfigDraft> getCurrentConfig(String deviceId) async =>
      const DeviceConfigDraft(
        id: 'cfg-1',
        name: 'GT06N · ตั้งค่ามาตรฐาน',
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: ConfigStatus.approved,
        fields: {
          'APN': 'internet',
          'COMMAND_PASSWORD': '123456',
          'REPORT_INTERVAL_MOVING': 30,
        },
      );

  @override
  Future<List<ConfigFieldDefinition>> listDefinitions() async => const [
    _apnDef,
    _passwordDef,
    _intervalDef,
  ];

  @override
  Future<DeviceConfigOverride> overrideConfig({
    required String deviceId,
    required Map<String, dynamic> fields,
    required String reason,
  }) => throw UnimplementedError();
}

Future<void> _pumpConfigOverride(WidgetTester tester) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        configOverrideRepositoryProvider.overrideWithValue(
          _FakeConfigOverrideRepository(),
        ),
      ],
      child: const MaterialApp(home: ConfigOverridePage(deviceId: 'DEV-0117')),
    ),
  );
  await tester.pumpAndSettle();
}

// ---------------------------------------------------------------- #9 ----

class _StAuth extends AuthController {
  @override
  AuthState build() => const AuthState(
    status: AuthStatus.authenticated,
    role: UserRole.st,
    username: 'somchai.thongprasert',
  );
}

class _FakeTaskRepository implements TaskRepository {
  _FakeTaskRepository(this.tasks);

  final List<Task> tasks;

  @override
  Future<List<Task>> listTasks() async => tasks;

  @override
  Future<Task> getTask(String id) async => tasks.firstWhere((t) => t.id == id);

  @override
  Future<Task> updateStatus(String id, TaskStatus status) =>
      throw UnimplementedError();
}

/// งานที่ครอบทุกป้ายของการ์ด: เลยกำหนด / ใกล้ถึงกำหนด / ไม่เร่ง × ทุกสถานะ
List<Task> _tasksForEveryBadge() {
  final now = DateTime.now();
  Task t(String id, TaskStatus status, DateTime? due) => Task(
    id: id,
    title: 'ติดตั้งกล่อง GPS รถบรรทุก $id',
    assignedTo: 'u1',
    status: status,
    createdAt: DateTime(2026, 10, 1),
    updatedAt: DateTime(2026, 10, 1),
    dueDate: due,
    deviceId: 'GPS-TH-NE-000123456$id',
  );
  return [
    t('1', TaskStatus.pending, now.subtract(const Duration(days: 3))),
    t('2', TaskStatus.inProgress, now.add(const Duration(hours: 6))),
    t('3', TaskStatus.completed, null),
    t('4', TaskStatus.cancelled, null),
    t('5', TaskStatus.pending, now.add(const Duration(days: 5))),
  ];
}

List<Override> _taskOverrides(List<Task> tasks) => [
  authControllerProvider.overrideWith(_StAuth.new),
  tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
  sessionProfileStoreProvider.overrideWithValue(InMemorySessionProfileStore()),
  taskRepositoryProvider.overrideWithValue(_FakeTaskRepository(tasks)),
  pendingTaskIdsProvider.overrideWith((ref) => Stream.value(const <String>{})),
  failedSyncActionsProvider.overrideWith(
    (ref) => Stream.value(const <PendingActionRow>[]),
  ),
  appDatabaseProvider.overrideWith((ref) {
    final db = AppDatabase.forTesting(NativeDatabase.memory());
    ref.onDispose(db.close);
    return db;
  }),
];

/// ข้อความ [label] ทุกตัวแสดงครบ ไม่ถูกตัด (ไม่ ellipsis และอยู่ในจอ)
void expectFullyVisible(WidgetTester tester, String label) {
  final found = find.text(label);
  expect(found, findsWidgets, reason: label);
  final screenWidth =
      tester.view.physicalSize.width / tester.view.devicePixelRatio;
  for (final e in found.evaluate()) {
    final p = e.renderObject! as RenderParagraph;
    expect(p.didExceedMaxLines, isFalse, reason: '$label ถูกตัด');
    final right = tester.getTopRight(find.byElementPredicate((x) => x == e)).dx;
    expect(right, lessThanOrEqualTo(screenWidth), reason: '$label ล้นจอ');
  }
}

void main() {
  group('Config Override ช่องที่ override ไม่ได้ (UX audit #8)', () {
    testWidgets('320dp x2.0 -> ไม่ล้นขอบ และ "(override ไม่ได้)" อยู่ใต้ค่า', (
      tester,
    ) async {
      useLargeTextNarrowScreen(tester);
      await _pumpConfigOverride(tester);

      expect(tester.takeException(), isNull);
      final label = find.text('(override ไม่ได้)');
      expect(label, findsNWidgets(2));
      // ค่า (ไม่ sensitive) อยู่บรรทัดบน ป้ายอยู่บรรทัดล่าง ไม่แย่งความกว้างกัน
      final value = find.text('30');
      expect(
        tester.getTopLeft(label.last).dy,
        greaterThanOrEqualTo(tester.getBottomLeft(value).dy),
      );
    });

    testWidgets('ตัวอักษรปกติ -> ป้ายยังอยู่และไม่ล้น', (tester) async {
      tester.view.physicalSize = const Size(320 * 3, 4000 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await _pumpConfigOverride(tester);

      expect(tester.takeException(), isNull);
      expect(find.text('(override ไม่ได้)'), findsNWidgets(2));
    });
  });

  group('ป้ายความเร่งด่วนในรายการงาน (UX audit #9)', () {
    testWidgets('320dp x2.0 -> ไม่ล้น และป้ายทุกตัวอ่านได้ครบ', (tester) async {
      useLargeTextNarrowScreen(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: _taskOverrides(_tasksForEveryBadge()),
          child: const MaterialApp(home: TaskListPage()),
        ),
      );
      await tester.pump();
      await tester.pump();

      expect(tester.takeException(), isNull);
      for (final urgency in [TaskUrgency.overdue, TaskUrgency.dueSoon]) {
        expectFullyVisible(tester, TaskUrgencyStyle.label(urgency));
      }
      for (final status in TaskStatus.values) {
        expectFullyVisible(tester, TaskStatusStyle.label(status));
      }
    });
  });
}
