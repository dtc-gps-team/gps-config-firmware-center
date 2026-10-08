import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/features/notification/notification_list_page.dart';
import 'package:mobile/features/notification/notification_repository.dart';

class _FakeAuthController extends AuthController {
  @override
  AuthState build() => const AuthState(status: AuthStatus.authenticated);
}

AppNotification _n(
  String id, {
  bool read = false,
  NotificationType type = NotificationType.taskAssigned,
}) => AppNotification(
  id: id,
  userId: 'u1',
  type: type,
  payload: const {},
  read: read,
  createdAt: DateTime(2026, 9, 4, 9, 15),
);

class _FakeNotificationRepository implements NotificationRepository {
  _FakeNotificationRepository({List<AppNotification>? items, this.listError})
    : _items = items ?? [_n('n1'), _n('n2', read: true)];

  final List<AppNotification> _items;
  final Object? listError;

  Object? markError;
  final List<String> markReadCalls = [];

  @override
  Future<List<AppNotification>> list({bool? unread}) async {
    if (listError != null) throw listError!;
    return unread == true ? _items.where((n) => !n.read).toList() : _items;
  }

  @override
  Future<AppNotification> markRead(String id) async {
    markReadCalls.add(id);
    if (markError != null) throw markError!;
    return _items.firstWhere((n) => n.id == id).copyWith(read: true);
  }
}

Future<void> _pump(
  WidgetTester tester,
  _FakeNotificationRepository repo,
) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authControllerProvider.overrideWith(_FakeAuthController.new),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
        sessionProfileStoreProvider.overrideWithValue(
          InMemorySessionProfileStore(),
        ),
        notificationRepositoryProvider.overrideWithValue(repo),
      ],
      child: const MaterialApp(home: NotificationListPage()),
    ),
  );
  await tester.pump(); // resolve list future
}

