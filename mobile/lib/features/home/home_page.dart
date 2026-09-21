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

/// Up to two initials for the avatar circle, derived from the real
/// username — never a placeholder. `null`/empty falls back to "?".
String _initials(String? username) {
  if (username == null || username.isEmpty) return '?';
  final letters = username.replaceAll(RegExp('[^A-Za-zก-๙]'), '');
  if (letters.isEmpty) return username.substring(0, 1).toUpperCase();
  return letters.substring(0, letters.length >= 2 ? 2 : 1).toUpperCase();
}

/// How many completed tasks the "ประวัติงานล่าสุด" section shows before the
/// "ดูประวัติงานทั้งหมด" link is needed instead.
const _recentHistoryLimit = 3;

class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final role = auth.role;
    // `GET /tasks` is only self-scoped by the backend for ST/OT. Every other
    // role (and an unknown one) gets back every task in the system, so this
    // field-staff app only fetches — and only shows a task history for —
    // ST/OT. Same gate the old "งานวันนี้" section used, and the same gate
    // the "ทดสอบสัญญาณ" shortcut below uses.
    final isFieldStaff = role == UserRole.st || role == UserRole.ot;
    final tasksAsync = isFieldStaff ? ref.watch(taskListProvider) : null;

    return Scaffold(
      backgroundColor: AppTheme.mockBg,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
          children: [
            _HeaderRow(username: auth.username, role: role),
            const SizedBox(height: 20),
            if (isFieldStaff) ...[
              _HistorySection(tasksAsync: tasksAsync!),
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
                // เฉพาะ ST/OT อยู่แล้ว — ซ่อนจาก UI เพื่อ UX ที่ดีกว่า)
                if (role == UserRole.st || role == UserRole.ot) ...[
                  _Shortcut(
                    key: const Key('shortcut_device_test'),
                    icon: Icons.wifi_tethering,
                    label: 'ทดสอบสัญญาณ',
                    onTap: () => context.push(AppRoutes.deviceConnectionTest),
                  ),
                  // "งานของฉัน" — หน้าเต็มของ taskListProvider (backend
                  // self-scope GET /tasks ให้ ST/OT อยู่แล้ว) · role อื่น
                  // taskListProvider คืนว่างเสมอ ไม่มีประโยชน์ให้เห็นปุ่มนี้
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
                // (ST/OT) ไม่มีสิทธิ์ Create Incident
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
      ),
    );
  }
}

/// Custom header: avatar + name + role pill on the left, notification bell
/// and logout on the right. Replaces the old plain `AppBar` — same two
/// actions, same keys, just laid out to match the mockup.
class _HeaderRow extends ConsumerWidget {
  const _HeaderRow({required this.username, required this.role});

  final String? username;
  final UserRole? role;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: AppTheme.mockTextPrimary,
            borderRadius: BorderRadius.circular(13),
          ),
          alignment: Alignment.center,
          child: Text(
            _initials(username),
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w700,
              fontSize: 14,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                username ?? _roleLabel(role),
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.mockTextPrimary,
                ),
              ),
              if (role != null) ...[
                const SizedBox(height: 4),
                _RoleBadge(role: role!),
              ],
            ],
          ),
        ),
        const SizedBox(width: 8),
        _NotificationBell(),
        IconButton(
          key: const Key('home_logout'),
          icon: const Icon(Icons.logout, color: AppTheme.mockTextSecondary),
          tooltip: 'ออกจากระบบ',
          onPressed: () => ref.read(authControllerProvider.notifier).logout(),
        ),
      ],
    );
  }
}

/// Home header bell. Badge shows the real unread count from
/// `GET /notifications?unread=true` (hidden when 0); tapping opens the list.
class _NotificationBell extends ConsumerWidget {
  const _NotificationBell();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = ref.watch(unreadNotificationCountProvider).valueOrNull ?? 0;
    const bellIcon = Icon(
      Icons.notifications_outlined,
      color: AppTheme.mockTextSecondary,
    );

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

class _RoleBadge extends StatelessWidget {
  const _RoleBadge({required this.role});

  final UserRole role;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.mockAccentSoft,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        '${role.wireName} • ${_roleLabel(role)}',
        style: const TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w600,
          color: AppTheme.mockAccent,
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
        color: AppTheme.mockTextPrimary,
      ),
    );
  }
}

