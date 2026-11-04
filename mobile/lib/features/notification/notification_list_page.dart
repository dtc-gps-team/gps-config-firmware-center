import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/realtime/live_refresh.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_empty_state.dart';
import '../../core/ui/app_ink_header.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/widgets/app_error_view.dart';
import '../auth/account_sheet.dart';
import 'notification_repository.dart';
import 'notification_ui.dart';

String _two(int n) => n.toString().padLeft(2, '0');

/// เวลาแบบที่คนอ่านเข้าใจทันที: "เมื่อสักครู่" / "N นาทีที่แล้ว" /
/// "N ชม.ที่แล้ว" (วันเดียวกัน) · เกินนั้นเป็น `dd/MM HH:mm` (ต่างปีเติมปี)
String _relativeTime(DateTime createdAt, DateTime now) {
  final d = createdAt.toLocal();
  final diff = now.difference(d);
  if (!diff.isNegative && diff.inMinutes < 1) return 'เมื่อสักครู่';
  if (!diff.isNegative && diff.inMinutes < 60) {
    return '${diff.inMinutes} นาทีที่แล้ว';
  }
  if (!diff.isNegative && diff.inHours < 24 && d.day == now.day) {
    return '${diff.inHours} ชม.ที่แล้ว';
  }
  final date = '${_two(d.day)}/${_two(d.month)}';
  final year = d.year == now.year ? '' : '/${d.year}';
  return '$date$year ${_two(d.hour)}:${_two(d.minute)}';
}

/// หัวข้อช่วงเวลาเดียวกับหน้า Incidents · `GET /notifications` เรียงใหม่ไปเก่า
String _dateBucket(DateTime createdAt, DateTime now) {
  final d = createdAt.toLocal();
  final today = DateTime(now.year, now.month, now.day);
  final diff = today.difference(DateTime(d.year, d.month, d.day)).inDays;
  if (diff <= 0) return 'วันนี้';
  if (diff == 1) return 'เมื่อวาน';
  if (diff < 7) return '7 วันที่ผ่านมา';
  return 'เก่ากว่านั้น';
}

/// "รายการแจ้งเตือน" — opened from the Home bell. `GET /notifications`;
/// tapping an unread item calls `PATCH /notifications/{id}/read`.
///
/// B (04/11/2026): รายการเยอะแล้วอ่านยาก จึงเพิ่มชิป "ทั้งหมด / ยังไม่อ่าน"
/// พร้อมจำนวน ชิปหมวด (เฉพาะหมวดที่มีจริง) หัวข้อตามช่วงวันที่ การ์ดหัวข้อสั้น
/// สีวงไอคอนบอกผล ป้าย "ต้องดำเนินการ" เวลาแบบ "N นาทีที่แล้ว" และปัดซ้าย
/// เพื่ออ่าน · กรองในเครื่องทั้งหมด ไม่ต้องแก้ backend
class NotificationListPage extends ConsumerStatefulWidget {
  const NotificationListPage({super.key});

  @override
  ConsumerState<NotificationListPage> createState() =>
      _NotificationListPageState();
}

class _NotificationListPageState extends ConsumerState<NotificationListPage> {
  /// ids marked read optimistically (kept even after the request returns so
  /// the row stays "read" without waiting for a list refetch).
  final Set<String> _readOverlay = {};

  /// ids with a `markRead` request in flight.
  final Set<String> _marking = {};

  bool _unreadOnly = false;

  /// null = ทุกหมวด
  NotificationCategory? _category;

  bool _isRead(AppNotification n) => n.read || _readOverlay.contains(n.id);

  /// แตะการ์ด — mark-as-read เหมือนเดิม (fire-and-forget, ไม่รอผล) + navigate
  /// ไปหน้าที่เกี่ยวข้องถ้า type นี้มี id นำทางได้ (Mobile UX/UI audit report)
  void _handleTap(BuildContext context, AppNotification n) {
    _markRead(n);
    final route = NotificationTypeStyle.route(n);
    if (route != null) context.push(route);
  }

