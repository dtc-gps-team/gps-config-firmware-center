import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/config/app_config.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/core/router/app_shell.dart';
import 'package:mobile/core/theme/app_theme.dart';

class _PreviewAuth extends AuthController {
  _PreviewAuth(this.role);
  final UserRole role;

  @override
  AuthState build() => AuthState(
    status: AuthStatus.authenticated,
    role: role,
    username: '${role.wireName.toLowerCase()}.demo',
  );
}

/// เก็บภาพหน้าจาก router จริงด้วยข้อมูล mock โดยไม่สมัคร push หรือเรียก backend
/// ใช้ screenshot driver เดิมร่วมกับ API_MOCK_MODE=true
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('พื้นฐาน r4: หน้าราก ST / OT / Operation และขนาดตัวอักษร', (
    tester,
  ) async {
    expect(AppConfig.apiMockMode, isTrue);
    await binding.convertFlutterSurfaceToImage();
    for (final role in [UserRole.st, UserRole.ot, UserRole.operation]) {
      for (final scale in [1.0, 1.1, 1.2, 1.3, 2.0]) {
        final container = ProviderContainer(
          overrides: [
            authControllerProvider.overrideWith(() => _PreviewAuth(role)),
          ],
        );
        final router = container.read(routerProvider);
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp.router(
              theme: AppTheme.light(),
              debugShowCheckedModeBanner: false,
              routerConfig: router,
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(textScaler: TextScaler.linear(scale)),
                child: child!,
              ),
            ),
          ),
        );
        await tester.pumpAndSettle(
          const Duration(milliseconds: 100),
          EnginePhase.sendSemanticsUpdate,
          const Duration(seconds: 10),
        );
        for (final tab in tabsFor(role)) {
          debugPrint('ตรวจภาพ r4: ${role.wireName} / ${scale}x / ${tab.name}');
          await tester.tap(find.byKey(Key('tab_${tab.name}')));
          // ข้อมูล mock จบด้วย timer จึงรอเพิ่มก่อนถ่ายภาพ เพราะ pumpAndSettle
          // อาจจบทันทีเมื่อไม่มี animation แม้ข้อมูลยังโหลดไม่ครบ
          await tester.pump(const Duration(seconds: 1));
          await tester.pumpAndSettle(
            const Duration(milliseconds: 100),
            EnginePhase.sendSemanticsUpdate,
            const Duration(seconds: 10),
          );
          expect(tester.takeException(), isNull);
          final viewport = MediaQuery.sizeOf(
            tester.element(find.byType(AppTabBar)),
          );
          await binding
              .takeScreenshot(
                'r4-01/${viewport.width.round()}x${viewport.height.round()}/${role.wireName}-${tab.name}-${scale}x',
              )
              .timeout(const Duration(seconds: 20));
          debugPrint('เก็บภาพแล้ว');
        }
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
        container.dispose();
      }
    }
  });
}
