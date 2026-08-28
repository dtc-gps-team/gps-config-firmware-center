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
}
