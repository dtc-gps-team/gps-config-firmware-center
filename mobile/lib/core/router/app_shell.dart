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

/// แถบเมนู r4 เปลี่ยนเฉพาะหน้าตา การสลับแท็บและ stack ยังใช้ StatefulShellRoute เดิม
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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = ref.watch(unreadNotificationCountProvider).valueOrNull ?? 0;
    return ColoredBox(
      color: AppColors.background,
      child: SafeArea(
        top: false,
        minimum: AppDockTokens.margin,
        child: Material(
          key: const Key('app_tab_bar'),
          color: AppColors.primary,
          borderRadius: BorderRadius.circular(AppDockTokens.radius),
          child: Padding(
            padding: const EdgeInsets.all(AppDockTokens.padding),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                for (var i = 0; i < tabs.length; i++) ...[
                  if (i > 0) const SizedBox(width: AppDockTokens.gap),
                  Expanded(
                    child: AppTabButton(
                      key: Key('tab_${tabs[i].name}'),
                      tab: tabs[i],
                      selected: i == selectedIndex,
                      unread: unread,
                      onTap: () => onSelected(i),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// ปุ่มแท็บที่มีชื่อและคำสั่งแตะสำหรับโปรแกรมอ่านหน้าจอ เมื่อข้อความโตใช้แนวตั้งและตัดระหว่างคำ
class AppTabButton extends StatelessWidget {
  const AppTabButton({
    super.key,
    required this.tab,
    required this.selected,
    required this.unread,
    required this.onTap,
  });
  final AppTab tab;
  final bool selected;
  final int unread;
  final VoidCallback onTap;

  String get label => switch (tab) {
    AppTab.home => 'หน้าแรก',
    AppTab.devices => 'Device Search',
    AppTab.incidents => 'Incidents',
    AppTab.notifications => 'แจ้งเตือน',
  };

  @override
  Widget build(BuildContext context) {
    final baseSize = selected
        ? AppDockTokens.selectedLabelSize
        : AppDockTokens.labelSize;
    final maxSize = selected
        ? AppDockTokens.maxSelectedLabelSize
        : AppDockTokens.maxLabelSize;
    // รับ text scale รวมถึงค่าระหว่าง 1.1–1.3 อย่างต่อเนื่อง แต่จำกัดเพดานตาม r4
    // เพื่อให้ชื่อแท็บอ่านครบเป็นคำบนจอเล็ก ไม่ล็อกขนาดตั้งแต่ scale 1 เท่า
    final labelScaler = MediaQuery.textScalerOf(
      context,
    ).clamp(maxScaleFactor: maxSize / baseSize);
    final large =
        labelScaler.scale(baseSize) >
        baseSize * AppDockTokens.verticalLayoutScale;
    final fg = selected
        ? AppColors.tabSelectedForeground
        : AppColors.onInkMuted;
    final icon = switch (tab) {
      AppTab.home => selected ? Icons.home : Icons.home_outlined,
      AppTab.devices => Icons.search,
      AppTab.incidents => Icons.report_problem_outlined,
      AppTab.notifications =>
        selected ? Icons.notifications : Icons.notifications_outlined,
    };
    Widget symbol = Icon(icon, size: AppDockTokens.iconSize, color: fg);
    final hasBadge = tab == AppTab.notifications && unread > 0;
    if (hasBadge) {
      symbol = Badge(
        key: const Key('tab_notifications_badge'),
        label: Text(
          unread > 99 ? '99+' : '$unread',
          textScaler: TextScaler.noScaling,
          style: const TextStyle(
            fontSize: AppDockTokens.badgeLabelSize,
            fontWeight: FontWeight.w700,
          ),
        ),
        backgroundColor: AppColors.notificationBadge,
        textColor: AppColors.onNotificationBadge,
        child: symbol,
      );
    }
    final text = Text(
      label,
      textAlign: TextAlign.center,
      textScaler: labelScaler,
      style: TextStyle(
        fontFamily: AppTypography.fontFamily,
        fontSize: baseSize,
        height: AppDockTokens.labelHeight,
        fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
        color: fg,
      ),
    );
    return Semantics(
      button: true,
      selected: selected,
      label: hasBadge ? '$label (ยังไม่อ่าน $unread)' : label,
      // รวมชื่อและจำนวนยังไม่อ่านเป็น node เดียว ไม่ให้อ่านไอคอน/ข้อความซ้ำ
      // เมื่อตัด semantics ของลูก ต้องใส่คำสั่งแตะคืนให้ TalkBack ด้วย
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppDockTokens.itemRadius),
        child: Ink(
          decoration: BoxDecoration(
            color: selected ? AppColors.onInk : Colors.transparent,
            borderRadius: BorderRadius.circular(AppDockTokens.itemRadius),
          ),
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: AppDockTokens.minTarget,
            ),
            child: Padding(
              padding: AppDockTokens.itemPadding,
              child: LayoutBuilder(
                builder: (context, constraints) {
                  // วางชื่อแท็บข้างไอคอนเฉพาะเมื่อพอ ต้องวัดด้วยฟอนต์และ text scale ที่วาดจริง
                  final painter = TextPainter(
                    text: TextSpan(
                      text: label,
                      style: DefaultTextStyle.of(
                        context,
                      ).style.merge(text.style),
                    ),
                    textDirection: Directionality.of(context),
                    textScaler: labelScaler,
                  )..layout();
                  final horizontal =
                      selected &&
                      !large &&
                      painter.width +
                              AppDockTokens.iconSize +
                              AppDockTokens.horizontalGap +
                              AppDockTokens.textMeasurementSlack <=
                          constraints.maxWidth;
                  painter.dispose();
                  if (horizontal) {
                    return Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        symbol,
                        const SizedBox(width: AppDockTokens.horizontalGap),
                        Flexible(child: text),
                      ],
                    );
                  }
                  return Column(
                    mainAxisSize: MainAxisSize.min,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      symbol,
                      const SizedBox(height: AppDockTokens.verticalGap),
                      text,
                    ],
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}
