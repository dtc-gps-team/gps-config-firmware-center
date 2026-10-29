import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/router/app_router.dart';
import '../../core/router/app_shell.dart';
import '../../core/sync/sync_providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_empty_state.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/widgets/app_error_view.dart';
import '../task/task_repository.dart';
import '../task/task_status_ui.dart';
import 'home_status_banners.dart';
import 'home_task_feed.dart';
import 'home_tokens.dart';

enum _Filter {
  all('ทั้งหมด'),
  open('ยังไม่เสร็จ'),
  completed('เสร็จแล้ว'),
  cancelled('ยกเลิก');

  const _Filter(this.label);
  final String label;
}

/// รายการเต็มของ Home ใช้ provider เดียวกัน ค้นหา/กรองในข้อมูลที่โหลดแล้ว
/// ไม่สร้าง endpoint หรือ pagination ปลอม และไม่คืน route /tasks ที่ตัดออกแล้ว
class HomeTasksPage extends ConsumerStatefulWidget {
  const HomeTasksPage({super.key, this.initialOpenOnly = false});
  final bool initialOpenOnly;
  @override
  ConsumerState<HomeTasksPage> createState() => _HomeTasksPageState();
}

class _HomeTasksPageState extends ConsumerState<HomeTasksPage> {
  final _search = TextEditingController();
  late _Filter _filter;
  @override
  void initState() {
    super.initState();
    _filter = widget.initialOpenOnly ? _Filter.open : _Filter.all;
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final staff = isFieldStaff(ref.watch(authControllerProvider).role);
    if (!staff) {
      return const Scaffold(
        body: Center(child: Text('รายการงานสำหรับช่างภาคสนาม')),
      );
    }
    final tasks = ref.watch(taskListProvider);
    final pending =
        ref.watch(pendingTaskIdsProvider).valueOrNull ?? const <String>{};
    final query = _search.text.trim().toLowerCase();
    final filtered =
        tasks.valueOrNull?.where((task) {
          final matchesStatus = switch (_filter) {
            _Filter.all => true,
            _Filter.open =>
              task.status == TaskStatus.pending ||
                  task.status == TaskStatus.inProgress,
            _Filter.completed => task.status == TaskStatus.completed,
            _Filter.cancelled => task.status == TaskStatus.cancelled,
          };
          return matchesStatus &&
              [
                task.title,
                task.id,
                task.deviceId ?? '',
              ].any((value) => value.toLowerCase().contains(query));
        }).toList() ??
        [];
    final sorted = _filter == _Filter.open
        ? TaskUrgencyStyle.sorted(filtered)
        : recentHomeTasks(filtered);
    return AppV2Theme(
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: RefreshIndicator(
          onRefresh: () => ref.refresh(taskListProvider.future),
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverToBoxAdapter(
                child: AnnotatedRegion<SystemUiOverlayStyle>(
                  value: SystemUiOverlayStyle.light,
                  child: Container(
                    decoration: const BoxDecoration(
                      color: AppColors.primary,
                      borderRadius: BorderRadius.vertical(
                        bottom: Radius.circular(HomeTokens.heroRadius),
                      ),
                    ),
                    child: SafeArea(
                      bottom: false,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(8, 4, 18, 18),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            IconButton(
                              tooltip: 'ย้อนกลับ',
                              color: AppColors.onInk,
                              onPressed: () => context.pop(),
                              icon: const Icon(Icons.arrow_back),
                            ),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Padding(
                                padding: EdgeInsets.only(top: 10),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Semantics(
                                      header: true,
                                      child: Text(
                                        'งานทั้งหมดของคุณ',
                                        style: TextStyle(
                                          fontSize: 19,
                                          height: 1.3,
                                          fontWeight: FontWeight.w600,
                                          color: AppColors.onInk,
                                        ),
                                      ),
                                    ),
                                    SizedBox(height: 8),
                                    Text(
                                      'ค้นหางานและเลือกสถานะที่ต้องการ',
                                      style: TextStyle(
                                        fontSize: 12,
                                        height: 1.5,
                                        color: AppColors.onInkMuted,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              SliverPadding(
                padding: HomeTokens.contentPadding,
                sliver: SliverToBoxAdapter(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final filter in _Filter.values)
                            ChoiceChip(
                              key: Key('home_filter_${filter.name}'),
                              label: Text(filter.label),
                              selected: _filter == filter,
                              selectedColor: AppColors.primary,
                              shape: const StadiumBorder(),
                              checkmarkColor: AppColors.onInk,
                              labelStyle: TextStyle(
                                color: _filter == filter
                                    ? AppColors.onInk
                                    : AppColors.foreground,
                              ),
                              side: const BorderSide(
                                color: AppColors.inputBorder,
                              ),
                              onSelected: (_) =>
                                  setState(() => _filter = filter),
                            ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        key: const Key('home_tasks_search'),
                        controller: _search,
                        onChanged: (_) => setState(() {}),
                        decoration: InputDecoration(
                          labelText: 'ค้นหางาน',
                          hintText: 'ชื่อ / เลขงาน / เลขเครื่อง',
                          prefixIcon: const Icon(Icons.search),
                          suffixIcon: _search.text.isEmpty
                              ? null
                              : IconButton(
                                  tooltip: 'ล้างคำค้น',
                                  icon: const Icon(Icons.close),
                                  onPressed: () => setState(_search.clear),
                                ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      HomeStatusBanners(showSummary: false),
                      Text(
                        'พบ ${sorted.length} รายการ',
                        key: const Key('home_all_count'),
                        style: const TextStyle(
                          fontSize: HomeTokens.metaSize,
                          color: AppColors.mutedForeground,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              ...tasks.when<List<Widget>>(
                skipLoadingOnRefresh: true,
                loading: () => [
                  const SliverToBoxAdapter(child: AppListSkeleton()),
                ],
                error: (error, _) => [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: HomeTokens.contentPadding,
                      child: AppErrorView(
                        message: error is ApiException
                            ? error.message
                            : 'โหลดงานไม่สำเร็จ',
                        onRetry: () => ref.invalidate(taskListProvider),
                        messageKey: const Key('my_tasks_error'),
                        retryKey: const Key('my_tasks_retry'),
                      ),
                    ),
                  ),
                ],
                data: (_) => sorted.isEmpty
                    ? [
                        const SliverToBoxAdapter(
                          child: AppEmptyState(
                            icon: Icons.search_off,
                            message: 'ไม่มีรายการในตัวกรองนี้',
                            messageKey: Key('home_all_empty'),
                          ),
                        ),
                      ]
                    : [
                        SliverPadding(
                          padding: const EdgeInsets.fromLTRB(18, 0, 18, 24),
                          sliver: SliverList.builder(
                            itemCount: sorted.length,
                            itemBuilder: (context, i) {
                              final task = sorted[i];
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 10),
                                child: HomeTaskRow(
                                  key: Key('home_all_${task.id}'),
                                  task: task,
                                  pendingSync: pending.contains(task.id),
                                  showUrgency: _filter == _Filter.open,
                                  onTap: () => context.push(
                                    AppRoutes.taskDetail(task.id),
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                      ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
