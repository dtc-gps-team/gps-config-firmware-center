import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/config/app_config.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/features/home/home_task_feed.dart';

class _Auth extends AuthController {
  _Auth(this.role);
  final UserRole role;
  @override
  AuthState build() => AuthState(
    status: AuthStatus.authenticated,
    role: role,
    username: role == UserRole.st ? 'nont.st' : 'nont.ot',
  );
}

/// ใช้ router และข้อมูล mock เดิม ตรวจ Home/รายการเต็มเท่านั้น ไม่เรียก backend
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('Home r4: ST/OT งานล่าสุด ดูทั้งหมด ตัวกรอง และกลับหน้าแรก', (
    tester,
  ) async {
    expect(AppConfig.apiMockMode, isTrue);
    await binding.convertFlutterSurfaceToImage();
    for (final role in [UserRole.st, UserRole.ot]) {
      for (final scale in [1.0, 2.0]) {
        final container = ProviderContainer(
          overrides: [authControllerProvider.overrideWith(() => _Auth(role))],
        );
        final router = container.read(routerProvider);
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp.router(
              theme: AppTheme.light(),
              routerConfig: router,
              debugShowCheckedModeBanner: false,
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(textScaler: TextScaler.linear(scale)),
                child: child!,
              ),
            ),
          ),
        );
        await tester.pump(const Duration(seconds: 1));
        await tester.pumpAndSettle(
          const Duration(milliseconds: 100),
          EnginePhase.sendSemanticsUpdate,
          const Duration(seconds: 10),
        );
        final view = tester.view.physicalSize / tester.view.devicePixelRatio;
        final prefix =
            'r4-02/${view.width.round()}x${view.height.round()}/${role.wireName}-${scale.toInt()}x';
        Future<void> capture(String name) async {
          expect(tester.takeException(), isNull);
          debugPrint('เก็บภาพ Home: $prefix-$name');
          await binding
              .takeScreenshot('$prefix-$name')
              .timeout(const Duration(seconds: 20));
        }

        final scroll = tester.state<ScrollableState>(
          find
              .byWidgetPredicate(
                (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
              )
              .first,
        );
        expect(scroll.position.maxScrollExtent, 0);
        final body = tester.getRect(find.byKey(const Key('home_overview')));
        final visibleRows = find.byType(HomeTaskRow).hitTestable();
        for (final row in visibleRows.evaluate()) {
          expect(
            tester.getRect(find.byWidget(row.widget)).bottom,
            lessThanOrEqualTo(body.bottom),
          );
        }
        if (view.height.round() == 640 && scale == 2) {
          expect(visibleRows, findsNothing);
          expect(
            find.byKey(const Key('home_compact_all')).hitTestable(),
            findsOneWidget,
          );
        }
        expect(find.textContaining('mock-task-'), findsNothing);
        await capture('home');
        var all = find.byKey(const Key('home_view_all')).hitTestable();
        if (all.evaluate().isEmpty) {
          all = find.byKey(const Key('home_compact_all')).hitTestable();
        }
        expect(all, findsOneWidget);
        await tester.tap(all);
        await tester.pumpAndSettle(
          const Duration(milliseconds: 100),
          EnginePhase.sendSemanticsUpdate,
          const Duration(seconds: 10),
        );
        // push เป็นหน้าลูก จึงตรวจหน้าที่แสดงจริง ไม่ใช้ URL ที่อาจคงเป็น /home
        expect(find.byKey(const Key('home_tasks_search')), findsOneWidget);
        expect(router.canPop(), isTrue);
        expect(find.textContaining('mock-task-'), findsNothing);
        await capture('all');
        await tester.tap(find.byKey(const Key('home_filter_open')));
        await tester.pumpAndSettle();
        await capture('open');
        await tester.tap(find.byTooltip('ย้อนกลับ'));
        await tester.pumpAndSettle();
        expect(router.routeInformationProvider.value.uri.path, AppRoutes.home);
        expect(find.byKey(const Key('home_tasks_search')), findsNothing);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
        container.dispose();
      }
    }
  });
}
