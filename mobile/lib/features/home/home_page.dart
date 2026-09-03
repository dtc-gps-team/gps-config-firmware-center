import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/router/app_router.dart';

/// Home-screen palette. Scoped to this file on purpose — the shared [AppTheme]
/// drives the rest of the app and this redesign only covers Home, so nothing
/// here touches the central theme. Same values as the Login redesign (PR #64).
class _HomeColors {
  const _HomeColors._();

  static const navy = Color(0xFF12344D);
  static const background = Color(0xFFF4F6F8);
  static const surface = Colors.white;
  static const textPrimary = Color(0xFF12344D);
  static const textSecondary = Color(0xFF5F6E79);
  static const badgeBg = Color(0xFFE3ECF4); // light blue
  static const iconTintBg = Color(0xFFE8EEF3);

  // status pills
  static const urgentBg = Color(0xFFFCE8E6);
  static const urgentFg = Color(0xFFC0392B);
  static const progressBg = Color(0xFFE3F0FB);
  static const progressFg = Color(0xFF1F6FB2);
  static const pendingBg = Color(0xFFECEFF1);
  static const pendingFg = Color(0xFF5F6E79);
}

/// Human-readable role label shown in the greeting badge.
String _roleLabel(UserRole? role) {
  switch (role) {
    case UserRole.st:
    case UserRole.ot:
      return 'ช่างภาคสนาม';
    case UserRole.sw:
      return 'วิศวกรซอฟต์แวร์';
    case UserRole.operation:
      return 'ฝ่ายปฏิบัติการ';
    case UserRole.auditor:
      return 'ผู้ตรวจสอบ';
    case UserRole.admin:
      return 'ผู้ดูแลระบบ';
    case null:
      return 'ผู้ใช้งาน';
  }
}

// TODO: mock data — รอ task module (Sprint ถัดไป). ทั้ง section "งานวันนี้"
// รวมถึงตัวเลขใน greeting เป็นข้อมูลปลอม ยังไม่มี GET /tasks ฝั่ง Mobile UI จริง
const _mockAssignedTaskCount = 3;
const _mockTasks = <_MockTask>[
  _MockTask(
    title: 'ติดตั้งกล่อง GPS รถบรรทุก',
    deviceId: 'DVC-40271',
    status: _TaskStatus.urgent,
  ),
  _MockTask(
    title: 'ตรวจเช็คสัญญาณรถโดยสาร',
    deviceId: 'DVC-39118',
    status: _TaskStatus.inProgress,
  ),
  _MockTask(
    title: 'เปลี่ยนซิมการ์ดอุปกรณ์',
    deviceId: 'DVC-38004',
    status: _TaskStatus.pending,
  ),
];

enum _TaskStatus { urgent, inProgress, pending }

class _MockTask {
  const _MockTask({
    required this.title,
    required this.deviceId,
    required this.status,
  });

  final String title;
  final String deviceId;
  final _TaskStatus status;
}

