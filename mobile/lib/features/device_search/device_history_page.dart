import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_ink_header.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/widgets/app_error_view.dart';
import 'device_history_repository.dart';

String _formatDate(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

/// ประวัติรายเครื่อง (R4-04 · ภาพ r4 0265–0330) — `GET /devices/{id}/history`
/// ใหม่ไปเก่า · หน้าแรกจาก [deviceHistoryProvider] หน้าถัดไปโหลดด้วย cursor เมื่อกด
/// "โหลดเพิ่ม" · backend กรองชนิดรายการตามสิทธิ์ของผู้ใช้เองแล้ว
class DeviceHistoryPage extends ConsumerStatefulWidget {
  const DeviceHistoryPage({super.key, required this.deviceId});

  final String deviceId;

  @override
  ConsumerState<DeviceHistoryPage> createState() => _DeviceHistoryPageState();
}

class _DeviceHistoryPageState extends ConsumerState<DeviceHistoryPage> {
  final _more = <DeviceHistoryItem>[];
  String? _cursor;
  bool _cursorFromMore = false;
  bool _loadingMore = false;
  String? _moreError;

  Future<void> _loadMore(String cursor) async {
    setState(() {
      _loadingMore = true;
      _moreError = null;
    });
    try {
      final page = await ref
          .read(deviceHistoryRepositoryProvider)
          .getHistory(widget.deviceId, before: cursor);
      if (!mounted) return;
      setState(() {
        _more.addAll(page.items);
        _cursor = page.nextCursor;
        _cursorFromMore = true;
        _loadingMore = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingMore = false;
        _moreError = e.message;
      });
    }
  }

  Future<void> _refresh() async {
    setState(() {
      _more.clear();
      _cursor = null;
      _cursorFromMore = false;
      _moreError = null;
    });
    ref.invalidate(deviceHistoryProvider(widget.deviceId));
    await ref.read(deviceHistoryProvider(widget.deviceId).future);
  }

  @override
  Widget build(BuildContext context) {
    final navigator = Navigator.of(context);
    final historyAsync = ref.watch(deviceHistoryProvider(widget.deviceId));
    return AppV2Theme(
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AppInkHeader(
              title: 'ประวัติ ${widget.deviceId}',
              subtitle: 'ประวัติการทำงานกับอุปกรณ์',
              onBack: navigator.canPop() ? navigator.pop : null,
            ),
            Expanded(
              child: historyAsync.when(
                skipLoadingOnRefresh: true,
                loading: () => const AppListSkeleton(
                  key: Key('device_history_loading'),
                  padding: EdgeInsets.fromLTRB(18, 16, 18, 16),
                ),
                error: (error, _) => ListView(
                  children: [
                    const SizedBox(height: 48),
                    AppErrorView(
                      message: error is ApiException
                          ? error.message
                          : 'โหลดประวัติเครื่องไม่สำเร็จ',
                      onRetry: () => ref.invalidate(
                        deviceHistoryProvider(widget.deviceId),
                      ),
                      messageKey: const Key('device_history_error'),
                      retryKey: const Key('device_history_retry'),
                    ),
                  ],
                ),
                data: (first) {
                  final items = [...first.items, ..._more];
                  final cursor = _cursorFromMore ? _cursor : first.nextCursor;
                  return RefreshIndicator(
                    onRefresh: _refresh,
                    child: ListView(
                      key: const Key('device_history_list'),
                      padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: [
                        if (items.isEmpty)
                          const _EmptyHistory()
                        else
                          for (final item in items) ...[
                            _HistoryRow(item: item),
                            const SizedBox(height: 10),
                          ],
                        if (_moreError != null)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Text(
                              'โหลดเพิ่มไม่สำเร็จ: $_moreError',
                              key: const Key('device_history_more_error'),
                              style: const TextStyle(
                                color: AppColors.dangerForeground,
                              ),
                            ),
                          ),
                        if (cursor != null)
                          OutlinedButton(
                            key: const Key('device_history_more'),
                            onPressed: _loadingMore
                                ? null
                                : () => _loadMore(cursor),
                            child: Text(
                              _loadingMore ? 'กำลังโหลด…' : 'โหลดเพิ่ม',
                            ),
                          ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyHistory extends StatelessWidget {
  const _EmptyHistory();

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('device_history_empty'),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 28),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.border),
      ),
      child: const Column(
        children: [
          Icon(Icons.edit_note, size: 28, color: AppColors.mutedForeground),
          SizedBox(height: 10),
          Text(
            'ยังไม่มีประวัติ',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

/// ชื่อชนิด + หัวเรื่องของรายการ (ภาษาที่ช่างอ่านเข้าใจ ไม่ใช้คำใน API)
({IconData icon, String headline}) _describe(DeviceHistoryItem item) {
  switch (item.type) {
    case DeviceHistoryType.lifecycle:
      return (
        icon: Icons.inventory_2_outlined,
        headline: item.status == 'installed'
            ? 'ติดตั้งเครื่อง'
            : 'ลงทะเบียนเครื่อง',
      );
    case DeviceHistoryType.rollout:
      final firmware = item.payloadType == 'Firmware';
      final what = firmware
          ? 'Firmware ${item.firmwareVersion ?? ''}'.trim()
          : 'Config ${item.configName ?? ''}'.trim();
      return (
        icon: firmware ? Icons.memory : Icons.tune,
        headline: 'ส่ง $what',
      );
    case DeviceHistoryType.configOverride:
      return (icon: Icons.tune, headline: 'ขอแก้ค่าเฉพาะเครื่อง');
    case DeviceHistoryType.firmwareOverride:
      return (icon: Icons.memory, headline: 'ขอ Firmware Override');
    case DeviceHistoryType.task:
      return (icon: Icons.assignment_outlined, headline: 'งานภาคสนาม');
    case DeviceHistoryType.incident:
      return (icon: Icons.warning_amber_outlined, headline: 'Incident');
    case DeviceHistoryType.unknown:
      return (icon: Icons.history, headline: 'เหตุการณ์อื่น');
  }
}

/// สถานะเป็นคำไทย + โทนสี · สถานะที่ไม่รู้จักแสดงคำเดิมจาก API
({String label, AppBadgeTone tone})? _statusOf(String? status) {
  return switch (status) {
    null => null,
    'success' || 'succeeded' || 'completed' || 'approved' || 'resolved' => (
      label: switch (status) {
        'approved' => 'อนุมัติแล้ว',
        'completed' => 'เสร็จแล้ว',
        'resolved' => 'แก้ไขแล้ว',
        _ => 'สำเร็จ',
      },
      tone: AppBadgeTone.success,
    ),
    'failed' || 'rejected' => (
      label: status == 'failed' ? 'ไม่สำเร็จ' : 'ไม่อนุมัติ',
      tone: AppBadgeTone.danger,
    ),
    'pending' => (label: 'รอดำเนินการ', tone: AppBadgeTone.warning),
    'in_progress' => (label: 'กำลังทำ', tone: AppBadgeTone.warning),
    'skipped_offline' => (label: 'ข้าม (ออฟไลน์)', tone: AppBadgeTone.neutral),
    'cancelled' => (label: 'ยกเลิก', tone: AppBadgeTone.neutral),
    'installed' || 'registered' => null,
    _ => (label: status, tone: AppBadgeTone.neutral),
  };
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({required this.item});

  final DeviceHistoryItem item;

  @override
  Widget build(BuildContext context) {
    final d = _describe(item);
    final status = _statusOf(item.status);
    final title = item.title;
    final detail = item.detail;
    return Container(
      key: Key('device_history_row_${item.id}'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppColors.accent,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(d.icon, size: 20, color: AppColors.accentForeground),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  d.headline,
                  style: const TextStyle(
                    fontSize: 15,
                    height: 1.35,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (title != null && title.isNotEmpty)
                  Text(
                    title,
                    style: const TextStyle(fontSize: 13, height: 1.4),
                  ),
                if (detail != null && detail.isNotEmpty)
                  Text(
                    detail,
                    style: const TextStyle(
                      fontSize: 12.5,
                      height: 1.4,
                      color: AppColors.mutedForeground,
                    ),
                  ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (status != null)
                      AppBadge(label: status.label, tone: status.tone),
                    Text(
                      _formatDate(item.occurredAt),
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.mutedForeground,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
