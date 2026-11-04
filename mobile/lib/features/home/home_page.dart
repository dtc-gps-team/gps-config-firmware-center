import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/router/app_router.dart';
import '../../core/router/app_shell.dart';
import '../../core/sync/sync_providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_empty_state.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/ui/labels.dart';
import '../../core/widgets/app_error_view.dart';
import '../auth/account_sheet.dart';
import '../task/task_repository.dart';
import 'home_status_banners.dart';
import 'home_task_feed.dart';
import 'home_tokens.dart';

/// หน้าแรก r4 ของ ST/OT ใช้ taskListProvider เดิม ไม่เพิ่ม API หรือรวมกิจกรรม
/// ชนิดอื่นที่ยังไม่มี contract บน main และไม่อนุมานสถานะอนุมัติจากสถานะงาน
class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final staff = isFieldStaff(auth.role);
    return AppV2Theme(
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: SystemUiOverlayStyle.light,
        child: Scaffold(
          backgroundColor: AppColors.background,
          body: RefreshIndicator(
            onRefresh: () => staff
                ? ref.refresh(taskListProvider.future)
                : Future<void>.value(),
            // เนื้อหาสูงเท่า viewport เสมอ จึงไม่เลื่อน แต่ยังส่ง overscroll ให้ดึงโหลดใหม่ได้
            child: CustomScrollView(
              key: const Key('home_fixed_viewport'),
              physics: const AlwaysScrollableScrollPhysics(
                parent: ClampingScrollPhysics(),
              ),
              slivers: [
                SliverFillRemaining(
                  hasScrollBody: true,
                  child: Column(
                    children: [
                      _HomeHero(auth: auth),
                      if (staff)
                        const Expanded(
                          child: Padding(
                            padding: HomeTokens.overviewPadding,
                            child: _HomeOverview(),
                          ),
                        )
                      else
                        const Spacer(),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _HomeHero extends StatelessWidget {
  const _HomeHero({required this.auth});
  final AuthState auth;
  @override
  Widget build(BuildContext context) {
    final large =
        MediaQuery.textScalerOf(context).scale(1) >= HomeTokens.largeTextScale;
    final name = auth.username ?? roleDescription(auth.role);
    final account = IconButton(
      key: const Key('account_button'),
      tooltip: 'บัญชีผู้ใช้',
      onPressed: () => showAccountSheet(context),
      style: IconButton.styleFrom(
        backgroundColor: AppColors.onInk.withValues(alpha: 0.05),
        foregroundColor: AppColors.onInk,
        side: BorderSide(color: AppColors.onInk.withValues(alpha: 0.25)),
        fixedSize: const Size.square(HomeTokens.target),
      ),
      icon: Text(
        accountInitials(auth.username).substring(0, 1),
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          color: AppColors.onInk,
        ),
      ),
    );
    final username = Semantics(
      header: true,
      child: Text(
        name,
        maxLines: large ? 1 : 2,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(
          fontSize: HomeTokens.heroNameSize,
          height: 1.25,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.6,
          color: AppColors.onInk,
        ),
      ),
    );
    return Container(
      key: const Key('home_hero'),
      decoration: const BoxDecoration(
        color: AppColors.primary,
        borderRadius: BorderRadius.vertical(
          bottom: Radius.circular(HomeTokens.heroRadius),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (large)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: username),
                    const SizedBox(width: 10),
                    account,
                  ],
                )
              else ...[
                Row(
                  children: [
                    const Icon(
                      Icons.location_on_outlined,
                      size: 16,
                      color: AppColors.primarySubtle,
                    ),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Text(
                        'GPS TECH',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 2,
                          color: AppColors.onInk,
                        ),
                      ),
                    ),
                    account,
                  ],
                ),
                const SizedBox(height: 6),
                username,
                Wrap(
                  spacing: 7,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      roleDescription(auth.role),
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.onInkMuted,
                      ),
                    ),
                    Text(
                      auth.role == null ? '' : roleLabel(auth.role!),
                      style: const TextStyle(
                        fontSize: 10,
                        color: AppColors.onInk,
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 14),
              Material(
                color: AppColors.card,
                borderRadius: BorderRadius.circular(HomeTokens.searchRadius),
                child: InkWell(
                  key: const Key('home_search_entry'),
                  borderRadius: BorderRadius.circular(HomeTokens.searchRadius),
                  onTap: () => context.go(AppRoutes.deviceSearch),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(
                      minHeight: HomeTokens.searchHeight,
                    ),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(15, 4, 4, 4),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.search,
                            size: 20,
                            color: AppColors.mutedForeground,
                          ),
                          const SizedBox(width: 10),
                          const Expanded(
                            child: Text(
                              'ค้นหาด้วยเลขเครื่อง หรือเบอร์ซิม',
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 14,
                                height: 1.4,
                                color: AppColors.mutedForeground,
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Container(
                            width: HomeTokens.target,
                            height: HomeTokens.target,
                            decoration: BoxDecoration(
                              color: AppColors.primarySubtle,
                              borderRadius: BorderRadius.circular(
                                HomeTokens.searchArrowRadius,
                              ),
                            ),
                            child: const Icon(
                              Icons.arrow_forward,
                              size: 20,
                              color: AppColors.accentForeground,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Shortcuts extends StatelessWidget {
  const _Shortcuts();
  @override
  Widget build(BuildContext context) {
    final large =
        MediaQuery.textScalerOf(context).scale(1) >= HomeTokens.largeTextScale;
    Widget button(String key, String label, IconData icon, VoidCallback tap) =>
        Material(
          color: AppColors.card,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: const BorderSide(color: AppColors.border),
          ),
          child: InkWell(
            key: Key(key),
            onTap: tap,
            borderRadius: BorderRadius.circular(18),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 56),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                child: Row(
                  children: [
                    if (!large) ...[
                      Icon(icon, size: 20, color: AppColors.accentForeground),
                      const SizedBox(width: 10),
                    ],
                    Expanded(
                      child: Text(
                        label,
                        style: const TextStyle(
                          fontSize: 13,
                          height: 1.3,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
    // B (30/10/2026): ปุ่ม "แจ้งปัญหา" อยู่บนหน้าแรกเท่านั้น (เอาออกจาก
    // รายการ Incidents แล้ว)
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: button(
            'home_incidents_shortcut',
            'Incidents',
            Icons.report_problem_outlined,
            () => context.go(AppRoutes.incidents),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: button(
            'home_report_shortcut',
            'แจ้งปัญหา',
            Icons.add,
            () => context.push(AppRoutes.incidentReport),
          ),
        ),
      ],
    );
  }
}

class _HomeOverview extends ConsumerWidget {
  const _HomeOverview();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasks = ref.watch(taskListProvider);
    final pending =
        ref.watch(pendingTaskIdsProvider).valueOrNull ?? const <String>{};
    void all() => context.push(AppRoutes.homeAll);
    Widget fallback(String label, {VoidCallback? tap, Key? key}) =>
        OutlinedButton(
          key: key,
          onPressed: tap,
          child: Text(label, textAlign: TextAlign.start),
        );
    Widget layout(
      List<Widget> rows,
      Widget compact, {
      Widget caption = const SizedBox.shrink(),
    }) {
      return ClipRect(
        key: const Key('home_overview'),
        child: CustomMultiChildLayout(
          delegate: _HomeOverviewDelegate(rowCount: rows.length),
          children: [
            LayoutId(id: _HomeSlot.shortcuts, child: _Shortcuts()),
            LayoutId(
              id: _HomeSlot.alerts,
              child: HomeStatusBanners(showSummary: false),
            ),
            LayoutId(
              id: _HomeSlot.summary,
              child: HomeStatusBanners(
                showBanners: false,
                onSummaryTap: () =>
                    context.push('${AppRoutes.homeAll}?filter=open'),
              ),
            ),
            LayoutId(
              id: _HomeSlot.heading,
              child: Wrap(
                alignment: WrapAlignment.spaceBetween,
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 10,
                children: [
                  Semantics(
                    header: true,
                    child: const Text(
                      'งานล่าสุด',
                      style: TextStyle(
                        fontSize: HomeTokens.titleSize,
                        height: 1.3,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  TextButton(
                    key: const Key('home_view_all'),
                    style: TextButton.styleFrom(
                      minimumSize: const Size(48, 48),
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                    ),
                    onPressed: all,
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Flexible(
                          child: Text(
                            'ดูทั้งหมด',
                            style: TextStyle(fontSize: 12.5),
                          ),
                        ),
                        Icon(Icons.chevron_right, size: 16),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            LayoutId(id: _HomeSlot.fallback, child: compact),
            LayoutId(id: _HomeSlot.caption, child: caption),
            LayoutId(
              id: _HomeSlot.compactAlerts,
              child: TextButton.icon(
                key: const Key('home_compact_status'),
                icon: const Icon(Icons.info_outline),
                label: const Text('ดูสถานะการซิงก์'),
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  useRootNavigator: true,
                  isScrollControlled: true,
                  builder: (_) => const AppV2Theme(
                    child: SafeArea(
                      child: SingleChildScrollView(
                        padding: EdgeInsets.all(18),
                        child: HomeStatusBanners(showSummary: false),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            for (var i = 0; i < rows.length; i++)
              LayoutId(id: i, child: rows[i]),
          ],
        ),
      );
    }

    return tasks.when(
      skipLoadingOnRefresh: true,
      loading: () => layout([
        const AppListSkeleton(
          key: Key('home_recent_loading'),
          padding: EdgeInsets.zero,
        ),
      ], fallback('กำลังโหลดงาน')),
      error: (error, _) => layout(
        [
          AppErrorView(
            message: error is ApiException
                ? error.message
                : 'โหลดงานล่าสุดไม่สำเร็จ',
            onRetry: () => ref.invalidate(taskListProvider),
            messageKey: const Key('my_tasks_error'),
            retryKey: const Key('my_tasks_retry'),
          ),
        ],
        fallback(
          'โหลดงานไม่สำเร็จ · ลองอีกครั้ง',
          tap: () => ref.invalidate(taskListProvider),
          key: const Key('home_compact_retry'),
        ),
      ),
      data: (items) {
        if (items.isEmpty) {
          return layout([
            const AppEmptyState(
              icon: Icons.assignment_outlined,
              message: 'ยังไม่มีงานที่ได้รับมอบหมาย',
              messageKey: Key('my_tasks_empty'),
            ),
          ], fallback('ยังไม่มีงานที่ได้รับมอบหมาย'));
        }
        final recent = recentHomeTasks(items).take(HomeTokens.previewLimit);
        return layout(
          [
            for (final task in recent)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: HomeTaskRow(
                  key: Key('home_recent_${task.id}'),
                  task: task,
                  pendingSync: pending.contains(task.id),
                  onTap: () => context.push(AppRoutes.taskDetail(task.id)),
                ),
              ),
          ],
          fallback(
            'ดูทั้งหมด ${items.length} รายการ',
            tap: all,
            key: const Key('home_compact_all'),
          ),
          caption: Text(
            'ทั้งหมด ${items.length} รายการ · รายการที่เหลืออยู่ใน “ดูทั้งหมด”',
            key: const Key('home_preview_caption'),
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 11,
              height: 1.5,
              color: AppColors.mutedForeground,
            ),
          ),
        );
      },
    );
  }
}

enum _HomeSlot {
  shortcuts,
  alerts,
  summary,
  heading,
  fallback,
  caption,
  compactAlerts,
}

/// วัดขนาดจริงทุกแถว ไม่เดาจาก text scale หรือความสูงจอ
/// วางเฉพาะแถวที่พอดีทั้งใบ ส่วนที่ไม่แสดงอยู่นอก ClipRect จึงไม่ถูกวาด/แตะ/อ่านซ้ำ
/// สูงสุดเพียง3แถว จึงไม่ต้องเพิ่ม query หรือสร้างรายการทั้งหมดเพื่อวัด
class _HomeOverviewDelegate extends MultiChildLayoutDelegate {
  _HomeOverviewDelegate({required this.rowCount});
  final int rowCount;

  @override
  void performLayout(Size size) {
    final heights = <Object, double>{};
    final ids = <Object>[
      ..._HomeSlot.values,
      for (var i = 0; i < rowCount; i++) i,
    ];
    for (final id in ids) {
      heights[id] = layoutChild(
        id,
        BoxConstraints.tightFor(width: size.width),
      ).height;
      positionChild(
        id,
        Offset(size.width + HomeTokens.target, size.height + HomeTokens.target),
      );
    }
    double h(Object id) => heights[id]!;
    var alerts = _HomeSlot.alerts;
    var heading = true;
    var shortcuts = true;
    double reserved() =>
        (shortcuts ? h(_HomeSlot.shortcuts) + HomeTokens.gap : 0) +
        h(alerts) +
        (heading ? h(_HomeSlot.heading) : 0) +
        h(_HomeSlot.fallback);
    // ถ้า banner หลายอัน/ตัวอักษรใหญ่ ใช้ปุ่มเปิดรายละเอียดแทนการตัดคำเตือนครึ่งเดียว
    if (reserved() > size.height && h(alerts) > h(_HomeSlot.compactAlerts)) {
      alerts = _HomeSlot.compactAlerts;
    }
    // ปุ่มดูทั้งหมดสำคัญกว่าหัวข้อหรือทางลัดซ้ำกับแท็บ เมื่อพื้นที่เล็กผิดปกติ
    if (reserved() > size.height) heading = false;
    if (reserved() > size.height) shortcuts = false;
    final summary =
        reserved() + h(_HomeSlot.summary) + HomeTokens.gap <= size.height;
    var y = 0.0;
    void place(Object id) {
      positionChild(id, Offset(0, y));
      y += h(id);
    }

    // B (30/10/2026): การ์ดงานค้างอยู่บนสุด เหนือการ์ด Incidents
    if (summary) {
      place(_HomeSlot.summary);
      y += HomeTokens.gap;
    }
    if (shortcuts) {
      place(_HomeSlot.shortcuts);
      y += HomeTokens.gap;
    }
    place(alerts);
    if (heading) place(_HomeSlot.heading);
    final available = size.height - y;
    var used = 0.0;
    var count = 0;
    for (var i = 0; i < rowCount; i++) {
      if (used + h(i) > available) break;
      used += h(i);
      count++;
    }
    if (count == 0) {
      if (h(_HomeSlot.fallback) <= available) place(_HomeSlot.fallback);
    } else {
      for (var i = 0; i < count; i++) {
        place(i);
      }
      // การ์ดสำคัญกว่าบรรทัดสรุป เพราะหัวข้อมีปุ่มดูทั้งหมดอยู่แล้ว
      // แสดงบรรทัดสรุปเฉพาะเมื่อยังเหลือพื้นที่หลังวางการ์ดครบใบ
      if (used + h(_HomeSlot.caption) <= available) {
        place(_HomeSlot.caption);
      }
    }
  }

  @override
  bool shouldRelayout(covariant _HomeOverviewDelegate oldDelegate) => true;
}
