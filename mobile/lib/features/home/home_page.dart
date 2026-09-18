import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_error_view.dart';
import '../notification/notification_repository.dart';
import '../task/task_repository.dart';
import '../task/task_status_ui.dart';

/// Human-readable role label shown in the greeting badge.
String _roleLabel(UserRole? role) {
  switch (role) {
    case UserRole.st:
    case UserRole.ot:
      return 'ช่างภาคสนาม';
    case UserRole.operation:
      return 'ฝ่ายปฏิบัติการ';
    case UserRole.auditor:
      return 'ผู้ตรวจสอบ';
    case UserRole.admin:
      return 'ผู้ดูแลระบบ';
    case UserRole.superAdmin:
      return 'ผู้ดูแลระบบสูงสุด';
    case null:
      return 'ผู้ใช้งาน';
  }
}

class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final role = auth.role;
    // `GET /tasks` is only self-scoped by the backend for ST/OT. Every other
    // role (and an unknown one) gets back every task in the system, so Mobile —
    // a field-staff app — only shows "งานวันนี้", and only fetches it, for
    // ST/OT. Same gate as the "ทดสอบสัญญาณ" shortcut below.
    final isFieldStaff = role == UserRole.st || role == UserRole.ot;
    final tasksAsync = isFieldStaff ? ref.watch(taskListProvider) : null;
    final taskCount = tasksAsync?.valueOrNull?.length;
    // Show the "N งานที่ได้รับมอบหมาย" line only while loading (count == null)
    // or once loaded. On error the section below already shows a card + retry,
    // so drop the greeting line rather than leaving it stuck on "กำลังโหลด…".
    final showTaskCount = isFieldStaff && !(tasksAsync?.hasError ?? false);

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('หน้าหลัก'),
        actions: [
          const _NotificationBell(),
          IconButton(
            key: const Key('home_logout'),
            icon: const Icon(Icons.logout),
            tooltip: 'ออกจากระบบ',
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          _GreetingBlock(
            username: auth.username,
            role: role,
            taskCount: taskCount,
            showTaskCount: showTaskCount,
          ),
          const SizedBox(height: 24),
          if (isFieldStaff) ...[
            const _SectionLabel('งานวันนี้'),
            const SizedBox(height: 12),
            const _TodayTasksSection(),
            const SizedBox(height: 24),
          ],
          const _SectionLabel('ทางลัด'),
          const SizedBox(height: 12),
          _ShortcutGrid(
            items: [
              // ทางลัดทุกตัว navigate ไปหน้าจริง (ไม่มี "coming soon" แล้ว)
              _Shortcut(
                key: const Key('shortcut_simulator'),
                icon: Icons.tune,
                label: 'ทดสอบการตั้งค่า',
                onTap: () => context.push(AppRoutes.simulator),
              ),
              // ทดสอบสัญญาณ — ช่างหน้างานเท่านั้น (backend บังคับ RBAC 403 ให้
              // เฉพาะ ST/OT อยู่แล้ว — ซ่อนจาก UI เพื่อ UX ที่ดีกว่า) พฤติกรรม
              // เดิมจากก่อน redesign ยกมาทั้งหมด แค่ย้ายเข้ากริดทางลัด
              if (role == UserRole.st || role == UserRole.ot) ...[
                _Shortcut(
                  key: const Key('shortcut_device_test'),
                  icon: Icons.wifi_tethering,
                  label: 'ทดสอบสัญญาณ',
                  onTap: () => context.push(AppRoutes.deviceConnectionTest),
                ),
                // "งานของฉัน" — หน้าเต็มของ taskListProvider (backend self-scope
                // GET /tasks ให้ ST/OT อยู่แล้ว) · role อื่น taskListProvider คืน
                // ว่างเสมอ ไม่มีประโยชน์ให้เห็นปุ่มนี้ (gate เดียวกับ "ทดสอบสัญญาณ")
                _Shortcut(
                  key: const Key('shortcut_my_tasks'),
                  icon: Icons.assignment_outlined,
                  label: 'งานของฉัน',
                  onTap: () => context.push(AppRoutes.myTasks),
                ),
              ],
              // ค้นหาอุปกรณ์ — ทุก role เรียก GET /devices ได้ (RBAC "R" ทุก
              // Role) ไม่ต้อง gate เหมือน "ทดสอบสัญญาณ"
              _Shortcut(
                key: const Key('shortcut_find_device'),
                icon: Icons.search,
                label: 'ค้นหาอุปกรณ์',
                onTap: () => context.push(AppRoutes.deviceSearch),
              ),
              // ดู Incident — read-only list (`GET /incidents`, RBAC "R" ทุก
              // Role) · label "ดู Incident" ไม่ใช่ "แจ้งเหตุ" เพราะช่างหน้างาน
              // (ST/OT) ไม่มีสิทธิ์ Create Incident (RBAC_Matrix — Create =
              // Operation เท่านั้น) กดแล้วดูได้อย่างเดียว
              _Shortcut(
                key: const Key('shortcut_report_incident'),
                icon: Icons.report_problem_outlined,
                label: 'ดู Incident',
                onTap: () => context.push(AppRoutes.incidents),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Home app-bar bell. Badge shows the real unread count from
/// `GET /notifications?unread=true` (hidden when 0); tapping opens the list.
class _NotificationBell extends ConsumerWidget {
  const _NotificationBell();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = ref.watch(unreadNotificationCountProvider).valueOrNull ?? 0;
    const bellIcon = Icon(Icons.notifications_outlined);

    return IconButton(
      key: const Key('home_notifications'),
      tooltip: 'การแจ้งเตือน',
      onPressed: () => context.push(AppRoutes.notifications),
      icon: unread > 0
          ? Badge(
              label: Text(unread > 99 ? '99+' : '$unread'),
              backgroundColor: const Color(0xFFE53935),
              child: bellIcon,
            )
          : bellIcon,
    );
  }
}

class _GreetingBlock extends StatelessWidget {
  const _GreetingBlock({
    required this.username,
    required this.role,
    required this.taskCount,
    required this.showTaskCount,
  });

  final String? username;
  final UserRole? role;

  /// `null` while the task list is still loading.
  final int? taskCount;

  /// Only ST/OT get a meaningful "งานที่ได้รับมอบหมาย" count (see [HomePage]).
  final bool showTaskCount;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                username ?? _roleLabel(role),
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.textPrimary,
                ),
              ),
              if (showTaskCount) ...[
                const SizedBox(height: 4),
                Text(
                  taskCount == null
                      ? 'กำลังโหลดงานที่ได้รับมอบหมาย…'
                      : 'วันนี้ $taskCount งานที่ได้รับมอบหมาย',
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(width: 12),
        if (role != null) _RoleBadge(role: role!),
      ],
    );
  }
}

class _RoleBadge extends StatelessWidget {
  const _RoleBadge({required this.role});

  final UserRole role;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppTheme.unreadTint,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        '${role.wireName} • ${_roleLabel(role)}',
        style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: AppTheme.navy,
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 15,
        fontWeight: FontWeight.w700,
        color: AppTheme.textPrimary,
      ),
    );
  }
}

