import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/router/app_router.dart';
import '../../core/router/app_shell.dart';
import '../../core/sync/sync_providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_empty_state.dart';
import '../../core/ui/app_page_header.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/ui/labels.dart';
import '../../core/ui/status_tones.dart';
import '../../core/widgets/app_error_view.dart';
import '../../core/widgets/sync_status_widgets.dart';
import '../auth/account_sheet.dart';
import '../task/task_repository.dart';
import '../task/task_status_ui.dart';
import 'home_status_banners.dart';

/// `dd/MM/yyyy` — กำหนดส่งของงานที่ยังต้องทำ (แบบหน้า "งานของฉัน" เดิม)
String _formatDay(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year}';
}

/// `dd/MM/yyyy HH:mm` — เวลาที่งานในประวัติจบ (`updatedAt`)
String _formatDateTime(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${_formatDay(d)} ${two(d.hour)}:${two(d.minute)}';
}

/// แท็บหน้าแรกของช่าง (ST / OT) — docs/22 §7.2: รวมหน้า "งานของฉัน" (`/tasks`
/// เดิม) เข้ามาทั้งหน้า (มติ B ข้อ 12) แสดงงานทั้งหมดของช่างในหน้าเดียว
///
/// 1. banner ออฟไลน์ / ซิงก์ + แถบสรุป "ค้าง N งาน ด่วน M งาน"
/// 2. **ต้องทำ** — งาน `pending` + `in_progress` เรียงเลยกำหนด → ใกล้ถึงกำหนด →
///    ที่เหลือ (เกณฑ์ [TaskUrgencyStyle] เดิม)
/// 3. **ประวัติงานล่าสุด** — สถิติ + งาน `completed` / `cancelled` ใหม่สุดก่อน
///
/// ข้อมูลมาจาก `GET /tasks` ตัวเดียวกับหน้าเดิม ([taskListProvider]) ไม่เปลี่ยน
/// การเรียก API · role อื่นไม่มีแท็บนี้ (router พาไป Device Search) แต่ถ้าหลุดมา
/// ก็ไม่ยิง `GET /tasks` เพราะ backend ไม่ self-scope ให้ role อื่น
class HomePage extends ConsumerStatefulWidget {
  const HomePage({super.key});

  @override
  ConsumerState<HomePage> createState() => _HomePageState();
}

class _HomePageState extends ConsumerState<HomePage> {
  final _openSectionKey = GlobalKey();