  Future<void> _markRead(AppNotification n) async {
    if (_isRead(n) || _marking.contains(n.id)) return;
    setState(() {
      _readOverlay.add(n.id);
      _marking.add(n.id);
    });
    try {
      await ref.read(notificationRepositoryProvider).markRead(n.id);
      // Home bell badge reads a separate ?unread=true call — refresh it.
      ref.invalidate(unreadNotificationCountProvider);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _readOverlay.remove(n.id));
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text('ทำเครื่องหมายว่าอ่านไม่สำเร็จ: ${e.message}'),
          ),
        );
    } finally {
      if (mounted) setState(() => _marking.remove(n.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(notificationListProvider);

    final navigator = Navigator.of(context);

    return LiveRefresh(
      interval: const Duration(seconds: 15),
      onRefresh: () async {
        await ref.refresh(notificationListProvider.future).then<void>((_) {});
      },
      child: AppV2Theme(
        child: Scaffold(
          body: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppInkHeader(
                title: 'แจ้งเตือน',
                subtitle: 'การอนุมัติและผลการทำงาน',
                onBack: navigator.canPop() ? navigator.pop : null,
                trailing: const AccountButton(),
              ),
              Expanded(
                child: async.when(
                  skipLoadingOnRefresh: true,
                  skipError: true,
                  data: (items) {
                    if (items.isEmpty) {
                      return const Align(
                        alignment: Alignment.topCenter,
                        child: AppEmptyState(
                          icon: Icons.notifications_none,
                          message: 'ไม่มีการแจ้งเตือน',
                          messageKey: Key('notification_list_message'),
                        ),
                      );
                    }
                    final inCategory = items
                        .where(
                          (n) =>
                              _category == null ||
                              NotificationTypeStyle.category(n.type) ==
                                  _category,
                        )
                        .toList(growable: false);
                    final unreadCount = inCategory
                        .where((n) => !_isRead(n))
                        .length;
                    final visible = _unreadOnly
                        ? inCategory.where((n) => !_isRead(n)).toList()
                        : inCategory;
                    // ชิปหมวดแสดงเฉพาะหมวดที่มีแจ้งเตือนจริง ไม่รกด้วยหมวดว่าง
                    final present = {
                      for (final n in items)
                        NotificationTypeStyle.category(n.type),
                    };
                    final filters = _NotificationFilterBar(
                      allCount: inCategory.length,
                      unreadCount: unreadCount,
                      unreadOnly: _unreadOnly,
                      onUnreadOnly: (v) => setState(() => _unreadOnly = v),
                      categories: [
                        for (final c in NotificationCategory.values)
                          if (present.contains(c)) c,
                      ],
                      category: _category,
                      onCategory: (c) => setState(() => _category = c),
                    );
                    return RefreshIndicator(
                      onRefresh: () async =>
                          ref.invalidate(notificationListProvider),
                      child: _NotificationSections(
                        header: filters,
                        visible: visible,
                        all: items,
                        isRead: _isRead,
                        onTap: (n) => _handleTap(context, n),
                        onSwipeRead: _markRead,
                        noMatch: AppEmptyState(
                          icon: Icons.mark_email_read_outlined,
                          message: _unreadOnly
                              ? 'อ่านครบทุกรายการแล้ว'
                              : 'ไม่มีแจ้งเตือนในหมวดนี้',
                          messageKey: const Key('notification_no_match'),
                        ),
                      ),
                    );
                  },
                  loading: () => const AppListSkeleton(
                    padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                  ),
                  error: (error, _) => AppErrorView(
                    message: error is ApiException
                        ? error.message
                        : 'โหลดการแจ้งเตือนไม่สำเร็จ',
                    onRetry: () => ref.invalidate(notificationListProvider),
                    messageKey: const Key('notification_list_message'),
                    retryKey: const Key('notification_list_retry'),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NotificationFilterBar extends StatelessWidget {
  const _NotificationFilterBar({
    required this.allCount,
    required this.unreadCount,
    required this.unreadOnly,
    required this.onUnreadOnly,
    required this.categories,
    required this.category,
    required this.onCategory,
  });

  final int allCount;
  final int unreadCount;
  final bool unreadOnly;
  final ValueChanged<bool> onUnreadOnly;
  final List<NotificationCategory> categories;
  final NotificationCategory? category;
  final ValueChanged<NotificationCategory?> onCategory;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      // Wrap: จอกว้างได้แถวเดียว จอแคบตัดลงบรรทัดใหม่ ไม่มีชิปตกขอบ
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          ChoiceChip(
            key: const Key('notification_filter_all'),
            label: Text('ทั้งหมด $allCount'),
            selected: !unreadOnly,
            showCheckmark: false,
            onSelected: (_) => onUnreadOnly(false),
          ),
          ChoiceChip(
            key: const Key('notification_filter_unread'),
            label: Text('ยังไม่อ่าน $unreadCount'),
            selected: unreadOnly,
            showCheckmark: false,
            onSelected: (_) => onUnreadOnly(true),
          ),
          // หมวดเดียวไม่ต้องมีชิปให้กรอง
          if (categories.length > 1)
            for (final c in categories)
              FilterChip(
                key: Key('notification_category_${c.name}'),
                label: Text(c.label),
                selected: category == c,
                showCheckmark: false,
                // กดซ้ำ = ยกเลิกกลับเป็นทุกหมวด
                onSelected: (on) => onCategory(on ? c : null),
              ),
        ],
      ),
    );
  }
}

class _NotificationSections extends StatelessWidget {
  const _NotificationSections({
    required this.header,
    required this.visible,
    required this.all,
    required this.isRead,
    required this.onTap,
    required this.onSwipeRead,
    required this.noMatch,
  });

  final Widget header;
  final List<AppNotification> visible;

  /// รายการเต็มจาก API ใช้หา index เดิมให้ key `notification_tile_N` คงที่
  final List<AppNotification> all;
  final bool Function(AppNotification) isRead;
  final ValueChanged<AppNotification> onTap;
  final ValueChanged<AppNotification> onSwipeRead;
  final Widget noMatch;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    // Widget = แถบกรอง/ไม่พบ, String = หัวข้อวันที่, AppNotification = การ์ด
    final rows = <Object>[header, if (visible.isEmpty) noMatch];
    String? last;
    for (final n in visible) {
      final bucket = _dateBucket(n.createdAt, now);
      if (bucket != last) {
        rows.add(bucket);
        last = bucket;
      }
      rows.add(n);
    }
    // แถบกรองเลื่อนไปกับรายการ (ไม่ตรึง) จอเล็ก + ตัวอักษรใหญ่ไม่ล้นจอ
    return ListView.builder(
      key: const Key('notification_list'),
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: 16),
      itemCount: rows.length,
      itemBuilder: (context, i) {
        final row = rows[i];
        if (row is Widget) return row;
        if (row is String) return _SectionTitle(row);
        final n = row as AppNotification;
        final index = all.indexOf(n);
        final read = isRead(n);
        final tile = _NotificationTile(
          key: Key('notification_tile_$index'),
          notification: n,
          read: read,
          now: now,
          onTap: () => onTap(n),
        );
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: read
              ? tile
              // ปัดซ้ายเพื่อทำเครื่องหมายว่าอ่าน · คืน false ให้การ์ดอยู่ที่เดิม
              // (แค่เปลี่ยนเป็นอ่านแล้ว ไม่ได้ลบ)
              : Dismissible(
                  key: Key('notification_swipe_${n.id}'),
                  direction: DismissDirection.endToStart,
                  confirmDismiss: (_) async {
                    onSwipeRead(n);
                    return false;
                  },
                  background: Container(
                    alignment: Alignment.centerRight,
                    padding: const EdgeInsets.only(right: 20),
                    decoration: BoxDecoration(
                      color: AppColors.successSubtle,
                      borderRadius: BorderRadius.circular(AppRadius.lg),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.done_all, color: AppColors.success),
                        SizedBox(width: 6),
                        Text(
                          'อ่านแล้ว',
                          style: TextStyle(
                            color: AppColors.success,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  child: tile,
                ),
        );
      },
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(18, 8, 16, 6),
    child: Text(
      title,
      style: const TextStyle(
        fontSize: AppTypography.sm,
        height: AppTypography.smHeight,
        fontWeight: FontWeight.w600,
        color: AppColors.mutedForeground,
      ),
    ),
  );
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({
    super.key,
    required this.notification,
    required this.read,
    required this.now,
    required this.onTap,
  });

  final AppNotification notification;
  final bool read;
  final DateTime now;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final type = notification.type;
    final (iconBg, iconFg) = NotificationTypeStyle.iconColors(type);
    final needsAction =
        NotificationTypeStyle.tone(type) == NotificationTone.action;
    final canOpen = NotificationTypeStyle.route(notification) != null;
    // ยังไม่อ่าน: พื้น accent (AppCard.highlighted) + ชื่อตัวหนา + ป้าย "ใหม่" —
    // บอกสถานะด้วยหลายอย่าง ไม่ใช่สีพื้นอย่างเดียว
    return AppCard(
      onTap: onTap,
      highlighted: !read,
      size: AppCardSize.small,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: iconBg, shape: BoxShape.circle),
            child: Icon(
              NotificationTypeStyle.icon(type),
              color: iconFg,
              size: 18,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        NotificationTypeStyle.shortLabelOf(notification),
                        style: TextStyle(
                          fontSize: AppTypography.sm,
                          height: AppTypography.smHeight,
                          fontWeight: read ? FontWeight.w500 : FontWeight.w700,
                          color: AppColors.foreground,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      _relativeTime(notification.createdAt, now),
                      key: const Key('notification_time'),
                      style: const TextStyle(
                        fontSize: AppTypography.xs,
                        height: AppTypography.smHeight,
                        color: AppColors.mutedForeground,
                      ),
                    ),
                  ],
                ),
                for (final line in NotificationTypeStyle.details(
                  notification,
                )) ...[
                  const SizedBox(height: 2),
                  Text(
                    line,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: AppTypography.sm,
                      height: AppTypography.smHeight,
                      color: AppColors.mutedForeground,
                    ),
                  ),
                ],
                if (needsAction || !read) ...[
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      if (!read)
                        AppBadge(
                          key: const Key('unread_dot'),
                          label: 'ใหม่',
                          tone: AppBadgeTone.success,
                          dot: true,
                        ),
                      if (needsAction)
                        const AppBadge(
                          key: Key('notification_needs_action'),
                          label: 'ต้องดำเนินการ',
                          tone: AppBadgeTone.warning,
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          // ลูกศรเฉพาะการ์ดที่แตะแล้วไปหน้าอื่นได้จริง
          if (canOpen) ...[
            const SizedBox(width: 4),
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Icon(
                Icons.chevron_right,
                key: Key('notification_open_hint'),
                color: AppColors.mutedForeground,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
