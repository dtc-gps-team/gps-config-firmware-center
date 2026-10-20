import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/config/app_config.dart';
import '../../core/router/app_router.dart';
import '../../core/router/app_shell.dart';
import '../notification/notification_ui.dart';

/// Android notification channel for pushes the app renders itself. The backend
/// sends **data-only** FCM messages (no `notification` block — see
/// `backend/src/notification/fcm-sender.ts`), so Android never shows a tray
/// notification on its own; every state below builds one via
/// `flutter_local_notifications`.
const _androidChannelId = 'push_default';
const _androidChannelName = 'การแจ้งเตือน';
const _androidChannelDescription =
    'แจ้งเตือนงานที่ได้รับมอบหมายและอัปเดตจากระบบ';

/// Notification types whose payload carries an `incidentId` and deep-link to
/// the incident detail page.
const _incidentPushTypes = {
  'incident_report_pending',
  'incident_report_resolved',
  'incident_report_dismissed',
  'incident_report_promoted',
};

/// The route to open for an FCM `data` payload (`{'type': ..., 'payload': ...}`).
///
/// Pure + total: never throws, never touches an SDK. `task_assigned` with a
/// non-empty string `taskId` deep-links to the task, `incident_report_*` with a
/// non-empty string `incidentId` deep-links to the incident; anything else
/// (unknown type, malformed/missing payload, missing id) falls back to the
/// notification list. `payload` is normally a JSON string (FCM `data` values
/// are always strings) but an already-decoded map is accepted too.
String resolvePushDeepLink(Map<String, dynamic> data) {
  final type = data['type'];
  final payload = _decodePayload(data['payload']);

  if (type == NotificationType.taskAssigned.wireName) {
    final taskId = _nonEmptyString(payload['taskId']);
    return taskId == null
        ? AppRoutes.notifications
        : AppRoutes.taskDetail(taskId);
  }
  if (_incidentPushTypes.contains(type)) {
    final incidentId = _nonEmptyString(payload['incidentId']);
    return incidentId == null
        ? AppRoutes.notifications
        : AppRoutes.incidentDetail(incidentId);
  }
  return AppRoutes.notifications;
}

/// แท็บที่เป็นฐานของหน้าปลายทางจาก push (docs/22 §7.2) — กด back จากหน้าปลายทาง
/// กลับแท็บที่เกี่ยวข้อง ไม่ปิดแอป (UX audit #4): Incident → แท็บ Incidents ·
/// Task Detail → หน้าแรก (Operation ไม่มีแท็บงาน ใช้แท็บแจ้งเตือนที่เปิดงานมาแทน) ·
/// ปลายทางที่เป็นแท็บอยู่แล้ว (แจ้งเตือน) = แท็บนั้นเอง
String pushBaseTabFor(String path, UserRole? role) {
  for (final tab in AppTab.values) {
    if (path == tab.location) return path;
  }
  if (path.startsWith('${AppRoutes.incidents}/')) return AppRoutes.incidents;
  return isFieldStaff(role) ? AppRoutes.home : AppRoutes.notifications;
}

String? _nonEmptyString(Object? value) {
  if (value is! String) return null;
  final trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

/// Body text of a push: the incident `title` (sent to Operation on
/// `incident_report_pending`) or the reviewer's `reviewNote` (sent to the
/// reporter on a decision) when the payload has one, otherwise the generic
/// prompt. Pure + total, same payload rules as [resolvePushDeepLink].
String resolvePushBody(Map<String, dynamic> data) {
  final payload = _decodePayload(data['payload']);
  return _nonEmptyString(payload['title']) ??
      _nonEmptyString(payload['reviewNote']) ??
      _defaultPushBody;
}

const _defaultPushBody = 'แตะเพื่อดูรายละเอียด';

Map<String, dynamic> _decodePayload(Object? raw) {
  if (raw is Map<String, dynamic>) return raw;
  if (raw is String && raw.isNotEmpty) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) return decoded;
    } catch (_) {
      // fall through
    }
  }
  return const {};
}

/// Thai title for a push, reusing the notification-list labels. Unknown types
/// (backend only sends `task_assigned` today) get a generic title rather than
/// throwing via `NotificationType.fromWire`.
String _titleFor(Object? type) {
  if (type is String) {
    try {
      return NotificationTypeStyle.label(NotificationType.fromWire(type));
    } catch (_) {
      // unknown type — generic title below
    }
  }
  return 'การแจ้งเตือนใหม่';
}

