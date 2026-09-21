import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Shared "error icon + message + ลองอีกครั้ง" block — pulled out of the
/// near-identical copies in Home, Task List/Detail, Device Search/Detail,
/// Incident List, and Notification List (pure refactor, same look each was
/// already using).
///
/// Two layouts, matching what each screen already had — this widget does
/// not force them to converge:
///  - default (`compact: false`): centered icon(32) + message + full-width
///    [FilledButton], used for full-page/list error states. Callers that
///    show this inside a scrollable (so pull-to-refresh still works while
///    showing the error) wrap it themselves, e.g.
///    `ListView(children: [SizedBox(height: 64), AppErrorView(...)])`.
///  - `compact: true`: the small inline card (icon(18) + message in a Row,
///    right-aligned [TextButton] below) that Home uses for its "งานวันนี้"
///    preview card, where a full-page error block would be too heavy.
///
/// [retryKey] / [messageKey] let call sites keep the exact `Key`s their
/// existing widget tests already reference (e.g. `my_tasks_retry`,
/// `device_search_error`) — this widget never invents its own.
class AppErrorView extends StatelessWidget {
  const AppErrorView({
    super.key,
    required this.message,
    required this.onRetry,
    this.retryKey,
    this.messageKey,
    this.compact = false,
  });

  final String message;
  final VoidCallback onRetry;
  final Key? retryKey;
  final Key? messageKey;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (compact) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(
                  Icons.error_outline,
                  size: 18,
                  color: AppTheme.error,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    message,
                    key: messageKey,
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                ),
              ],
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                key: retryKey,
                onPressed: onRetry,
                style: TextButton.styleFrom(foregroundColor: AppTheme.navy),
                child: const Text('ลองอีกครั้ง'),
              ),
            ),
          ],
        ),
      );
    }

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.error_outline,
              color: AppTheme.error.withValues(alpha: 0.7),
              size: 32,
            ),
            const SizedBox(height: 12),
            Text(
              message,
              key: messageKey,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 14,
                color: AppTheme.textSecondary,
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              key: retryKey,
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('ลองอีกครั้ง'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.navy,
                side: const BorderSide(color: AppTheme.navy),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
