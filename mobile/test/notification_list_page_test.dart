import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/core/theme/app_tokens.dart';
import 'package:mobile/core/ui/app_card.dart';
import 'package:mobile/core/ui/app_empty_state.dart';
import 'package:mobile/core/ui/app_page_header.dart';
import 'package:mobile/core/ui/app_skeleton.dart';
import 'package:mobile/core/ui/app_v2_theme.dart';
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

Future<void> _pumpRouted(
  WidgetTester tester,
  _FakeNotificationRepository repo,
) async {
  final router = GoRouter(
    initialLocation: AppRoutes.notifications,
    routes: [
      GoRoute(
        path: AppRoutes.notifications,
        builder: (_, _) => const NotificationListPage(),
      ),
      GoRoute(
        path: AppRoutes.taskDetailPattern,
        builder: (_, state) => Scaffold(
          body: Text('TASK_DETAIL_STUB ${state.pathParameters['id']}'),
        ),
      ),
      GoRoute(
        path: AppRoutes.deviceDetailPattern,
        builder: (_, state) => Scaffold(
          body: Text('DEVICE_DETAIL_STUB ${state.pathParameters['deviceId']}'),
        ),
      ),
      GoRoute(
        path: AppRoutes.incidentDetailPattern,
        builder: (_, state) => Scaffold(
          body: Text('INCIDENT_DETAIL_STUB ${state.pathParameters['id']}'),
        ),
      ),
    ],
  );
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
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pump();
}

