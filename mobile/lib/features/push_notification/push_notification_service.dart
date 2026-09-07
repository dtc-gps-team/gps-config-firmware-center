import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config/app_config.dart';
import 'push_token_repository.dart';

/// Orchestrates push registration around the Firebase Messaging SDK.
///
/// **Current state (PR C, Dart-level only):** `AppConfig.pushNotificationsEnabled`
/// is hardcoded `false` — there is no real Firebase project yet, so
/// `android/`/`ios/` have no `google-services.json` /
/// `GoogleService-Info.plist`. Every public method below starts with a guard
/// on that flag and returns immediately when it is `false`, so nothing in
/// this class ever calls into the Firebase SDK today. `AuthController`
/// already calls into this service from `login()` / `logout()` / `_restore()`
/// — flipping the flag to `true` (after native Firebase config + the Gradle
/// `com.google.gms.google-services` plugin are wired in a separate PR) is the
/// only change needed to turn registration on for real. See
/// `docs/05_Mobile_Notification_FCM.md`.
class PushNotificationService {
  PushNotificationService(this._tokenRepository);

  final PushTokenRepository _tokenRepository;

  /// Android-only for this phase (team decision — see CLAUDE.md). Hardcoded
  /// rather than derived from `Platform.isAndroid` because iOS/Web
  /// registration isn't implemented at all yet, not merely disabled.
  static const String _platform = 'android';

  StreamSubscription<String>? _tokenRefreshSubscription;

  /// Call after a successful login, and again on session restore (the token
  /// may have rotated while the app was closed). Requests notification
  /// permission, registers the current FCM token, and starts listening for
  /// refreshes so a rotated token gets re-registered automatically.
  Future<void> initializeAndRegister() async {
    if (!AppConfig.pushNotificationsEnabled) return;

    await Firebase.initializeApp();
    await FirebaseMessaging.instance.requestPermission();

    final token = await FirebaseMessaging.instance.getToken();
    if (token != null) {
      await _tokenRepository.register(token: token, platform: _platform);
    }

    await _tokenRefreshSubscription?.cancel();
    _tokenRefreshSubscription = FirebaseMessaging.instance.onTokenRefresh
        .listen((refreshedToken) {
          unawaited(
            _tokenRepository.register(
              token: refreshedToken,
              platform: _platform,
            ),
          );
        });
  }

  /// Call before clearing the session on logout. Stops listening for token
  /// refresh and best-effort unregisters the current token — **never
  /// throws**, so a network/Firebase failure here can't block logout.
  Future<void> unregisterAndStop() async {
    if (!AppConfig.pushNotificationsEnabled) return;

    await _tokenRefreshSubscription?.cancel();
    _tokenRefreshSubscription = null;

    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) {
        await _tokenRepository.unregister(token);
      }
    } catch (_) {
      // Best-effort cleanup — the user must be able to log out regardless of
      // network state or Firebase errors.
    }
  }
}

final pushNotificationServiceProvider = Provider<PushNotificationService>((
  ref,
) {
  return PushNotificationService(ref.watch(pushTokenRepositoryProvider));
});
