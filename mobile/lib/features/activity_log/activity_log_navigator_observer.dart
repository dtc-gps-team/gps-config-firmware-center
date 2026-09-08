import 'package:flutter/widgets.dart';

import '../../core/router/app_router.dart';

/// The resolved "where the user went" for one navigation, ready to store as an
/// [ActivityLogType.navigation] `detail`.
class ActivityRoute {
  const ActivityRoute({required this.path, required this.title});

  final String path;
  final String title;
}

/// Thai title for each real destination. `null` → **don't record** (splash and
/// login aren't useful activity — splash isn't a user action, login is the
/// pre-auth screen; see `docs/10` §6.2).
///
/// `name` is the GoRoute **path pattern** (go_router sets the page name to
/// `state.name ?? state.path`) — e.g. `/tasks/:id`, not the concrete path.
/// [arguments] is go_router's `{...pathParameters, ...queryParameters}` map.
ActivityRoute? resolveActivityRoute(String? name, Object? arguments) {
  switch (name) {
    case AppRoutes.home:
      return const ActivityRoute(path: AppRoutes.home, title: 'หน้าหลัก');
    case AppRoutes.simulator:
      return const ActivityRoute(
        path: AppRoutes.simulator,
        title: 'ทดสอบการตั้งค่า',
      );
    case AppRoutes.deviceConnectionTest:
      return const ActivityRoute(
        path: AppRoutes.deviceConnectionTest,
        title: 'ทดสอบสัญญาณ',
      );
    case AppRoutes.notifications:
      return const ActivityRoute(
        path: AppRoutes.notifications,
        title: 'การแจ้งเตือน',
      );
    case AppRoutes.taskDetailPattern:
      // rebuild the concrete path from the resolved :id when available
      final id = arguments is Map ? arguments['id']?.toString() : null;
      final path = (id != null && id.isNotEmpty)
          ? AppRoutes.taskDetail(id)
          : AppRoutes.taskDetailPattern;
      return ActivityRoute(path: path, title: 'รายละเอียดงาน');
    // AppRoutes.splash, AppRoutes.login, and anything unrecognised
    default:
      return null;
  }
}

/// Records `navigation` activity for real screen entries. Only `didPush` /
/// `didReplace` (entering a new screen) — not `didPop` / `didRemove` (going
/// back to a screen already visited).
class ActivityLogNavigatorObserver extends NavigatorObserver {
  ActivityLogNavigatorObserver(this._record);

  /// fire-and-forget sink — must never throw (see `ActivityLogRepository`).
  final void Function(ActivityRoute route) _record;

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    _log(route);
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    if (newRoute != null) _log(newRoute);
  }

  void _log(Route<dynamic> route) {
    final resolved = resolveActivityRoute(
      route.settings.name,
      route.settings.arguments,
    );
    if (resolved != null) _record(resolved);
  }
}
