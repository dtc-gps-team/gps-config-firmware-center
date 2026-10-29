import 'package:flutter/material.dart';
import '../../core/api/models.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/labels.dart';
import '../../core/ui/status_tones.dart';
import '../../core/widgets/sync_status_widgets.dart';
import '../task/task_status_ui.dart';
import 'home_tokens.dart';

/// รายการงานจาก provider เดิม ไม่ตีความ Task เป็นคำขอ Config/Firmware
/// ใช้ id ตัดสินเมื่อเวลาเท่ากัน เพื่อไม่ให้รายการสลับที่ระหว่าง refresh
List<Task> recentHomeTasks(Iterable<Task> tasks) =>
    tasks.toList()..sort((a, b) {
      final byTime = b.updatedAt.compareTo(a.updatedAt);
      return byTime != 0 ? byTime : b.id.compareTo(a.id);
    });

String homeTaskTime(DateTime value) {
  final date = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${date.day}/${date.month}/${date.year} · ${two(date.hour)}:${two(date.minute)}';
}

/// การ์ด r4 ใช้ชื่อเต็มใน semantics แม้ข้อความวาดได้สองบรรทัด
/// ป้ายและเวลาตัดขึ้นบรรทัดใหม่ได้ ไม่บีบเลขเครื่องให้เหลือคอลัมน์แคบ
class HomeTaskRow extends StatelessWidget {
  const HomeTaskRow({
    super.key,
    required this.task,
    required this.onTap,
    this.pendingSync = false,
    this.showUrgency = false,
  });
  final Task task;
  final VoidCallback onTap;
  final bool pendingSync;
  final bool showUrgency;

  @override
  Widget build(BuildContext context) {
    final urgency = TaskUrgencyStyle.of(task);
    return Semantics(
      button: true,
      child: Material(
        color: AppColors.card,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.xl),
          side: const BorderSide(color: AppColors.border),
        ),
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: HomeTokens.iconSize,
                  height: HomeTokens.iconSize,
                  decoration: BoxDecoration(
                    color: AppColors.secondary,
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: Icon(
                    task.source == TaskSource.technician
                        ? Icons.edit_note
                        : Icons.assignment_outlined,
                    size: 18,
                    color: AppColors.accentForeground,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        task.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: HomeTokens.rowTitleSize,
                          height: 1.3,
                          fontWeight: FontWeight.w600,
                          color: AppColors.foreground,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${task.deviceId ?? 'ไม่ระบุอุปกรณ์'} · ${task.id}',
                        style: const TextStyle(
                          fontSize: HomeTokens.metaSize,
                          height: 1.4,
                          color: AppColors.mutedForeground,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(
                            homeTaskTime(task.updatedAt),
                            style: const TextStyle(
                              fontSize: 11,
                              height: 1.4,
                              color: AppColors.mutedForeground,
                            ),
                          ),
                          AppBadge(
                            key: Key('home_status_${task.id}'),
                            label: taskStatusLabel(task.status),
                            tone: taskStatusTone(task.status),
                          ),
                          if (task.source == TaskSource.technician)
                            const AppBadge(
                              label: 'เริ่มเอง',
                              tone: AppBadgeTone.neutral,
                            ),
                          if (showUrgency && urgency != TaskUrgency.none)
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
                ),
                const SizedBox(width: 4),
                const Padding(
                  padding: EdgeInsets.only(top: 6),
                  child: Icon(
                    Icons.chevron_right,
                    size: 16,
                    color: AppColors.mutedForeground,
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