class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  void _comingSoon(BuildContext context) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(
          content: Text('ฟีเจอร์นี้จะเปิดให้ใช้เร็ว ๆ นี้'),
          duration: Duration(seconds: 2),
        ),
      );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final role = auth.role;

    return Scaffold(
      backgroundColor: _HomeColors.background,
      appBar: AppBar(
        backgroundColor: _HomeColors.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('หน้าหลัก'),
        actions: [
          IconButton(
            // TODO: mock — ยังไม่มี notification module ฝั่ง Mobile จุดแดงเป็น
            // placeholder ไม่ผูกกับข้อมูลจริง
            key: const Key('home_notifications'),
            tooltip: 'การแจ้งเตือน',
            onPressed: () => _comingSoon(context),
            icon: const Badge(
              smallSize: 8,
              backgroundColor: Color(0xFFE53935),
              child: Icon(Icons.notifications_outlined),
            ),
          ),
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
          _GreetingBlock(username: auth.username, role: role),
          const SizedBox(height: 24),
          const _SectionLabel('งานวันนี้'),
          const SizedBox(height: 12),
          for (var i = 0; i < _mockTasks.length; i++) ...[
            _TaskCard(
              key: Key('task_card_$i'),
              task: _mockTasks[i],
              onTap: () => _comingSoon(context),
            ),
            if (i != _mockTasks.length - 1) const SizedBox(height: 10),
          ],
          const SizedBox(height: 24),
          const _SectionLabel('ทางลัด'),
          const SizedBox(height: 12),
          _ShortcutGrid(
            items: [
              // ---- ของจริง — navigate ไปหน้าที่มีอยู่แล้ว (route เดิม) ----
              _Shortcut(
                key: const Key('shortcut_simulator'),
                icon: Icons.tune,
                label: 'ทดสอบการตั้งค่า',
                onTap: () => context.push(AppRoutes.simulator),
              ),
              // ทดสอบสัญญาณ — ช่างหน้างานเท่านั้น (backend บังคับ RBAC 403 ให้
              // เฉพาะ ST/OT อยู่แล้ว — ซ่อนจาก UI เพื่อ UX ที่ดีกว่า) พฤติกรรม
              // เดิมจากก่อน redesign ยกมาทั้งหมด แค่ย้ายเข้ากริดทางลัด
              if (role == UserRole.st || role == UserRole.ot)
                _Shortcut(
                  key: const Key('shortcut_device_test'),
                  icon: Icons.wifi_tethering,
                  label: 'ทดสอบสัญญาณ',
                  onTap: () => context.push(AppRoutes.deviceConnectionTest),
                ),
              // ---- mock — ยังไม่มีหน้าจอปลายทางจริง (Sprint ถัดไป) ----
              _Shortcut(
                key: const Key('shortcut_find_device'),
                icon: Icons.search,
                label: 'ค้นหาอุปกรณ์',
                onTap: () => _comingSoon(context),
              ),
              _Shortcut(
                key: const Key('shortcut_my_tasks'),
                icon: Icons.assignment_outlined,
                label: 'งานของฉัน',
                onTap: () => _comingSoon(context),
              ),
              _Shortcut(
                key: const Key('shortcut_report_incident'),
                icon: Icons.report_problem_outlined,
                label: 'แจ้งเหตุ',
                onTap: () => _comingSoon(context),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _GreetingBlock extends StatelessWidget {
  const _GreetingBlock({required this.username, required this.role});

  final String? username;
  final UserRole? role;

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
                'สวัสดี, ${username ?? _roleLabel(role)}',
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: _HomeColors.textPrimary,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                // TODO: mock — ตัวเลขงานยังไม่ได้ดึงจาก GET /tasks จริง
                'วันนี้ $_mockAssignedTaskCount งานที่ได้รับมอบหมาย',
                style: TextStyle(
                  fontSize: 13,
                  color: _HomeColors.textSecondary,
                ),
              ),
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
        color: _HomeColors.badgeBg,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        '${role.wireName} • ${_roleLabel(role)}',
        style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: _HomeColors.navy,
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
        color: _HomeColors.textPrimary,
      ),
    );
  }
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({super.key, required this.task, required this.onTap});

  final _MockTask task;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: _HomeColors.surface,
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
                        color: _HomeColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Device: ${task.deviceId}',
                      style: const TextStyle(
                        fontSize: 13,
                        color: _HomeColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              _StatusPill(status: task.status),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});

  final _TaskStatus status;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, label) = switch (status) {
      _TaskStatus.urgent => (
        _HomeColors.urgentBg,
        _HomeColors.urgentFg,
        'ด่วน',
      ),
      _TaskStatus.inProgress => (
        _HomeColors.progressBg,
        _HomeColors.progressFg,
        'กำลังทำ',
      ),
      _TaskStatus.pending => (
        _HomeColors.pendingBg,
        _HomeColors.pendingFg,
        'รอดำเนินการ',
      ),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg),
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
      color: _HomeColors.surface,
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
                  color: _HomeColors.iconTintBg,
                  shape: BoxShape.circle,
                ),
                child: Icon(item.icon, color: _HomeColors.navy, size: 22),
              ),
              const SizedBox(height: 8),
              Text(
                item.label,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: _HomeColors.textPrimary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
