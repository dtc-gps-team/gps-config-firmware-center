import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/widgets/sync_status_widgets.dart';
import '../task/task_repository.dart';

/// แถบสถานะบนสุดของ Home สำหรับช่าง — แยกไฟล์จาก home_page.dart (ไฟล์นั้นมี
/// หลาย PR แก้คนละส่วนอยู่) · ออฟไลน์ กำลังแสดงข้อมูลงานจาก cache (UX audit #14)
class HomeStatusBanners extends ConsumerWidget {
  const HomeStatusBanners({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final offline = ref.watch(taskCacheSnapshotProvider);
    final banners = [
      if (offline != null) OfflineCacheBanner(cachedAt: offline.cachedAt),
    ];
    if (banners.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        children: [
          for (final (i, b) in banners.indexed) ...[
            if (i > 0) const SizedBox(height: 8),
            b,
          ],
        ],
      ),
    );
  }
}