/// Builds and shows a local notification for an FCM `data` payload. Stores the
/// raw `data` (JSON) as the notification `payload` so a later tap resolves the
/// same deep link as [FirebaseMessaging.onMessageOpenedApp]. Shared by the
/// foreground listener and the background isolate handler — must not touch
/// Riverpod / any `Ref`.
Future<void> showPushLocalNotification(
  FlutterLocalNotificationsPlugin plugin,
  Map<String, dynamic> data,
) async {
  const details = NotificationDetails(
    android: AndroidNotificationDetails(
      _androidChannelId,
      _androidChannelName,
      channelDescription: _androidChannelDescription,
      importance: Importance.high,
      priority: Priority.high,
    ),
  );
  await plugin.show(
    // Notification id — the backend payload has no stable id yet, so use a
    // time-derived value; distinct pushes replace nothing.
    id: DateTime.now().millisecondsSinceEpoch ~/ 1000 & 0x7fffffff,
    title: _titleFor(data['type']),
    body: resolvePushBody(data),
    notificationDetails: details,
    payload: jsonEncode(data),
  );
}

const _androidInitSettings = AndroidInitializationSettings(
  '@mipmap/ic_launcher',
);

/// Background / terminated FCM handler. **Must be a top-level function**
/// (Firebase runs it in its own isolate — no access to Riverpod, UI, or the
/// running app's state). It only initializes the plugins and renders the local
/// notification; the deep link is resolved when the user taps it and the app
/// comes to the foreground (main isolate — [PushMessageHandler]).
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  final plugin = FlutterLocalNotificationsPlugin();
  await plugin.initialize(
    settings: const InitializationSettings(android: _androidInitSettings),
  );
  await showPushLocalNotification(plugin, message.data);
}

/// Wires the four "a push was tapped / arrived" entry points to one place:
/// [FirebaseMessaging.onMessage] (foreground — render it ourselves),
/// [FirebaseMessaging.onMessageOpenedApp] (tap while backgrounded),
/// [FirebaseMessaging.getInitialMessage] (tap from terminated, FCM-tracked),
/// and the local-notification tap (foreground/background + launch-from-
/// terminated) — since the notification shown on foreground is one *we*
/// created, FCM's own open callbacks don't fire for it.
///
/// Guarded by [AppConfig.pushNotificationsEnabled] like [PushNotificationService];
/// [setup] is safe to call once even before login (no messages arrive until a
/// token is registered) and never throws — a missing Firebase config (CI, iOS)
/// just leaves push inert.
class PushMessageHandler {
  PushMessageHandler(this._ref);

  final Ref _ref;
  final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();

  bool _started = false;

  void setup() {
    if (!AppConfig.pushNotificationsEnabled || _started) return;
    _started = true;
    unawaited(_setup());
  }

