import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config/app_config.dart';
import 'push_token_repository.dart';

/// Orchestrates push registration around the Firebase Messaging SDK.
///
/// **Current state (Android, live):** `AppConfig.pushNotificationsEnabled` is
/// `true`. The real Firebase project (`gps-config-firmware-center`) exists,
/// `android/app/google-services.json` is in place (gitignored — placed
/// per-machine from the Firebase Console), and the
/// `com.google.gms.google-services` Gradle plugin + `POST_NOTIFICATIONS`
/// manifest permission are wired. `AuthController` drives this service from
/// `login()` / `logout()` / `_restore()`, so on the Android build path a real
/// token is now requested and registered with the backend.
///
/// Every public method still guards on the flag first (returns immediately
/// when `false`) — that path stays the effective behaviour on any build
/// without `google-services.json` (e.g. a CI job that skips it) and on iOS,
/// which has no native Firebase config yet (team decision — Android only for
/// this phase). History: shipped `false` as Dart-only scaffolding in PR C
/// (#95) before the Firebase project / native wiring existed. See
/// `docs/05_Mobile_Notification_FCM.md`.
class PushNotificationService {
  PushNotificationService(
    this._tokenRepository, {
    FcmTokenGateway? tokenGateway,
  }) : _tokenGateway = tokenGateway ?? const FirebaseTokenGateway();

  final PushTokenRepository _tokenRepository;
  final FcmTokenGateway _tokenGateway;

  /// Android-only for this phase (team decision — see CLAUDE.md). Hardcoded
  /// rather than derived from `Platform.isAndroid` because iOS/Web
  /// registration isn't implemented at all yet, not merely disabled.
  static const String _platform = 'android';

  StreamSubscription<String>? _tokenRefreshSubscription;

  /// Call after a successful login, and again on session restore (the token
  /// may have rotated while the app was closed). Requests notification
  /// permission, registers the current FCM token, and starts listening for
  /// refreshes so a rotated token gets re-registered automatically.
  /// Call after a successful login, and again on session restore.
  ///
  /// **Never throws** — any Firebase or network error is swallowed so it
  /// can never block or crash a login/restore flow. Push registration is
  /// best-effort: if it fails the user is still logged in and can retry
  /// on the next app launch. Error log is emitted via `debugPrint` for
  /// debugging without crashing the app.
  Future<void> initializeAndRegister() async {
    if (!AppConfig.pushNotificationsEnabled) return;

    try {
      await Firebase.initializeApp();
      await FirebaseMessaging.instance.requestPermission();

      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) {
        await _tokenRepository.register(token: token, platform: _platform);
      }

      await _tokenRefreshSubscription?.cancel();
      _tokenRefreshSubscription = FirebaseMessaging.instance.onTokenRefresh
          .listen(
            (refreshedToken) {
              unawaited(
                _tokenRepository
                    .register(token: refreshedToken, platform: _platform)
                    .catchError((_) {
                      /* best-effort — ignore refresh errors */
                    }),
              );
            },
            onError: (_) {
              /* stream error — ignore */
            },
          );
    } catch (e) {
      // Push registration failed (network down, Firebase error, etc.).
      // Log for debugging but never rethrow — login must succeed regardless.
      // ignore: avoid_print
      debugPrint('[PushNotification] initializeAndRegister failed: $e');
    }
  }

  /// Call before clearing the session on logout. Stops listening for token
  /// refresh, best-effort unregisters the current token with the backend and
  /// deletes it on the device — **never throws**, so a network/Firebase failure here can't block logout.
  Future<void> unregisterAndStop() async {
    if (!AppConfig.pushNotificationsEnabled) return;

    await _tokenRefreshSubscription?.cancel();
    _tokenRefreshSubscription = null;

    try {
      final token = await _tokenGateway.getToken();
      if (token != null) {
        await _tokenRepository.unregister(token);
      }
    } catch (_) {
      // Best-effort cleanup — the user must be able to log out regardless of
      // network state or Firebase errors.
    }

    // Separate from the unregister above so it still runs when that failed
    // (e.g. offline): invalidating the FCM token on the device means a push
    // aimed at the previous user's token can no longer reach this phone, and
    // the next login gets a fresh token.
    try {
      await _tokenGateway.deleteToken();
    } catch (_) {
      // same best-effort rule
    }
  }
}

/// The two FCM token calls logout needs, behind a seam so tests don't need a
/// Firebase platform binding.
abstract class FcmTokenGateway {
  Future<String?> getToken();
  Future<void> deleteToken();
}

class FirebaseTokenGateway implements FcmTokenGateway {
  const FirebaseTokenGateway();

  @override
  Future<String?> getToken() => FirebaseMessaging.instance.getToken();

  @override
  Future<void> deleteToken() => FirebaseMessaging.instance.deleteToken();
}

final pushNotificationServiceProvider = Provider<PushNotificationService>((
  ref,
) {
  return PushNotificationService(ref.watch(pushTokenRepositoryProvider));
});