void main() {
  testWidgets('render — item + label ตาม type + unread dot', (tester) async {
    await _pump(
      tester,
      _FakeNotificationRepository(
        items: [
          _n('n1', type: NotificationType.firmwareReady),
          _n('n2', read: true, type: NotificationType.configApproved),
        ],
      ),
    );

    expect(find.text('เฟิร์มแวร์พร้อมใช้งาน'), findsOneWidget);
    expect(find.text('อนุมัติ Config แล้ว'), findsOneWidget);
    // n1 unread -> dot; n2 read -> no dot -> exactly one dot on screen
    expect(find.byKey(const Key('unread_dot')), findsOneWidget);
  });

  testWidgets(
    'render — 3 notification type ใหม่ของ Config Override (issue #226) ไม่ throw',
    (tester) async {
      await _pump(
        tester,
        _FakeNotificationRepository(
          items: [
            _n('n1', type: NotificationType.configOverridePending),
            _n('n2', type: NotificationType.configOverrideApproved),
            _n('n3', type: NotificationType.configOverrideRejected),
          ],
        ),
      );

      expect(find.text('มีคำขอ Override รออนุมัติ'), findsOneWidget);
      expect(find.text('คำขอ Override ได้รับการอนุมัติ'), findsOneWidget);
      expect(find.text('คำขอ Override ถูกปฏิเสธ'), findsOneWidget);
    },
  );

  testWidgets(
    'render — 3 notification type ใหม่ของ Firmware Override (issue #256) '
    'พร้อม deviceId/rejectReason',
    (tester) async {
      AppNotification n(
        String id,
        NotificationType type,
        Map<String, dynamic> payload,
      ) => AppNotification(
        id: id,
        userId: 'u1',
        type: type,
        payload: payload,
        read: true,
        createdAt: DateTime(2026, 10, 6, 9, 15),
      );

      await _pump(
        tester,
        _FakeNotificationRepository(
          items: [
            n('n1', NotificationType.firmwareOverridePending, {
              'deviceId': 'DTC-0001',
            }),
            n('n2', NotificationType.firmwareOverrideApproved, {
              'deviceId': 'DTC-0002',
            }),
            n('n3', NotificationType.firmwareOverrideRejected, {
              'deviceId': 'DTC-0003',
              'rejectReason': 'Firmware ไม่เหมาะกับลูกค้า',
            }),
          ],
        ),
      );

      expect(find.text('มีคำขอ Firmware Override รออนุมัติ'), findsOneWidget);
      expect(
        find.text('คำขอ Firmware Override ได้รับการอนุมัติ'),
        findsOneWidget,
      );
      expect(find.text('คำขอ Firmware Override ถูกปฏิเสธ'), findsOneWidget);
      expect(find.text('อุปกรณ์: DTC-0001'), findsOneWidget);
      expect(find.text('อุปกรณ์: DTC-0003'), findsOneWidget);
      expect(find.text('เหตุผล: Firmware ไม่เหมาะกับลูกค้า'), findsOneWidget);
    },
  );

  testWidgets(
    'render — 4 notification type ใหม่ของ Field Incident Report (issue #236) '
    'แสดง deviceId/title/reviewNote และรับ deviceId เป็น null',
    (tester) async {
      AppNotification n(
        String id,
        NotificationType type,
        Map<String, dynamic> payload,
      ) => AppNotification(
        id: id,
        userId: 'u1',
        type: type,
        payload: payload,
        read: true,
        createdAt: DateTime(2026, 10, 6, 9, 15),
      );

      await _pump(
        tester,
        _FakeNotificationRepository(
          items: [
            n('n1', NotificationType.incidentReportPending, {
              'incidentId': 'i1',
              'deviceId': 'DTC-0001',
              'title': 'ไม่ส่งสัญญาณ',
            }),
            n('n2', NotificationType.incidentReportResolved, {
              'incidentId': 'i2',
              'deviceId': 'DTC-0002',
              'reviewNote': 'เปลี่ยนฮาร์ดแวร์แล้ว',
            }),
            n('n3', NotificationType.incidentReportDismissed, {
              'incidentId': 'i3',
              'deviceId': null, // report ไม่ผูกอุปกรณ์
              'reviewNote': 'ซ้ำกับรายการเดิม',
            }),
            n('n4', NotificationType.incidentReportPromoted, {
              'incidentId': 'i4',
              'deviceId': 'DTC-0004',
              'reviewNote': 'ต้องแก้ด้วย Campaign',
            }),
          ],
        ),
      );

      expect(find.text('มีรายงานปัญหาหน้างานรอตัดสินใจ'), findsOneWidget);
      expect(
        find.text('รายงานปัญหาของคุณถูกปิดแล้ว (แก้ไขแล้ว)'),
        findsOneWidget,
      );
      expect(
        find.text('รายงานปัญหาของคุณไม่ถูกดำเนินการ (ไม่ใช่ปัญหา/ซ้ำ)'),
        findsOneWidget,
      );
      expect(
        find.text('รายงานปัญหาของคุณถูกส่งต่อเป็น Campaign แก้ไข'),
        findsOneWidget,
      );
      expect(find.text('อุปกรณ์: DTC-0001'), findsOneWidget);
      expect(find.text('หัวข้อ: ไม่ส่งสัญญาณ'), findsOneWidget);
      expect(find.text('อุปกรณ์: DTC-0002'), findsOneWidget);
      expect(find.text('หมายเหตุ: เปลี่ยนฮาร์ดแวร์แล้ว'), findsOneWidget);
      // deviceId null -> ไม่มีบรรทัดอุปกรณ์ แต่ยังมีหมายเหตุ ไม่ throw
      expect(find.text('หมายเหตุ: ซ้ำกับรายการเดิม'), findsOneWidget);
      expect(find.text('หมายเหตุ: ต้องแก้ด้วย Campaign'), findsOneWidget);
    },
  );

  testWidgets('Config Override — แสดง deviceId + rejectReason จาก payload', (
    tester,
  ) async {
    AppNotification withPayload(
      String id,
      NotificationType type,
      Map<String, dynamic> payload,
    ) => AppNotification(
      id: id,
      userId: 'u1',
      type: type,
      payload: payload,
      read: true,
      createdAt: DateTime(2026, 9, 4, 9, 15),
    );

    await _pump(
      tester,
      _FakeNotificationRepository(
        items: [
          withPayload('n1', NotificationType.configOverridePending, {
            'deviceId': 'DTC-0001',
          }),
          withPayload('n2', NotificationType.configOverrideApproved, {
            'deviceId': 'DTC-0002',
          }),
          withPayload('n3', NotificationType.configOverrideRejected, {
            'deviceId': 'DTC-0003',
            'rejectReason': 'ค่า APN ไม่ถูกต้อง',
          }),
        ],
      ),
    );

    expect(find.text('อุปกรณ์: DTC-0001'), findsOneWidget);
    expect(find.text('อุปกรณ์: DTC-0002'), findsOneWidget);
    expect(find.text('อุปกรณ์: DTC-0003'), findsOneWidget);
    expect(find.text('เหตุผล: ค่า APN ไม่ถูกต้อง'), findsOneWidget);
  });

  testWidgets(
    'Config Override — rejectReason ว่าง/ไม่มี -> ไม่แสดงบรรทัดเหตุผล',
    (tester) async {
      AppNotification rejected(String id, Map<String, dynamic> payload) =>
          AppNotification(
            id: id,
            userId: 'u1',
            type: NotificationType.configOverrideRejected,
            payload: payload,
            read: true,
            createdAt: DateTime(2026, 9, 4, 9, 15),
          );

      await _pump(
        tester,
        _FakeNotificationRepository(
          items: [
            rejected('n1', {'deviceId': 'DTC-0001', 'rejectReason': null}),
            rejected('n2', {'deviceId': 'DTC-0002', 'rejectReason': '  '}),
            rejected('n3', const {}),
          ],
        ),
      );

      expect(find.text('อุปกรณ์: DTC-0001'), findsOneWidget);
      expect(find.text('อุปกรณ์: DTC-0002'), findsOneWidget);
      expect(find.textContaining('เหตุผล:'), findsNothing);
    },
  );

  testWidgets('type อื่น — ไม่แสดง detail แม้ payload มี deviceId', (
    tester,
  ) async {
    await _pump(
      tester,
      _FakeNotificationRepository(
        items: [
          AppNotification(
            id: 'n1',
            userId: 'u1',
            type: NotificationType.incidentAlert,
            payload: const {'deviceId': 'DTC-0009'},
            read: true,
            createdAt: DateTime(2026, 9, 4, 9, 15),
          ),
        ],
      ),
    );

    expect(find.textContaining('อุปกรณ์:'), findsNothing);
  });

  testWidgets('empty state', (tester) async {
    await _pump(tester, _FakeNotificationRepository(items: []));
    expect(find.text('ไม่มีการแจ้งเตือน'), findsOneWidget);
  });

  testWidgets('error state + ปุ่มลองอีกครั้ง', (tester) async {
    await _pump(
      tester,
      _FakeNotificationRepository(
        listError: ApiException('เซิร์ฟเวอร์ล่ม', statusCode: 500),
      ),
    );

    expect(find.text('เซิร์ฟเวอร์ล่ม'), findsOneWidget);
    expect(find.byKey(const Key('notification_list_retry')), findsOneWidget);
  });

  testWidgets('แตะ unread -> markRead ถูกเรียก, dot หาย', (tester) async {
    final repo = _FakeNotificationRepository(items: [_n('n1')]);
    await _pump(tester, repo);

    expect(find.byKey(const Key('unread_dot')), findsOneWidget);

    await tester.tap(find.byKey(const Key('notification_tile_0')));
    await tester.pump(); // optimistic setState
    await tester.pump(); // markRead future

    expect(repo.markReadCalls, ['n1']);
    expect(find.byKey(const Key('unread_dot')), findsNothing);
  });

  testWidgets('แตะ item ที่อ่านแล้ว -> ไม่เรียก markRead ซ้ำ', (tester) async {
    final repo = _FakeNotificationRepository(items: [_n('n1', read: true)]);
    await _pump(tester, repo);

    await tester.tap(find.byKey(const Key('notification_tile_0')));
    await tester.pump();

    expect(repo.markReadCalls, isEmpty);
  });

  testWidgets('markRead 404 -> snackbar + dot กลับมา', (tester) async {
    final repo = _FakeNotificationRepository(items: [_n('n1')])
      ..markError = ApiException('ไม่พบ', statusCode: 404);
    await _pump(tester, repo);

    await tester.tap(find.byKey(const Key('notification_tile_0')));
    await tester.pump();
    await tester.pump();

    expect(
      find.textContaining('ทำเครื่องหมายว่าอ่านไม่สำเร็จ'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('unread_dot')), findsOneWidget);

    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
  });
}