  Future<void> _setup() async {
    try {
      await Firebase.initializeApp();

      await _localNotifications.initialize(
        settings: const InitializationSettings(android: _androidInitSettings),
        onDidReceiveNotificationResponse: _onLocalNotificationTap,
      );

      // Local notification that launched a terminated app.
      final launch = await _localNotifications
          .getNotificationAppLaunchDetails();
      if (launch?.didNotificationLaunchApp ?? false) {
        _navigateFromPayloadString(launch!.notificationResponse?.payload);
      }

      // FCM notification-message tap from terminated (data-only messages don't
      // populate this, but wire it for when a `notification` block is added).
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) _navigate(initial.data);

      FirebaseMessaging.onMessage.listen((message) {
        unawaited(showPushLocalNotification(_localNotifications, message.data));
      });
      FirebaseMessaging.onMessageOpenedApp.listen((message) {
        _navigate(message.data);
      });
    } catch (_) {
      // No Firebase config (CI / iOS) or no platform binding (tests) — push
      // stays inert, the rest of the app is unaffected.
    }
  }

  void _onLocalNotificationTap(NotificationResponse response) {
    _navigateFromPayloadString(response.payload);
  }

  void _navigateFromPayloadString(String? payload) {
    if (payload == null || payload.isEmpty) return;
    try {
      final decoded = jsonDecode(payload);
      if (decoded is Map<String, dynamic>) _navigate(decoded);
    } catch (_) {
      // ignore a corrupt payload
    }
  }

  void _navigate(Map<String, dynamic> data) =>
      openPath(resolvePushDeepLink(data));

  /// Username of the last signed-in user seen by this handler (survives
  /// logout, reset only with the process). Used to tell "the same person came
  /// back" from "someone else signs in on this device".
  String? _lastUser;

  /// [_lastUser] at the moment the pending path was parked. Null = nobody had
  /// signed in during this process yet (cold start from a tap), so whoever
  /// signs in first is the person who tapped.
  String? _parkedAfterUser;

  /// Opens [path] now if signed in; otherwise parks it in
  /// [pendingPushRouteProvider] (the router would bounce to splash/login and
  /// lose the destination).
  void openPath(String path) {
    if (_ref.read(authControllerProvider).isAuthenticated) {
      _go(path);
    } else {
      _parkedAfterUser = _lastUser;
      _ref.read(pendingPushRouteProvider.notifier).state = path;
    }
  }

  void onAuthChanged(AuthState? previous, AuthState next) {
    final pendingNotifier = _ref.read(pendingPushRouteProvider.notifier);
    if (!next.isAuthenticated) {
      // Logout / session ended: whatever was waiting belonged to that session.
      if (previous?.isAuthenticated ?? false) pendingNotifier.state = null;
      return;
    }
    final user = next.username;
    final pending = _ref.read(pendingPushRouteProvider);
    final parkedAfter = _parkedAfterUser;
    if (user != null) _lastUser = user;
    if (pending == null) return;
    pendingNotifier.state = null;
    // A tap parked after user A signed out must not drag a different user B to
    // A's destination (the ids in the path are A's tasks/incidents).
    if (parkedAfter != null && user != null && parkedAfter != user) return;
    _go(pending);
  }

  void _go(String path) {
    // Defer so navigation runs after the current frame / app resume settles.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      try {
        final role = _ref.read(authControllerProvider).role;
        _openOverTab(
          _ref.read(routerProvider),
          path,
          pushBaseTabFor(path, role),
        );
      } catch (_) {
        // router not ready / disposed — nothing to do
      }
    });
  }

  /// UX audit #4: เดิมใช้ `go(path)` ซึ่งแทนที่ stack ทั้งหมด หน้าปลายทางจึงไม่มี
  /// ปุ่ม back และ back ของระบบปิดแอป — วางแท็บฐาน ([pushBaseTabFor]) ก่อนแล้ว
  /// push ปลายทางทับ กด back จึงกลับแท็บนั้นเสมอ ไม่ว่าตอนแตะจะอยู่หน้าไหน
  static void _openOverTab(GoRouter router, String path, String tab) {
    final delegate = router.routerDelegate;
    // uri ของ go_router = หน้าฐานที่ go() ไปล่าสุด (หน้าที่ push ทับไม่เปลี่ยน
    // uri) จึงปิดหน้าที่ push ทับไว้ก่อน (pop ทำทันที) แล้วค่อยดูหน้าฐาน
    String base() => delegate.currentConfiguration.uri.path;
    while (router.canPop()) {
      router.pop();
    }
    if (base() == tab) {
      if (path != tab) router.push(path);
      return;
    }
    router.go(tab);
    if (path == tab) return;
    // go() parse route แบบ async (และ delegate ไม่แจ้ง listener ตอนนั้น) — push
    // ทันทีจะไปซ้อนบน stack เก่าแล้วถูก go() ทับ จึงเช็คทีละ frame จนหน้าฐาน
    // เป็นแท็บนั้นจริงแล้วค่อย push · ไม่ถึง (เช่น redirect ไป login เพราะ session
    // หลุด) ภายใน [_maxFramesToReachTab] frame = เลิก ไม่ค้างไว้ push ทีหลัง
    var frames = 0;
    void check(Duration _) {
      if (base() == tab) {
        router.push(path);
      } else if (++frames < _maxFramesToReachTab) {
        WidgetsBinding.instance
          ..addPostFrameCallback(check)
          ..scheduleFrame();
      }
    }

    WidgetsBinding.instance
      ..addPostFrameCallback(check)
      ..scheduleFrame();
  }

  static const _maxFramesToReachTab = 30;
}

final pushMessageHandlerProvider = Provider<PushMessageHandler>((ref) {
  final handler = PushMessageHandler(ref);
  // A tap that arrived before the session was ready (terminated launch) is
  // opened as soon as the user is authenticated.
  ref.listen(authControllerProvider, handler.onAuthChanged);
  return handler;
});

/// Route from a push tap that couldn't be opened yet because the session was
/// still restoring or the user isn't logged in. Consumed (and cleared) by
/// [PushMessageHandler.onAuthChanged] once authenticated.
final pendingPushRouteProvider = StateProvider<String?>((ref) => null);
