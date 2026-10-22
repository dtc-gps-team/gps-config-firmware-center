import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sync/sync_providers.dart';
import '../theme/app_theme.dart';
import '../theme/app_tokens.dart';
import '../ui/app_badge.dart';
import '../ui/app_v2_theme.dart';

// หน้าที่ย้ายมา design system ใหม่แล้ว (ครอบ [AppV2Theme]) ใช้สีจาก token
// (docs/22 §7.1 "ของเดิม Mobile ที่คงไว้") · หน้าที่ยังไม่ย้าย (Task Detail —
// Batch 5) หน้าตาเดิมทุกอย่าง แบบเดียวกับ `AppErrorView`

/// สีพื้น / ไอคอน ของ banner ตามหน้าที่อยู่ — `warning` = เรื่องซิงก์,
/// ไม่ใช่ = ออฟไลน์ (ข้อมูลกลาง)
(Color, Color, double) _bannerStyle(
  BuildContext context, {
  required bool warning,
}) {
  if (AppV2Theme.isActive(context)) {
    return warning
        ? (AppColors.warningSubtle, AppColors.warningForeground, AppRadius.lg)
        : (AppColors.secondary, AppColors.mutedForeground, AppRadius.lg);
  }
  return warning
      ? (const Color(0xFFFFF4E5), const Color(0xFFB45309), 12)
      : (AppTheme.iconBg, AppTheme.textSecondary, 12);
}

/// Small "รอซิงค์" chip for an item whose change is still in the local queue.
class PendingSyncBadge extends StatelessWidget {
  const PendingSyncBadge({super.key});

  @override
  Widget build(BuildContext context) {
    if (AppV2Theme.isActive(context)) {
      return const AppBadge(key: Key('pending_sync_badge'), label: 'รอซิงค์');
    }
    return const Row(
      key: Key('pending_sync_badge'),
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.sync, size: 13, color: AppTheme.textSecondary),
        SizedBox(width: 3),
        Text(
          'รอซิงค์',
          style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
        ),
      ],
    );
  }
}

/// Tells the user that [count] queued change(s) were rejected by the server
/// and dropped (server wins); stays until they acknowledge it.
class SyncFailedBanner extends ConsumerWidget {
  const SyncFailedBanner({super.key, required this.count});

  final int count;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final (bg, fg, radius) = _bannerStyle(context, warning: true);
    return Container(
      key: const Key('sync_failed_banner'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(radius),
      ),
      child: Row(
        children: [
          Icon(Icons.warning_amber_rounded, color: fg),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'ซิงค์ไม่สำเร็จ $count รายการ — เซิร์ฟเวอร์ไม่รับการแก้ไข '
              'จึงใช้ค่าจากเซิร์ฟเวอร์แทน',
              style: const TextStyle(fontSize: 13),
            ),
          ),
          TextButton(
            key: const Key('sync_failed_dismiss'),
            onPressed: () => ref.read(pendingActionDaoProvider).deleteFailed(),
            child: const Text('รับทราบ'),
          ),
        ],
      ),
    );
  }
}

/// Queued changes can't be sent because the session expired (401). There is no
/// re-login that keeps the queue, so say plainly that signing out drops them.
class SyncAuthExpiredBanner extends StatelessWidget {
  const SyncAuthExpiredBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final (bg, fg, radius) = _bannerStyle(context, warning: true);
    return Container(
      key: const Key('sync_auth_expired_banner'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(radius),
      ),
      child: Row(
        children: [
          Icon(Icons.lock_clock_outlined, color: fg),
          const SizedBox(width: 10),
          const Expanded(
            child: Text(
              'เซสชันหมดอายุ รายการที่รอซิงค์ยังส่งไม่ได้ — '
              'ถ้าออกจากระบบ รายการที่ค้างอยู่จะหายไป',
              style: TextStyle(fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

/// "ข้อมูลเมื่อ ..." ของแถบออฟไลน์ — วันนี้บอกแค่ HH:mm วันอื่นบอก dd/MM HH:mm
/// ด้วย (ไม่งั้น cache ของเมื่อวานจะดูเหมือนข้อมูลของวันนี้)
String offlineCacheLabel(DateTime? cachedAt, {DateTime? now}) {
  if (cachedAt == null) return 'ออฟไลน์ แสดงข้อมูลที่บันทึกไว้ในเครื่อง';
  String two(int n) => n.toString().padLeft(2, '0');
  final at = cachedAt.toLocal();
  final today = (now ?? DateTime.now()).toLocal();
  final sameDay =
      at.year == today.year && at.month == today.month && at.day == today.day;
  final time = '${two(at.hour)}:${two(at.minute)}';
  return sameDay
      ? 'ออฟไลน์ ข้อมูลเมื่อ $time'
      : 'ออฟไลน์ ข้อมูลเมื่อ ${two(at.day)}/${two(at.month)} $time';
}

/// เรียก server ไม่ได้ กำลังแสดงข้อมูลที่ cache ไว้ในเครื่อง (UX audit #14) —
/// [cachedAt] คือเวลาที่ cache ถูกบันทึกจาก server จริง ไม่ใช่เวลาปัจจุบัน
class OfflineCacheBanner extends StatelessWidget {
  const OfflineCacheBanner({super.key, required this.cachedAt});

  final DateTime? cachedAt;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, radius) = _bannerStyle(context, warning: false);
    final v2 = AppV2Theme.isActive(context);
    return Container(
      key: const Key('offline_cache_banner'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(radius),
      ),
      child: Row(
        children: [
          Icon(Icons.cloud_off_outlined, color: fg),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              offlineCacheLabel(cachedAt),
              style: TextStyle(
                fontSize: 13,
                color: v2 ? AppColors.foreground : AppTheme.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
