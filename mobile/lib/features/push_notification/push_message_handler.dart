import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/models.dart';
import '../../core/config/app_config.dart';
import '../../core/router/app_router.dart';
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

/// The route to open for an FCM `data` payload (`{'type': ..., 'payload': ...}`).
///
/// Pure + total: never throws, never touches an SDK. Only `task_assigned` with
/// a non-empty string `taskId` deep-links to the task; anything else (unknown
/// type, malformed/missing payload, missing `taskId`) falls back to the
/// notification list. `payload` is normally a JSON string (FCM `data` values
/// are always strings) but an already-decoded map is accepted too.
String resolvePushDeepLink(Map<String, dynamic> data) {
  final type = data['type'];
  if (type != NotificationType.taskAssigned.wireName) {
    return AppRoutes.notifications;
  }

  final payload = _decodePayload(data['payload']);
  final taskId = payload['taskId'];
  if (taskId is! String || taskId.trim().isEmpty) {
    return AppRoutes.notifications;
  }
  return AppRoutes.taskDetail(taskId.trim());
}

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
    body: 'แตะเพื่อดูรายละเอียด',
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

  void _navigate(Map<String, dynamic> data) {
    final path = resolvePushDeepLink(data);
    // Defer so navigation runs after the current frame / app resume settles.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      try {
        _ref.read(routerProvider).go(path);
      } catch (_) {
        // router not ready / disposed — nothing to do
      }
    });
  }
}

final pushMessageHandlerProvider = Provider<PushMessageHandler>((ref) {
  return PushMessageHandler(ref);
});
