import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/notification/notification_repository.dart';
import '../api/models.dart';
import '../auth/auth_controller.dart';
import '../theme/app_tokens.dart';
import '../ui/app_v2_theme.dart';
import 'app_router.dart';

/// แท็บด้านล่าง (docs/22 §7.2) — ลำดับใน enum = ลำดับ branch ใน
/// `StatefulShellRoute` ของ [routerProvider] (ใช้ `index` แทนกันได้)
enum AppTab {
  home(AppRoutes.home),
  devices(AppRoutes.deviceSearch),
  incidents(AppRoutes.incidents),
  notifications(AppRoutes.notifications);

  const AppTab(this.location);

  /// หน้าแรกของแท็บ (ราก stack ของ branch)
  final String location;
}

/// ช่าง (ST / OT) — `GET /tasks` self-scope ให้เฉพาะสอง role นี้ (role อื่นได้งาน
/// ทั้งระบบ) จึงมีแท็บหน้าแรก (งาน) เฉพาะช่าง
bool isFieldStaff(UserRole? role) => role == UserRole.st || role == UserRole.ot;

/// แท็บที่ role เห็น ซ้าย → ขวา (docs/22 §7.2) · Operation ไม่มีแท็บงาน
List<AppTab> tabsFor(UserRole? role) => isFieldStaff(role)
    ? AppTab.values
    : const [AppTab.devices, AppTab.incidents, AppTab.notifications];

/// หน้าที่เปิดหลัง login — ช่างเข้าหน้าแรก Operation เข้า Device Search
String landingFor(UserRole? role) => tabsFor(role).first.location;

/// โครงหน้าระดับแท็บ: เนื้อหาของแท็บที่เลือก + แถบแท็บด้านล่าง · หน้าลูก (Task
/// Detail, Device Detail ฯลฯ) อยู่นอก shell จึง push ทับทั้งแถบ (§7.2)
class AppTabShell extends ConsumerWidget {
  const AppTabShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final role = ref.watch(authControllerProvider.select((s) => s.role));
    final tabs = tabsFor(role);
    final current = AppTab.values[shell.currentIndex];
    final selected = tabs.indexOf(current);
    return Scaffold(
      body: shell,
      bottomNavigationBar: AppV2Theme(
        child: AppTabBar(
          tabs: tabs,
          selectedIndex: selected < 0 ? 0 : selected,
          onSelected: (i) {
            final branch = tabs[i].index;
            // แตะแท็บที่อยู่แล้ว = กลับรากของแท็บนั้น (แบบแอปทั่วไป)
            shell.goBranch(
              branch,
              initialLocation: branch == shell.currentIndex,
            );
          },
        ),
      ),
    );
  }
}

/// แถบแท็บ: พื้น `card` + เส้นบน `border` · แท็บที่เลือก = `primary` บนพื้น
/// `accent` · ที่ไม่เลือก = `muted-foreground` · แท็บแจ้งเตือนมีตัวเลขยังไม่อ่าน
/// (แทนกระดิ่งบนหัวหน้าแรกเดิม)
class AppTabBar extends ConsumerWidget {
  const AppTabBar({
    super.key,
    required this.tabs,
    required this.selectedIndex,
    required this.onSelected,
  });

  final List<AppTab> tabs;
  final int selectedIndex;
  final ValueChanged<int> onSelected;

  static Color _color(Set<WidgetState> states) =>
      states.contains(WidgetState.selected)
      ? AppColors.primary
      : AppColors.mutedForeground;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = ref.watch(unreadNotificationCountProvider).valueOrNull ?? 0;
    return DecoratedBox(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: NavigationBarTheme(
        data: NavigationBarThemeData(
          backgroundColor: AppColors.card,
          surfaceTintColor: Colors.transparent,
          indicatorColor: AppColors.accent,
          elevation: 0,
          height: 64,
          labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
          iconTheme: WidgetStateProperty.resolveWith(
            (states) => IconThemeData(color: _color(states), size: 24),
          ),
          labelTextStyle: WidgetStateProperty.resolveWith(
            (states) => TextStyle(
              fontSize: AppTypography.xs,
              height: AppTypography.xsHeight,
              fontWeight: states.contains(WidgetState.selected)
                  ? FontWeight.w600
                  : FontWeight.w400,
              color: _color(states),
            ),
          ),
        ),
        child: NavigationBar(
          key: const Key('app_tab_bar'),
          selectedIndex: selectedIndex,
          onDestinationSelected: onSelected,
          destinations: [for (final tab in tabs) _destination(tab, unread)],
        ),
      ),
    );
  }

  static Widget _destination(AppTab tab, int unread) {
    final (label, icon, selectedIcon) = switch (tab) {
      // ชื่อตาม docs/22 §6.2 — มีคู่เทียบใน Web ใช้คำของ Web ไม่มีคงไทย
      AppTab.home => ('หน้าแรก', Icons.home_outlined, Icons.home),
      AppTab.devices => ('Device Search', Icons.search, Icons.search),
      AppTab.incidents => (
        'Incidents',
        Icons.report_problem_outlined,
        Icons.report_problem,
      ),
      AppTab.notifications => (
        'แจ้งเตือน',
        Icons.notifications_outlined,
        Icons.notifications,
      ),
    };
    Widget withBadge(IconData data) {
      final iconWidget = Icon(data);
      if (tab != AppTab.notifications || unread == 0) return iconWidget;
      return Badge(
        key: const Key('tab_notifications_badge'),
        label: Text(unread > 99 ? '99+' : '$unread'),
        backgroundColor: AppColors.destructive,
        textColor: AppColors.primaryForeground,
        child: iconWidget,
      );
    }

    return NavigationDestination(
      key: Key('tab_${tab.name}'),
      icon: withBadge(icon),
      selectedIcon: withBadge(selectedIcon),
      label: label,
      tooltip: unread > 0 && tab == AppTab.notifications
          ? '$label (ยังไม่อ่าน $unread)'
          : label,
    );
  }
}
