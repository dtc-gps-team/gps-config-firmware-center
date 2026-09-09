/// Compile-time configuration, injected via `--dart-define`.
///
/// Example (mock auth, no backend needed):
/// ```
/// flutter run --dart-define=API_MOCK_MODE=true
/// ```
class AppConfig {
  const AppConfig._();

  /// When true the app uses in-memory fakes instead of calling the backend.
  /// Lets the team build UI while `[A]` finishes the real auth service.
  static const bool apiMockMode = bool.fromEnvironment(
    'API_MOCK_MODE',
    defaultValue: false,
  );

  /// Base URL of the GPS Config & Firmware Center API (`openapi.yaml` `servers`).
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3001/api/v1',
  );

  /// Gates every call into the Firebase Messaging SDK app-wide (permission
  /// request, `getToken()`, `onTokenRefresh`, ...) — separate from
  /// [apiMockMode] on purpose: `apiMockMode` picks mock vs. real for backend
  /// calls, this picks whether the push feature runs at all.
  ///
  /// **Android only** (team decision — see CLAUDE.md); iOS has no
  /// `GoogleService-Info.plist` / APNs setup yet, so a real SDK call there
  /// would still crash. `initializeAndRegister()` is only driven on the
  /// Android build path today.
  ///
  /// History: shipped as `false` in PR C (Dart scaffolding, #95) — there was
  /// no Firebase project and no native `google-services.json` / Gradle plugin,
  /// so calling the SDK for real would have crashed. Flipped to `true` once
  /// the real Firebase project (`gps-config-firmware-center`) existed and the
  /// native Android wiring landed: `google-services.json` in `android/app/`
  /// (gitignored — placed per-machine from the Firebase Console), the
  /// `com.google.gms.google-services` Gradle plugin in
  /// `android/settings.gradle.kts` + `android/app/build.gradle.kts`, and the
  /// `POST_NOTIFICATIONS` manifest permission. See
  /// `docs/05_Mobile_Notification_FCM.md`.
  ///
  /// Default `true` (dev/prod Android). The E2E CI job
  /// (`.github/workflows/mobile-integration-test.yml`) builds with only a
  /// placeholder `google-services.json`, so it passes
  /// `--dart-define=PUSH_NOTIFICATIONS_ENABLED=false` — otherwise
  /// `FirebaseMessaging.requestPermission()` throws in the emulator and fails
  /// every integration test at login.
  static const bool pushNotificationsEnabled = bool.fromEnvironment(
    'PUSH_NOTIFICATIONS_ENABLED',
    defaultValue: true,
  );
}
