import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/login_page.dart';
import '../../features/config_override/config_override_page.dart';
import '../../features/firmware_install/confirm_firmware_install_page.dart';
import '../../features/firmware_override/firmware_override_page.dart';
import '../../features/device_search/device_detail_page.dart';
import '../../features/device_search/device_search_page.dart';
import '../../features/home/home_page.dart';
import '../../features/incident/incident_detail_page.dart';
import '../../features/incident/field_report_page.dart';
import '../../features/incident/incident_list_page.dart';
import '../../features/notification/notification_list_page.dart';
import '../../features/task/apply_config_picker_page.dart';
import '../../features/task/task_detail_page.dart';
import '../api/models.dart';
import '../auth/auth_controller.dart';
import 'app_shell.dart';

class AppRoutes {
  const AppRoutes._();

  /// Startup route — shown only while [AuthStatus.unknown] (session restore
  /// hasn't resolved yet). Never a destination a user navigates to.
  static const splash = '/';
  static const login = '/login';
  static const home = '/home';
  static const notifications = '/notifications';

  /// Incident list (read-only) — `/incidents`.
  static const incidents = '/incidents';

  /// Field Incident Report (ST/OT แจ้งปัญหา, design issue #236) —
  /// `/incident-report` (ไม่ใช้ `/incidents/report` เพราะชนกับ
  /// [incidentDetailPattern] `/incidents/:id`). รับ `?deviceId=` เพื่อ pre-fill.
  static const incidentReport = '/incident-report';

  /// Incident detail — `/incidents/:id`. Use [incidentDetail] to build a path.
  static const incidentDetailPattern = '/incidents/:id';
  static String incidentDetail(String id) => '/incidents/$id';

  /// Device Search — `/devices`.
  static const deviceSearch = '/devices';

  /// Device Detail — `/devices/:deviceId`. Use [deviceDetail] to build a
  /// concrete path. Distinct from [deviceSearch] by segment count, so
  /// go_router never confuses the two.
  static const deviceDetailPattern = '/devices/:deviceId';
  static String deviceDetail(String deviceId) => '/devices/$deviceId';

  /// Config Override — Phase 2 (Mobile, issue #211). `/devices/:deviceId/config-override`
  /// — เห็นเฉพาะปุ่มที่ ST เท่านั้น (Device Detail) แต่ distinct จาก
  /// [deviceDetailPattern] ด้วยจำนวน segment เหมือน [taskDetailPattern].
  static const deviceConfigOverridePattern =
      '/devices/:deviceId/config-override';
  static String deviceConfigOverride(String deviceId) =>
      '/devices/$deviceId/config-override';

  /// Firmware Override — Phase 2 (Mobile, issue #256).
  /// `/devices/:deviceId/firmware-override` — ปุ่มเห็นเฉพาะ ST (Device Detail)
  static const deviceFirmwareOverridePattern =
      '/devices/:deviceId/firmware-override';
  static String deviceFirmwareOverride(String deviceId) =>
      '/devices/$deviceId/firmware-override';

  /// Confirm Firmware Install (issue #261). `/devices/:deviceId/confirm-firmware`
  /// — ปุ่มเห็นเฉพาะ ST/OT (Device Detail)
  static const deviceConfirmFirmwarePattern =
      '/devices/:deviceId/confirm-firmware';
  static String deviceConfirmFirmware(String deviceId) =>
      '/devices/$deviceId/confirm-firmware';

  /// เลือก Config ที่จะส่งเข้ากล่อง (docs/28 §6) — `/devices/:deviceId/apply`
  /// · `?taskId=` = ขอให้งานนี้ (เปิดจากหน้างาน) · ไม่ส่ง = เริ่มงานให้ก่อน
  /// (เปิดจากหน้ากล่อง)
  static const deviceApplyPattern = '/devices/:deviceId/apply';
  static String deviceApply(
    String deviceId, {
    String? taskId,
    bool firmware = false,
  }) {
    final query = {'taskId': ?taskId, if (firmware) 'kind': 'firmware'};
    return Uri(
      path: '/devices/$deviceId/apply',
      queryParameters: query.isEmpty ? null : query,
    ).toString();
  }

  /// Task detail — `/tasks/:id`. Use [taskDetail] to build a concrete path.
  static const taskDetailPattern = '/tasks/:id';
  static String taskDetail(String id) => '/tasks/$id';
}

/// GoRouter wired to [authControllerProvider]: unauthenticated users are pushed
/// to `/login`, and an authenticated user landing on `/login` (or `/`) is
/// sent to their landing tab ([landingFor] — `/home` for ST/OT, Device Search
/// for Operation, docs/22 §7.2). While the session is still restoring ([AuthStatus.unknown])
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
      if (atLogin || atSplash) return landingFor(auth.role);
      // แท็บหน้าแรก (งาน) มีเฉพาะช่าง — role อื่นไม่มีแท็บนี้ (docs/22 §7.2)
      if (state.matchedLocation == AppRoutes.home && !isFieldStaff(auth.role)) {
        return landingFor(auth.role);
      }
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
      // หน้าระดับแท็บ (docs/22 §7.2) — แต่ละแท็บเก็บ stack ของตัวเอง · ลำดับ branch
      // = ลำดับ [AppTab] · หน้าลูกทุกหน้าอยู่นอก shell ด้านล่าง จึง push ทับแถบแท็บ
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppTabShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.home,
                builder: (context, state) => const HomePage(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.deviceSearch,
                builder: (context, state) => const DeviceSearchPage(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.incidents,
                builder: (context, state) => const IncidentListPage(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.notifications,
                builder: (context, state) => const NotificationListPage(),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: AppRoutes.incidentReport,
        builder: (context, state) => FieldReportPage(
          initialDeviceId: state.uri.queryParameters['deviceId'],
        ),
      ),
      GoRoute(
        path: AppRoutes.incidentDetailPattern,
        builder: (context, state) =>
            IncidentDetailPage(incidentId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: AppRoutes.deviceDetailPattern,
        builder: (context, state) =>
            DeviceDetailPage(deviceId: state.pathParameters['deviceId']!),
      ),
      GoRoute(
        path: AppRoutes.deviceConfigOverridePattern,
        builder: (context, state) =>
            ConfigOverridePage(deviceId: state.pathParameters['deviceId']!),
      ),
      GoRoute(
        path: AppRoutes.deviceFirmwareOverridePattern,
        builder: (context, state) =>
            FirmwareOverridePage(deviceId: state.pathParameters['deviceId']!),
      ),
      GoRoute(
        path: AppRoutes.deviceConfirmFirmwarePattern,
        builder: (context, state) => ConfirmFirmwareInstallPage(
          deviceId: state.pathParameters['deviceId']!,
        ),
      ),
      GoRoute(
        path: AppRoutes.deviceApplyPattern,
        builder: (context, state) => ApplyConfigPickerPage(
          deviceId: state.pathParameters['deviceId']!,
          taskId: state.uri.queryParameters['taskId'],
          initialKind: FieldApplyKind.fromWire(
            state.uri.queryParameters['kind'],
          ),
        ),
      ),
      GoRoute(
        path: AppRoutes.taskDetailPattern,
        builder: (context, state) =>
            TaskDetailPage(taskId: state.pathParameters['id']!),
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