  void _scrollToOpenSection() {
    final target = _openSectionKey.currentContext;
    if (target == null) return;
    Scrollable.ensureVisible(
      target,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final fieldStaff = isFieldStaff(auth.role);

    return AppV2Theme(
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          bottom: false,
          child: RefreshIndicator(
            // await refetch จริง — spinner ค้างจนข้อมูลใหม่มา
            onRefresh: () => fieldStaff
                ? ref.refresh(taskListProvider.future)
                : Future<void>.value(),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.only(bottom: 24),
              children: [
                AppPageHeader(
                  title: 'หน้าแรก',
                  meta: [
                    if (auth.username != null)
                      AppPageHeaderMeta(label: 'ผู้ใช้', value: auth.username!),
                  ],
                  trailing: const AccountButton(),
                ),
                if (fieldStaff)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        HomeStatusBanners(onSummaryTap: _scrollToOpenSection),
                        _TaskSections(openSectionKey: _openSectionKey),
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

/// จำนวนการ์ดสูงสุดใน "ประวัติงานล่าสุด" — สร้างทุกใบใน Column ตรงๆ (ไม่ lazy)
/// จึงจำกัดไว้ไม่ให้หน้าแรกยาวและหนักขึ้นเรื่อยๆ ตามงานที่สะสม (รีวิว A ใน #355)
const _historyLimit = 20;

class _TaskSections extends ConsumerWidget {
  const _TaskSections({required this.openSectionKey});

  final GlobalKey openSectionKey;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasksAsync = ref.watch(taskListProvider);
    final pendingIds = ref.watch(pendingTaskIdsProvider).value ?? const {};

    return tasksAsync.when(
      skipLoadingOnRefresh: true,
      loading: () => const AppListSkeleton(padding: EdgeInsets.zero),
      error: (error, _) => AppErrorView(
        message: error is ApiException ? error.message : 'โหลดงานไม่สำเร็จ',
        onRetry: () => ref.invalidate(taskListProvider),
        messageKey: const Key('my_tasks_error'),
        retryKey: const Key('my_tasks_retry'),
      ),
      data: (tasks) {
        if (tasks.isEmpty) {
          return const AppEmptyState(
            icon: Icons.assignment_outlined,
            message: 'ยังไม่มีงานที่ได้รับมอบหมาย',
            messageKey: Key('my_tasks_empty'),
          );
        }
        final open = TaskUrgencyStyle.sorted(
          tasks
              .where(
                (t) =>
                    t.status == TaskStatus.pending ||
                    t.status == TaskStatus.inProgress,
              )
              .toList(),
        );
        final history =
            tasks
                .where(
                  (t) =>
                      t.status == TaskStatus.completed ||
                      t.status == TaskStatus.cancelled,
                )
                .toList()
              ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
        final completed = tasks
            .where((t) => t.status == TaskStatus.completed)
            .toList();
        final now = DateTime.now();
        final completedThisMonth = completed.where((t) {
          final local = t.updatedAt.toLocal();
          return local.year == now.year && local.month == now.month;
        }).length;

        void openTask(Task task) => context.push(AppRoutes.taskDetail(task.id));

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Column(
              key: openSectionKey,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _SectionTitle(
                  'ต้องทำ',
                  count: open.length,
                  key: const Key('home_open_section'),
                ),
                if (open.isEmpty)
                  const AppEmptyState(
                    icon: Icons.task_alt,
                    message: 'ไม่มีงานค้าง',
                    messageKey: Key('home_open_empty'),
                  ),
                for (final (i, task) in open.indexed)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _TaskCard(
                      key: Key('my_task_card_$i'),
                      task: task,
                      pendingSync: pendingIds.contains(task.id),
                      onTap: () => openTask(task),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            const _SectionTitle(
              'ประวัติงานล่าสุด',
              key: Key('home_history_section'),
            ),
            Row(
              children: [
                Expanded(
                  child: _StatCard(
                    value: '$completedThisMonth',
                    label: 'งานที่เสร็จเดือนนี้',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _StatCard(
                    value: '${completed.length}',
                    label: 'ประวัติงานทั้งหมด',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (history.isEmpty)
              const AppEmptyState(
                icon: Icons.history,
                message: 'ยังไม่มีประวัติงาน',
                messageKey: Key('home_history_empty'),
              ),
            for (final (i, task) in history.take(_historyLimit).indexed)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _TaskCard(
                  key: Key('history_card_$i'),
                  task: task,
                  history: true,
                  pendingSync: pendingIds.contains(task.id),
                  onTap: () => openTask(task),
                ),
              ),
            if (history.length > _historyLimit)
              const Text(
                'แสดง $_historyLimit งานล่าสุด',
                key: Key('home_history_limit_note'),
                textAlign: TextAlign.center,
                style: _TaskCard._meta,
              ),
          ],
        );
      },
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title, {super.key, this.count});

  final String title;
  final int? count;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Semantics(
        header: true,
        child: Text(
          count == null ? title : '$title ($count)',
          style: const TextStyle(
            fontSize: AppTypography.base,
            height: AppTypography.baseHeight,
            fontWeight: FontWeight.w600,
            color: AppColors.foreground,
          ),
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      size: AppCardSize.small,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            style: const TextStyle(
              fontSize: AppTypography.xxl,
              height: AppTypography.xxlHeight,
              fontWeight: FontWeight.w600,
              color: AppColors.foreground,
            ),
          ),
          Text(
            label,
            style: const TextStyle(
              fontSize: AppTypography.xs,
              height: AppTypography.xsHeight,
              color: AppColors.mutedForeground,
            ),
          ),
        ],
      ),
    );
  }
}

/// การ์ดงานหนึ่งใบ — งานที่ต้องทำบอกกำหนดส่ง งานในประวัติ ([history]) บอกเวลาที่จบ
/// · ป้ายทั้งหมดอยู่ใน `Wrap` ใต้รายละเอียด ตัวอักษรใหญ่จึงตัดบรรทัดแทนล้นขอบ
/// (UX audit #9)
class _TaskCard extends StatelessWidget {
  const _TaskCard({
    super.key,
    required this.task,
    required this.onTap,
    this.history = false,
    this.pendingSync = false,
  });

  final Task task;
  final VoidCallback onTap;
  final bool history;
  final bool pendingSync;

  static const _meta = TextStyle(
    fontSize: AppTypography.xs,
    height: AppTypography.xsHeight,
    color: AppColors.mutedForeground,
  );

  @override
  Widget build(BuildContext context) {
    final urgency = TaskUrgencyStyle.of(task);
    final device = task.deviceId ?? '-';
    return AppCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 2 บรรทัดแล้วตัด (UX audit #23 — 1 บรรทัดสั้นเกินจนอ่านชื่องานไม่ออก)
          Text(
            task.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: AppTypography.base,
              height: AppTypography.baseHeight,
              fontWeight: FontWeight.w600,
              color: AppColors.foreground,
            ),
          ),
          const SizedBox(height: 4),
          if (history)
            Text('$device · ${_formatDateTime(task.updatedAt)}', style: _meta)
          else ...[
            Text('อุปกรณ์: $device', style: _meta),
            Text(
              'กำหนดส่ง: '
              '${task.dueDate == null ? '-' : _formatDay(task.dueDate!)}',
              style: _meta,
            ),
          ],
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              AppBadge(
                label: taskStatusLabel(task.status),
                tone: taskStatusTone(task.status),
                dot: true,
              ),
              if (urgency != TaskUrgency.none)
                AppBadge(
                  key: const Key('task_urgency_badge'),
                  label: TaskUrgencyStyle.label(urgency),
                  tone: taskUrgencyTone(
                    overdue: urgency == TaskUrgency.overdue,
                  ),
                ),
              if (pendingSync) const PendingSyncBadge(),
            ],
          ),
        ],
      ),
    );
  }
}
