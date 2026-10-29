import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_empty_state.dart';
import '../../core/ui/app_info_row.dart';
import '../../core/ui/app_page_header.dart';
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
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppPageHeader(
                title: 'ประวัติคำขอ',
                onBack: navigator.canPop() ? navigator.pop : null,
                description:
                    'คำขอส่ง Config/Firmware เข้ากล่องของงานนี้ ใหม่ไปเก่า',
              ),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () => ref.refresh(
                    taskConfigApplyRequestsProvider(taskId).future,
                  ),
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
                              AppCard(
                                size: AppCardSize.small,
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    for (final (i, request) in requests.indexed)
                                      _RequestRow(
                                        key: Key('request_history_row_$i'),
                                        request: request,
                                      ),
                                  ],
                                ),
                              ),
                            ],
                          ),
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

class _RequestRow extends StatelessWidget {
  const _RequestRow({super.key, required this.request});

  final ConfigApplyRequest request;

  @override
  Widget build(BuildContext context) {
    return AppInfoRow(
      label: request.kind == FieldApplyKind.firmware
          ? '${_formatDate(request.requestedAt)} · Firmware '
                'v${request.firmwareVersion ?? '-'}'
          : _formatDate(request.requestedAt),
      child: Align(
        alignment: Alignment.centerLeft,
        child: AppBadge(
          label: configApplyRequestStatusLabel(
            request.status,
            kind: request.kind,
          ),
          tone: configApplyRequestTone(request.status),
          dot: true,
        ),
      ),
    );
  }
}
