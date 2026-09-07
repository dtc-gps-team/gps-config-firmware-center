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
  /// calls, this picks whether the push feature runs at all. Hardcoded
  /// `false` (not a `--dart-define`) because there is no real Firebase
  /// project yet — `android/`/`ios/` don't have `google-services.json` /
  /// `GoogleService-Info.plist`, so calling the SDK for real would crash.
  ///
  /// Flip to `true` only after: (1) a Firebase project exists, (2) the native
  /// config files are added, (3) the Gradle `com.google.gms.google-services`
  /// plugin is wired in `android/build.gradle` / `android/app/build.gradle` —
  /// all native wiring, done in a separate PR (see
  /// `docs/05_Mobile_Notification_FCM.md`). Until then this whole feature
  /// (`features/push_notification/`) is Dart-only scaffolding that never
  /// touches the Firebase SDK.
  static const bool pushNotificationsEnabled = false;
}
