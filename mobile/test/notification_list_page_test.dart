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