/// "งานวันนี้" — real task list from `GET /tasks` (self-scoped to the caller
/// by the backend for ST/OT). Keeps the card layout from the Home redesign
/// (PR #66); only the data source changed from mock to the live endpoint.
class _TodayTasksSection extends ConsumerWidget {
  const _TodayTasksSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasksAsync = ref.watch(taskListProvider);

    return tasksAsync.when(
      skipLoadingOnRefresh: true,
      data: (tasks) {
        if (tasks.isEmpty) return const _TasksEmpty();
        return Column(
          children: [
            for (var i = 0; i < tasks.length; i++) ...[
              _TaskCard(
                key: Key('task_card_$i'),
                task: tasks[i],
                onTap: () => context.push(AppRoutes.taskDetail(tasks[i].id)),
              ),
              if (i != tasks.length - 1) const SizedBox(height: 10),
            ],
          ],
        );
      },
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (error, _) => _TasksError(
        message: error is ApiException ? error.message : 'โหลดงานไม่สำเร็จ',
        onRetry: () => ref.invalidate(taskListProvider),
      ),
    );
  }
}

class _TasksEmpty extends StatelessWidget {
  const _TasksEmpty();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: const Column(
        children: [
          Icon(Icons.inbox_outlined, color: AppTheme.textSecondary),
          SizedBox(height: 8),
          Text(
            'ยังไม่มีงานที่ได้รับมอบหมาย',
            style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
          ),
        ],
      ),
    );
  }
}

class _TasksError extends StatelessWidget {
  const _TasksError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return AppErrorView(
      message: message,
      onRetry: onRetry,
      retryKey: const Key('tasks_retry'),
      compact: true,
    );
  }
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({super.key, required this.task, required this.onTap});

  final Task task;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppTheme.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      task.title,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Device: ${task.deviceId ?? '—'}',
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              TaskStatusPill(status: task.status),
            ],
          ),
        ),
      ),
    );
  }
}

class _Shortcut {
  const _Shortcut({
    required this.key,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final Key key;
  final IconData icon;
  final String label;
  final VoidCallback onTap;
}

/// Two-column grid. When the item count is odd the last tile spans full width
/// so the layout stays balanced (spec allows either centered or full-width).
class _ShortcutGrid extends StatelessWidget {
  const _ShortcutGrid({required this.items});

  final List<_Shortcut> items;

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < items.length; i += 2) {
      final left = items[i];
      final hasRight = i + 1 < items.length;
      if (hasRight) {
        rows.add(
          Row(
            children: [
              Expanded(child: _ShortcutTile(item: left)),
              const SizedBox(width: 10),
              Expanded(child: _ShortcutTile(item: items[i + 1])),
            ],
          ),
        );
      } else {
        rows.add(
          Row(
            children: [Expanded(child: _ShortcutTile(item: left))],
          ),
        );
      }
      if (i + 2 < items.length) rows.add(const SizedBox(height: 10));
    }
    return Column(children: rows);
  }
}

class _ShortcutTile extends StatelessWidget {
  const _ShortcutTile({required this.item});

  final _Shortcut item;

  @override
  Widget build(BuildContext context) {
    return Material(
      key: item.key,
      color: AppTheme.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: item.onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 12),
          child: Column(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: const BoxDecoration(
                  color: AppTheme.iconBg,
                  shape: BoxShape.circle,
                ),
                child: Icon(item.icon, color: AppTheme.navy, size: 22),
              ),
              const SizedBox(height: 8),
              Text(
                item.label,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.textPrimary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
