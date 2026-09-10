import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/activity_log/activity_log_navigator_observer.dart';
import '../../features/activity_log/activity_log_repository.dart';
import '../../features/auth/login_page.dart';
import '../../features/config_simulator/simulator_page.dart';
import '../../features/device_connection_test/device_connection_test_page.dart';
import '../../features/device_search/device_detail_page.dart';
import '../../features/device_search/device_search_page.dart';
import '../../features/home/home_page.dart';
import '../../features/notification/notification_list_page.dart';
import '../../features/task/task_detail_page.dart';
import '../../features/task/task_list_page.dart';
import '../auth/auth_controller.dart';

class AppRoutes {
  const AppRoutes._();

  /// Startup route — shown only while [AuthStatus.unknown] (session restore
  /// hasn't resolved yet). Never a destination a user navigates to.
  static const splash = '/';
  static const login = '/login';
  static const home = '/home';
  static const simulator = '/simulator';
  static const deviceConnectionTest = '/device-connection-test';
  static const notifications = '/notifications';

  /// Device Search — `/devices`.
  static const deviceSearch = '/devices';

  /// Device Detail — `/devices/:deviceId`. Use [deviceDetail] to build a
  /// concrete path. Distinct from [deviceSearch] by segment count, so
  /// go_router never confuses the two.
  static const deviceDetailPattern = '/devices/:deviceId';
  static String deviceDetail(String deviceId) => '/devices/$deviceId';

  /// "งานของฉัน" — full task list. `/tasks` (distinct from [taskDetailPattern]
  /// `/tasks/:id` by segment count, so go_router never confuses the two).
  static const myTasks = '/tasks';

  /// Task detail — `/tasks/:id`. Use [taskDetail] to build a concrete path.
  static const taskDetailPattern = '/tasks/:id';
  static String taskDetail(String id) => '/tasks/$id';
}

/// GoRouter wired to [authControllerProvider]: unauthenticated users are pushed
/// to `/login`, and an authenticated user landing on `/login` (or `/`) is
/// sent to `/home`. While the session is still restoring ([AuthStatus.unknown])
/// the router is held at [AppRoutes.splash] — `initialLocation` is `/`, not
/// `/login`, specifically so an already-authenticated user never sees
/// [LoginPage] flash on screen before landing on Home (regression: it used to
/// start at `/login` and "no redirect" while restoring meant staying put —
/// i.e. rendering the login form — until `_restore()`'s microtask resolved).
final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.onDispose(refresh.dispose);
  ref.listen(authControllerProvider, (_, _) => refresh.value++);

  return GoRouter(
    initialLocation: AppRoutes.splash,
    refreshListenable: refresh,
    // Local activity log (docs/10) — record every real screen entry on-device.
    // The repository never throws, so this is safe fire-and-forget.
    observers: [
      ActivityLogNavigatorObserver((route) async {
        await ref
            .read(activityLogRepositoryProvider)
            .record(path: route.path, title: route.title);
        // Home stays mounted under a pushed route, so its
        // `recentActivityProvider` won't refetch on its own when the user pops
        // back — mark it stale after each recorded navigation.
        ref.invalidate(recentActivityProvider);
      }),
    ],
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final atSplash = state.matchedLocation == AppRoutes.splash;

      if (auth.status == AuthStatus.unknown) {
        // Session restore still in flight — hold at splash. Never let this
        // fall through to "stay put", or whatever route we started on
        // (historically `/login`) renders for real.
        return atSplash ? null : AppRoutes.splash;
      }

      final atLogin = state.matchedLocation == AppRoutes.login;
      if (!auth.isAuthenticated) return atLogin ? null : AppRoutes.login;

      // Authenticated: neither splash nor login is a valid resting place.
      if (atLogin || atSplash) return AppRoutes.home;
      return null;
    },
    routes: [
      GoRoute(
        path: AppRoutes.splash,
        builder: (context, state) => const _SplashPage(),
      ),
      GoRoute(
        path: AppRoutes.login,
        builder: (context, state) => const LoginPage(),
      ),
      GoRoute(
        path: AppRoutes.home,
        builder: (context, state) => const HomePage(),
      ),
      GoRoute(
        path: AppRoutes.simulator,
        builder: (context, state) => const SimulatorPage(),
      ),
      GoRoute(
        path: AppRoutes.deviceConnectionTest,
        builder: (context, state) => const DeviceConnectionTestPage(),
      ),
      GoRoute(
        path: AppRoutes.deviceSearch,
        builder: (context, state) => const DeviceSearchPage(),
      ),
      GoRoute(
        path: AppRoutes.deviceDetailPattern,
        builder: (context, state) =>
            DeviceDetailPage(deviceId: state.pathParameters['deviceId']!),
      ),
      GoRoute(
        path: AppRoutes.myTasks,
        builder: (context, state) => const TaskListPage(),
      ),
      GoRoute(
        path: AppRoutes.taskDetailPattern,
        builder: (context, state) =>
            TaskDetailPage(taskId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: AppRoutes.notifications,
        builder: (context, state) => const NotificationListPage(),
      ),
    ],
  );
});

/// Shown only for the brief window while [AuthController] is restoring a
/// persisted session ([AuthStatus.unknown]) — no form, no branding copy, just
/// a neutral loading state so nothing flashes before the redirect to `/login`
/// or `/home` lands. No explicit `backgroundColor`, same as [LoginPage] /
/// other pages — picks up the ambient [ThemeData.colorScheme] so it doesn't
/// flash a different color than the page that follows it.
class _SplashPage extends StatelessWidget {
  const _SplashPage();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}