/// "ประวัติงานล่าสุด" — real completed-task history, derived client-side
/// from `GET /tasks` (self-scoped to the caller by the backend for ST/OT).
/// Replaces the old "งานวันนี้" pending-task list: a field technician
/// already knows their own assignments, so Home's job is to record what
/// was finished, not to re-list what is still outstanding.
class _HistorySection extends ConsumerWidget {
  const _HistorySection({required this.tasksAsync});

  final AsyncValue<List<Task>> tasksAsync;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return tasksAsync.when(
      skipLoadingOnRefresh: true,
      data: (tasks) {
        final completed =
            tasks.where((t) => t.status == TaskStatus.completed).toList()
              ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
        final now = DateTime.now();
        final completedThisMonth = completed.where((t) {
          final local = t.updatedAt.toLocal();
          return local.year == now.year && local.month == now.month;
        }).length;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: _StatCard(
                    icon: Icons.check_circle_outline,
                    iconColor: AppTheme.mockAccent,
                    iconBg: AppTheme.mockAccentSoft,
                    value: '$completedThisMonth',
                    label: 'งานที่เสร็จเดือนนี้',
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _StatCard(
                    icon: Icons.history,
                    iconColor: AppTheme.mockSuccess,
                    iconBg: AppTheme.mockSuccessSoft,
                    value: '${completed.length}',
                    label: 'ประวัติงานทั้งหมด',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'ประวัติงานล่าสุด',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.mockTextPrimary,
                  ),
                ),
                Text(
                  '${completed.length} รายการ',
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.mockTextTertiary,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (completed.isEmpty)
              const _HistoryEmpty()
            else ...[
              for (
                var i = 0;
                i < completed.length && i < _recentHistoryLimit;
                i++
              )
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _HistoryCard(
                    key: Key('history_card_$i'),
                    task: completed[i],
                    onTap: () =>
                        context.push(AppRoutes.taskDetail(completed[i].id)),
                  ),
                ),
              _ViewAllButton(onTap: () => context.push(AppRoutes.myTasks)),
            ],
          ],
        );
      },
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (error, _) => AppErrorView(
        message: error is ApiException
            ? error.message
            : 'โหลดประวัติงานไม่สำเร็จ',
        onRetry: () => ref.invalidate(taskListProvider),
        retryKey: const Key('tasks_retry'),
        compact: true,
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final Color iconColor;
  final Color iconBg;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: AppTheme.mockShadowCard,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: iconBg,
              borderRadius: BorderRadius.circular(10),
            ),
            alignment: Alignment.center,
            child: Icon(icon, size: 18, color: iconColor),
          ),
          const SizedBox(height: 10),
          Text(
            value,
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: AppTheme.mockTextPrimary,
              height: 1.1,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              color: AppTheme.mockTextSecondary,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _HistoryEmpty extends StatelessWidget {
  const _HistoryEmpty();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: AppTheme.mockShadowCard,
      ),
      child: const Column(
        children: [
          Icon(Icons.inbox_outlined, color: AppTheme.mockTextTertiary),
          SizedBox(height: 8),
          Text(
            'ยังไม่มีประวัติงานที่เสร็จสิ้น',
            style: TextStyle(fontSize: 13, color: AppTheme.mockTextSecondary),
          ),
        ],
      ),
    );
  }
}

class _HistoryCard extends StatelessWidget {
  const _HistoryCard({super.key, required this.task, required this.onTap});

  final Task task;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: AppTheme.mockShadowRow,
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: AppTheme.mockSuccessSoft,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  alignment: Alignment.center,
                  child: const Icon(
                    Icons.check,
                    color: AppTheme.mockSuccess,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 13),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        task.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w700,
                          color: AppTheme.mockTextPrimary,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        task.deviceId ?? '—',
                        style: const TextStyle(
                          fontSize: 12.5,
                          color: AppTheme.mockTextSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.mockSuccessSoft,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Text(
                    'เสร็จสิ้น',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppTheme.mockSuccess,
                    ),
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

class _ViewAllButton extends StatelessWidget {
  const _ViewAllButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        key: const Key('view_all_history'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          height: 50,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.mockCardBorder, width: 1.5),
          ),
          child: const Text(
            'ดูประวัติงานทั้งหมด',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppTheme.mockTextPrimary,
            ),
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
    return Container(
      key: item.key,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: AppTheme.mockShadowCard,
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: item.onTap,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 12),
            child: Column(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: const BoxDecoration(
                    color: AppTheme.mockAccentSoft,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(item.icon, color: AppTheme.mockAccent, size: 22),
                ),
                const SizedBox(height: 8),
                Text(
                  item.label,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.mockTextPrimary,
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