void main() {
  group('แตะการ์ด -> navigate ตาม type (Mobile UX/UI audit report)', () {
    AppNotification withPayload(
      NotificationType type,
      Map<String, dynamic> payload, {
      String id = 'n1',
    }) => AppNotification(
      id: id,
      userId: 'u1',
      type: type,
      payload: payload,
      read: false,
      createdAt: DateTime(2026, 9, 4, 9, 15),
    );

    testWidgets('taskAssigned -> Task Detail ของ taskId นั้น', (tester) async {
      final repo = _FakeNotificationRepository(
        items: [
          withPayload(NotificationType.taskAssigned, {
            'taskId': 't9',
            'title': 'งานทดสอบ',
          }),
        ],
      );
      await _pumpRouted(tester, repo);

      await tester.tap(find.byKey(const Key('notification_tile_0')));
      await tester.pumpAndSettle();

      expect(find.text('TASK_DETAIL_STUB t9'), findsOneWidget);
      // ยังต้อง mark-as-read คู่กับ navigate (ไม่ใช่แทนที่)
      expect(repo.markReadCalls, ['n1']);
    });

    testWidgets('configOverrideApproved -> Device Detail ของ deviceId นั้น', (
      tester,
    ) async {
      final repo = _FakeNotificationRepository(
        items: [
          withPayload(NotificationType.configOverrideApproved, {
            'deviceId': 'DVC-7',
          }),
        ],
      );
      await _pumpRouted(tester, repo);

      await tester.tap(find.byKey(const Key('notification_tile_0')));
      await tester.pumpAndSettle();

      expect(find.text('DEVICE_DETAIL_STUB DVC-7'), findsOneWidget);
    });

    testWidgets(
      'incidentReportPending -> Incident Detail ของ incidentId นั้น',
      (tester) async {
        final repo = _FakeNotificationRepository(
          items: [
            withPayload(NotificationType.incidentReportPending, {
              'incidentId': 'inc-5',
              'deviceId': 'DVC-1',
              'title': 'x',
            }),
          ],
        );
        await _pumpRouted(tester, repo);

        await tester.tap(find.byKey(const Key('notification_tile_0')));
        await tester.pumpAndSettle();

        expect(find.text('INCIDENT_DETAIL_STUB inc-5'), findsOneWidget);
      },
    );

    testWidgets(
      'incidentAlert (ไม่มี incidentId ใน payload) -> ไม่ navigate ไปไหน แค่ mark-read',
      (tester) async {
        final repo = _FakeNotificationRepository(
          items: [
            withPayload(NotificationType.incidentAlert, {'configId': 'cfg-1'}),
          ],
        );
        await _pumpRouted(tester, repo);

        await tester.tap(find.byKey(const Key('notification_tile_0')));
        await tester.pumpAndSettle();

        expect(find.byType(NotificationListPage), findsOneWidget);
        expect(repo.markReadCalls, ['n1']);
      },
    );

    testWidgets('taskAssigned ไม่มี taskId ใน payload -> ไม่ navigate', (
      tester,
    ) async {
      final repo = _FakeNotificationRepository(
        items: [withPayload(NotificationType.taskAssigned, const {})],
      );
      await _pumpRouted(tester, repo);

      await tester.tap(find.byKey(const Key('notification_tile_0')));
      await tester.pumpAndSettle();

      expect(find.byType(NotificationListPage), findsOneWidget);
    });
  });

  group('ไอคอนเด่นกว่าสำหรับ type ที่เกี่ยวกับ incident ใหม่/ยังไม่จบ '
      '(Mobile UI Roadmap Phase 1)', () {
    Color iconBgOf(WidgetTester tester, int index) {
      final container = tester.widget<Container>(
        find
            .descendant(
              of: find.byKey(Key('notification_tile_$index')),
              matching: find.byType(Container),
            )
            .first,
      );
      return (container.decoration! as BoxDecoration).color!;
    }

    testWidgets('incidentReportPending -> พื้นหลังไอคอนเด่น (ไม่ใช่สีปกติ)', (
      tester,
    ) async {
      await _pump(
        tester,
        _FakeNotificationRepository(
          items: [_n('n1', type: NotificationType.incidentReportPending)],
        ),
      );

      expect(iconBgOf(tester, 0), AppColors.dangerSubtle);
    });

    testWidgets('incidentAlert -> พื้นหลังไอคอนเด่น (ไม่ใช่สีปกติ)', (
      tester,
    ) async {
      await _pump(
        tester,
        _FakeNotificationRepository(
          items: [_n('n1', type: NotificationType.incidentAlert)],
        ),
      );

      expect(iconBgOf(tester, 0), AppColors.dangerSubtle);
    });

    testWidgets(
      'configOverrideApproved (เรื่องทั่วไป) -> พื้นหลังไอคอนปกติเหมือนเดิม',
      (tester) async {
        await _pump(
          tester,
          _FakeNotificationRepository(
            items: [_n('n1', type: NotificationType.configOverrideApproved)],
          ),
        );

        expect(iconBgOf(tester, 0), AppColors.secondary);
      },
    );

    testWidgets(
      'incidentReportResolved (ปิดเรื่องแล้ว ไม่ใช่เรื่องใหม่) -> พื้นหลังไอคอนปกติ',
      (tester) async {
        await _pump(
          tester,
          _FakeNotificationRepository(
            items: [_n('n1', type: NotificationType.incidentReportResolved)],
          ),
        );

        expect(iconBgOf(tester, 0), AppColors.secondary);
      },
    );
  });

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

  testWidgets('taskAssigned — แสดงชื่องานจาก payload.title', (tester) async {
    await _pump(
      tester,
      _FakeNotificationRepository(
        items: [
          AppNotification(
            id: 'n1',
            userId: 'u1',
            type: NotificationType.taskAssigned,
            payload: const {'taskId': 't1', 'title': 'ติดตั้งกล่อง GPS'},
            read: true,
            createdAt: DateTime(2026, 9, 4, 9, 15),
          ),
        ],
      ),
    );

    expect(find.text('งาน: ติดตั้งกล่อง GPS'), findsOneWidget);
  });

  testWidgets('taskAssigned — title ว่าง/ไม่มี -> ไม่แสดงบรรทัดนี้', (
    tester,
  ) async {
    await _pump(
      tester,
      _FakeNotificationRepository(
        items: [
          AppNotification(
            id: 'n1',
            userId: 'u1',
            type: NotificationType.taskAssigned,
            payload: const {'taskId': 't1'},
            read: true,
            createdAt: DateTime(2026, 9, 4, 9, 15),
          ),
        ],
      ),
    );

    expect(find.textContaining('งาน:'), findsNothing);
  });

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

  testWidgets('empty state — AppEmptyState', (tester) async {
    await _pump(tester, _FakeNotificationRepository(items: []));
    expect(find.text('ไม่มีการแจ้งเตือน'), findsOneWidget);
    expect(find.byType(AppEmptyState), findsOneWidget);
  });

  group('design system ใหม่ (docs/22 Batch 2)', () {
    testWidgets('ใช้ theme v2 + AppPageHeader แทน AppBar สีกรมท่า', (
      tester,
    ) async {
      await _pump(tester, _FakeNotificationRepository(items: [_n('n1')]));

      expect(find.byType(AppBar), findsNothing);
      expect(find.byType(AppV2Theme), findsOneWidget);
      expect(
        find.widgetWithText(AppPageHeader, 'รายการแจ้งเตือน'),
        findsOneWidget,
      );
      final theme = Theme.of(tester.element(find.text('รายการแจ้งเตือน')));
      expect(theme.colorScheme.primary, AppColors.primary);
      // หน้าแรกของ stack (ไม่มีหน้าให้ย้อน) -> ไม่มีปุ่มย้อนกลับ
      expect(find.byTooltip('ย้อนกลับ'), findsNothing);
    });

    testWidgets(
      'ยังไม่อ่าน: การ์ดพื้น accent + จุด primary · อ่านแล้ว: การ์ดปกติ',
      (tester) async {
        await _pump(
          tester,
          _FakeNotificationRepository(items: [_n('n1'), _n('n2', read: true)]),
        );

        AppCard cardOf(int i) => tester.widget<AppCard>(
          find.descendant(
            of: find.byKey(Key('notification_tile_$i')),
            matching: find.byType(AppCard),
          ),
        );
        expect(cardOf(0).highlighted, isTrue);
        expect(cardOf(1).highlighted, isFalse);
        final dot = tester.widget<Container>(
          find.byKey(const Key('unread_dot')),
        );
        expect((dot.decoration! as BoxDecoration).color, AppColors.primary);
      },
    );

    testWidgets('กำลังโหลดครั้งแรก -> AppListSkeleton (ไม่ใช่ spinner)', (
      tester,
    ) async {
      final completer = Completer<List<AppNotification>>();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authControllerProvider.overrideWith(_FakeAuthController.new),
            tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
            sessionProfileStoreProvider.overrideWithValue(
              InMemorySessionProfileStore(),
            ),
            notificationListProvider.overrideWith((ref) => completer.future),
          ],
          child: const MaterialApp(home: NotificationListPage()),
        ),
      );
      await tester.pump();

      expect(find.byType(AppListSkeleton), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      completer.complete(const []);
      await tester.pump();
    });

    testWidgets('เปิดต่อจากหน้าอื่น -> มีปุ่มย้อนกลับ กดแล้วกลับ', (
      tester,
    ) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authControllerProvider.overrideWith(_FakeAuthController.new),
            tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
            sessionProfileStoreProvider.overrideWithValue(
              InMemorySessionProfileStore(),
            ),
            notificationRepositoryProvider.overrideWithValue(
              _FakeNotificationRepository(items: []),
            ),
          ],
          child: MaterialApp(
            home: Builder(
              builder: (context) => TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const NotificationListPage(),
                  ),
                ),
                child: const Text('OPEN'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('OPEN'));
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('ย้อนกลับ'));
      await tester.pumpAndSettle();
      expect(find.byType(NotificationListPage), findsNothing);
      expect(find.text('OPEN'), findsOneWidget);
    });
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
