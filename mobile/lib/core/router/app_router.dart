import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/login_page.dart';
import '../../features/config_simulator/simulator_page.dart';
import '../../features/home/home_page.dart';
import '../auth/auth_controller.dart';

class AppRoutes {
  const AppRoutes._();

  static const login = '/login';
  static const home = '/home';
  static const simulator = '/simulator';
}

/// GoRouter wired to [authControllerProvider]: unauthenticated users are pushed
/// to `/login`, and an authenticated user landing on `/login` is sent to
/// `/home`. While the session is still restoring ([AuthStatus.unknown]) no
/// redirect happens.
final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.onDispose(refresh.dispose);
  ref.listen(authControllerProvider, (_, _) => refresh.value++);

  return GoRouter(
    initialLocation: AppRoutes.login,
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      if (auth.status == AuthStatus.unknown) return null;

      final atLogin = state.matchedLocation == AppRoutes.login;
      if (!auth.isAuthenticated) return atLogin ? null : AppRoutes.login;
      if (atLogin) return AppRoutes.home;
      return null;
    },
    routes: [
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
    ],
  );
});
