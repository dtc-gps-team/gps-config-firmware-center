import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_empty_state.dart';
import '../../core/ui/app_ink_header.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/ui/labels.dart';
import '../../core/ui/status_tones.dart';
import '../../core/widgets/app_error_view.dart';
import 'config_apply_request_repository.dart';

String _formatDate(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

/// ประวัติคำขอส่งเข้ากล่องทั้งหมดของงานหนึ่งใบ (docs/28 — งาน 1 ใบขอได้หลายครั้ง)
/// เรียงใหม่ไปเก่า · แยกออกจากหน้างาน ไม่ให้รายการยาวอัดอยู่ในหน้าเดียว (หน้างาน
/// มีปุ่ม "ประวัติคำขอ" พาเข้ามา)
class ApplyRequestHistoryPage extends ConsumerWidget {
  const ApplyRequestHistoryPage({super.key, required this.taskId});

  final String taskId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final requestsAsync = ref.watch(taskConfigApplyRequestsProvider(taskId));
    final navigator = Navigator.of(context);

    return AppV2Theme(
      child: Scaffold(
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AppInkHeader(
              title: 'ประวัติคำขอ',
              subtitle: 'งาน $taskId · ใหม่ไปเก่า',
              onBack: navigator.canPop() ? navigator.pop : null,
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () =>
                    ref.refresh(taskConfigApplyRequestsProvider(taskId).future),
                child: requestsAsync.when(
                  skipLoadingOnRefresh: true,
                  loading: () => const AppListSkeleton(
                    count: 4,
                    padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                  ),
                  error: (error, _) => ListView(
                    children: [
                      const SizedBox(height: 64),
                      AppErrorView(
                        message: error is ApiException
                            ? error.message
                            : 'โหลดประวัติคำขอไม่สำเร็จ',
                        messageKey: const Key('request_history_error'),
                        retryKey: const Key('request_history_retry'),
                        onRetry: () => ref.invalidate(
                          taskConfigApplyRequestsProvider(taskId),
                        ),
                      ),
                    ],
                  ),
                  data: (requests) => requests.isEmpty
                      ? ListView(
                          children: const [
                            SizedBox(height: 48),
                            AppEmptyState(
                              icon: Icons.history,
                              message: 'งานนี้ยังไม่เคยขอส่งเข้ากล่อง',
                              messageKey: Key('request_history_empty'),
                            ),
                          ],
                        )
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
                          children: [
                            for (final (i, request) in requests.indexed) ...[
                              AppCard(
                                key: Key('request_history_row_$i'),
                                size: AppCardSize.small,
                                child: _RequestRow(index: i, request: request),
                              ),
                              const SizedBox(height: 10),
                            ],
                          ],
                        ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RequestRow extends StatelessWidget {
  const _RequestRow({required this.index, required this.request});

  final int index;
  final ConfigApplyRequest request;

  @override
  Widget build(BuildContext context) {
    final title = request.kind == FieldApplyKind.firmware
        ? 'ขออัปเดต Firmware v${request.firmwareVersion ?? '-'}'
        : 'ขอส่ง Config';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          key: Key('request_history_title_$index'),
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 4),
        Text(
          _formatDate(request.requestedAt),
          style: const TextStyle(
            fontSize: AppTypography.xs,
            height: AppTypography.xsHeight,
            color: AppColors.mutedForeground,
          ),
        ),
        const SizedBox(height: 8),
        AppBadge(
          label: configApplyRequestStatusLabel(
            request.status,
            kind: request.kind,
          ),
          tone: configApplyRequestTone(request.status),
          dot: true,
        ),
      ],
    );
  }
}
