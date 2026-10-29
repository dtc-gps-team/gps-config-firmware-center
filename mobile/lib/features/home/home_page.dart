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
class HomePage extends ConsumerStatefulWidget {
  const HomePage({super.key});
  @override
  ConsumerState<HomePage> createState() => _HomePageState();
}

class _HomePageState extends ConsumerState<HomePage> {
  final _scroll = ScrollController();
  final _hero = GlobalKey();
  bool _heroScrolledAway = false;
  double _heroHeight = 300;

  @override
  void initState() {
    super.initState();
    // ไอคอน status bar ต้องอ่านได้ทั้งเมื่อหัวเข้มอยู่บนจอและเมื่อเลื่อนไปพื้นอ่อน
    _scroll.addListener(() {
      _heroHeight = _hero.currentContext?.size?.height ?? _heroHeight;
      final away = _scroll.offset >= _heroHeight;
      if (away != _heroScrolledAway) setState(() => _heroScrolledAway = away);
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final staff = isFieldStaff(auth.role);
    return AppV2Theme(
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: _heroScrolledAway
            ? SystemUiOverlayStyle.dark
            : SystemUiOverlayStyle.light,
        child: Scaffold(
          backgroundColor: AppColors.background,
          body: RefreshIndicator(
            onRefresh: () => staff
                ? ref.refresh(taskListProvider.future)
                : Future<void>.value(),
            child: ListView(
              controller: _scroll,
              padding: EdgeInsets.zero,
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                _HomeHero(key: _hero, auth: auth),
                if (staff)
                  Padding(
                    padding: HomeTokens.contentPadding,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const _Shortcuts(),
                        const SizedBox(height: HomeTokens.gap),
                        HomeStatusBanners(
                          onSummaryTap: () =>
                              context.push('${AppRoutes.homeAll}?filter=open'),
                        ),
                        Wrap(
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
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 4,
                                ),
                              ),
                              onPressed: () => context.push(AppRoutes.homeAll),
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
                        const _RecentTasks(),
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
  const _HomeHero({super.key, required this.auth});
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

class _RecentTasks extends ConsumerWidget {
  const _RecentTasks();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasks = ref.watch(taskListProvider);
    final pending =
        ref.watch(pendingTaskIdsProvider).valueOrNull ?? const <String>{};
    return tasks.when(
      skipLoadingOnRefresh: true,
      loading: () => const AppListSkeleton(
        key: Key('home_recent_loading'),
        padding: EdgeInsets.zero,
      ),
      error: (error, _) => AppErrorView(
        message: error is ApiException
            ? error.message
            : 'โหลดงานล่าสุดไม่สำเร็จ',
        onRetry: () => ref.invalidate(taskListProvider),
        messageKey: const Key('my_tasks_error'),
        retryKey: const Key('my_tasks_retry'),
      ),
      data: (items) {
        if (items.isEmpty) {
          return const AppEmptyState(
            icon: Icons.assignment_outlined,
            message: 'ยังไม่มีงานที่ได้รับมอบหมาย',
            messageKey: Key('my_tasks_empty'),
          );
        }
        final media = MediaQuery.of(context);
        final large = media.textScaler.scale(1) >= HomeTokens.largeTextScale;
        // หน้าแคบ/ข้อความใหญ่เปิดทางไปดูทั้งหมดแทนการอัดการ์ดจนถูกตัดครึ่ง
        // หน้าเลื่อนทั้งหน้าได้เสมอ จึงยังเข้าถึงปุ่มได้เมื่อขยายเกิน2เท่า
        final limit = large
            ? (media.size.height < HomeTokens.compactHeight ? 0 : 1)
            : HomeTokens.previewLimit;
        final recent = recentHomeTasks(items).take(limit).toList();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
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
            if (recent.isEmpty)
              OutlinedButton(
                key: const Key('home_compact_all'),
                onPressed: () => context.push(AppRoutes.homeAll),
                child: Text('ดูทั้งหมด ${items.length} รายการ'),
              )
            else
              Text(
                'แสดง ${recent.length} จาก ${items.length} รายการ · ที่เหลืออยู่ใน “ดูทั้งหมด”',
                key: const Key('home_preview_caption'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 11,
                  height: 1.5,
                  color: AppColors.mutedForeground,
                ),
              ),
          ],
        );
      },
    );
  }
}
