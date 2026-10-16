import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/app_config.dart';

/// CLAUDE.md (Mock Mode Pattern): "default ต้องเป็น mock เสมอ — โหมดที่ยิงระบบ
/// จริงต้องตั้ง env var ชัดเจนถึงจะทำงาน" — so a plain `flutter test` /
/// `flutter run` with no `--dart-define` must land in mock mode.
void main() {
  test('API_MOCK_MODE defaults to mock when no --dart-define is passed', () {
    const passedExplicitly = bool.hasEnvironment('API_MOCK_MODE');
    if (passedExplicitly) {
      markTestSkipped('API_MOCK_MODE passed via --dart-define');
      return;
    }
    expect(AppConfig.apiMockMode, isTrue);
  });
}
