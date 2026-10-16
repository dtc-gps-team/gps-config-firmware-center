import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sync/sync_providers.dart';
import '../theme/app_theme.dart';

/// Small "รอซิงค์" chip for an item whose change is still in the local queue.
class PendingSyncBadge extends StatelessWidget {
  const PendingSyncBadge({super.key});

  @override
  Widget build(BuildContext context) {
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
    return Container(
      key: const Key('sync_failed_banner'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF4E5),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          const Icon(Icons.warning_amber_rounded, color: Color(0xFFB45309)),
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
    return Container(
      key: const Key('sync_auth_expired_banner'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF4E5),
        borderRadius: BorderRadius.circular(12),
      ),
      child: const Row(
        children: [
          Icon(Icons.lock_clock_outlined, color: Color(0xFFB45309)),
          SizedBox(width: 10),
          Expanded(
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
  if (cachedAt == null) return 'ออฟไลน์ — แสดงข้อมูลที่บันทึกไว้ในเครื่อง';
  String two(int n) => n.toString().padLeft(2, '0');
  final at = cachedAt.toLocal();
  final today = (now ?? DateTime.now()).toLocal();
  final sameDay =
      at.year == today.year && at.month == today.month && at.day == today.day;
  final time = '${two(at.hour)}:${two(at.minute)}';
  return sameDay
      ? 'ออฟไลน์ — ข้อมูลเมื่อ $time'
      : 'ออฟไลน์ — ข้อมูลเมื่อ ${two(at.day)}/${two(at.month)} $time';
}

/// เรียก server ไม่ได้ กำลังแสดงข้อมูลที่ cache ไว้ในเครื่อง (UX audit #14) —
/// [cachedAt] คือเวลาที่ cache ถูกบันทึกจาก server จริง ไม่ใช่เวลาปัจจุบัน
class OfflineCacheBanner extends StatelessWidget {
  const OfflineCacheBanner({super.key, required this.cachedAt});

  final DateTime? cachedAt;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('offline_cache_banner'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.iconBg,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          const Icon(Icons.cloud_off_outlined, color: AppTheme.textSecondary),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              offlineCacheLabel(cachedAt),
              style: const TextStyle(fontSize: 13, color: AppTheme.textPrimary),
            ),
          ),
        ],
      ),
    );
  }
}
