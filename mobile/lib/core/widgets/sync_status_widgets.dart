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
