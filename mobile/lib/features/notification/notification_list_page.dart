import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_error_view.dart';
import 'notification_repository.dart';
import 'notification_ui.dart';

String _formatDate(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

/// "รายการแจ้งเตือน" — opened from the Home bell. `GET /notifications`;
/// tapping an unread item calls `PATCH /notifications/{id}/read`.
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

  bool _isRead(AppNotification n) => n.read || _readOverlay.contains(n.id);

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

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('รายการแจ้งเตือน'),
      ),
      body: async.when(
        skipLoadingOnRefresh: true,
        data: (items) {
          if (items.isEmpty) {
            return const _CenteredMessage(
              icon: Icons.notifications_none,
              text: 'ไม่มีการแจ้งเตือน',
            );
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(notificationListProvider),
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, i) {
                final n = items[i];
                return _NotificationTile(
                  key: Key('notification_tile_$i'),
                  notification: n,
                  read: _isRead(n),
                  onTap: () => _markRead(n),
                );
              },
            ),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => AppErrorView(
          message: error is ApiException
              ? error.message
              : 'โหลดการแจ้งเตือนไม่สำเร็จ',
          onRetry: () => ref.invalidate(notificationListProvider),
          messageKey: const Key('notification_list_message'),
          retryKey: const Key('notification_list_retry'),
        ),
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({
    super.key,
    required this.notification,
    required this.read,
    required this.onTap,
  });

  final AppNotification notification;
  final bool read;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: read ? AppTheme.surface : AppTheme.unreadTint,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: const BoxDecoration(
                  color: AppTheme.iconBg,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  NotificationTypeStyle.icon(notification.type),
                  color: AppTheme.navy,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      NotificationTypeStyle.label(notification.type),
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: read ? FontWeight.w500 : FontWeight.w700,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _formatDate(notification.createdAt),
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              if (!read) ...[
                const SizedBox(width: 8),
                Container(
                  key: const Key('unread_dot'),
                  width: 10,
                  height: 10,
                  margin: const EdgeInsets.only(top: 4),
                  decoration: const BoxDecoration(
                    color: AppTheme.unreadDot,
                    shape: BoxShape.circle,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Empty-list state only now — the error+retry case moved to [AppErrorView].
class _CenteredMessage extends StatelessWidget {
  const _CenteredMessage({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 32, color: AppTheme.textSecondary),
            const SizedBox(height: 12),
            Text(
              text,
              key: const Key('notification_list_message'),
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 14,
                color: AppTheme.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
