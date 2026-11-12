import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_empty_state.dart';
import '../../core/ui/app_filter_controls.dart';
import '../../core/ui/app_ink_header.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/ui/labels.dart';
import '../../core/ui/status_tones.dart';
import '../../core/widgets/app_error_view.dart';
import 'config_apply_request_repository.dart';

/// โหลดหน้าถัดไปเมื่อเหลือพื้นที่ให้เลื่อนน้อยกว่านี้
const _loadMoreThreshold = 300.0;

String _two(int n) => n.toString().padLeft(2, '0');

/// หัวกลุ่มของวัน (เวลาเครื่อง): วันนี้ / เมื่อวาน / วันที่เต็ม
String _dayLabel(DateTime at, DateTime now) {
  final d = at.toLocal();
  final day = DateTime(d.year, d.month, d.day);
  final diff = DateTime(now.year, now.month, now.day).difference(day).inDays;
  if (diff <= 0) return 'วันนี้';
  if (diff == 1) return 'เมื่อวาน';
  return '${_two(d.day)}/${_two(d.month)}/${d.year}';
}

/// ตัวกรองกลุ่มผล — แถบบนสุดของหน้า
enum _ResultTab {
  all('ทั้งหมด', null),
  succeeded('สำเร็จ', ApplyHistoryResult.succeeded),
  unsuccessful('ไม่สำเร็จ', ApplyHistoryResult.unsuccessful),
  open('รอดำเนินการ', ApplyHistoryResult.open);

  const _ResultTab(this.label, this.result);
  final String label;
  final ApplyHistoryResult? result;
}

/// ประวัติคำขอส่งเข้ากล่องของงานหนึ่งใบ (docs/28 — งาน 1 ใบขอได้หลายครั้ง) ·
/// แบ่งหน้าจาก backend (v3.96) เลื่อนถึงท้ายแล้วโหลดต่อเอง · กรองกลุ่มผลและชนิด
/// ที่ server · จัดกลุ่มตามวัน · แตะแถวเปิดหน้ารายละเอียด (หน้าความคืบหน้า)
class ApplyRequestHistoryPage extends ConsumerStatefulWidget {
  const ApplyRequestHistoryPage({super.key, required this.taskId});

  final String taskId;

  @override
  ConsumerState<ApplyRequestHistoryPage> createState() =>
      _ApplyRequestHistoryPageState();
}

class _ApplyRequestHistoryPageState
    extends ConsumerState<ApplyRequestHistoryPage> {
  final _scroll = ScrollController();
  _ResultTab _tab = _ResultTab.all;
  FieldApplyKind? _kind;

  List<ConfigApplyRequest> _items = const [];
  String? _cursor;
  bool _loading = true;
  bool _loadingMore = false;
  Object? _error;
  Object? _moreError;

  /// เพิ่มทุกครั้งที่เริ่มโหลดใหม่ (เปลี่ยนตัวกรอง/รีเฟรช) — ผลของรอบเก่าที่มาช้าทิ้งไป
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_maybeLoadMore);
    _reload();
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  bool get _filtered => _tab != _ResultTab.all || _kind != null;

  Future<void> _reload() async {
    final gen = ++_generation;
    setState(() {
      _loading = _items.isEmpty;
      _loadingMore = false;
      _error = null;
      _moreError = null;
    });
    try {
      final page = await ref
          .read(configApplyRequestRepositoryProvider)
          .history(widget.taskId, result: _tab.result, kind: _kind);
      if (!mounted || gen != _generation) return;
      setState(() {
        _items = page.items;
        _cursor = page.nextCursor;
        _loading = false;
      });
      _fillViewport();
    } catch (e) {
      if (!mounted || gen != _generation) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    final cursor = _cursor;
    if (cursor == null || _loadingMore || _loading) return;
    final gen = _generation;
    setState(() {
      _loadingMore = true;
      _moreError = null;
    });
    try {
      final page = await ref
          .read(configApplyRequestRepositoryProvider)
          .history(
            widget.taskId,
            before: cursor,
            result: _tab.result,
            kind: _kind,
          );
      if (!mounted || gen != _generation) return;
      setState(() {
        _items = [..._items, ...page.items];
        _cursor = page.nextCursor;
        _loadingMore = false;
      });
      _fillViewport();
    } catch (e) {
      if (!mounted || gen != _generation) return;
      setState(() {
        _moreError = e;
        _loadingMore = false;
      });
    }
  }

  void _maybeLoadMore() {
    if (!_scroll.hasClients || _moreError != null) return;
    if (_scroll.position.extentAfter < _loadMoreThreshold) _loadMore();
  }

  /// รายการสั้นจนไม่เต็มจอ = เลื่อนไม่ได้ จึงโหลดหน้าถัดไปให้เองจนเต็มหรือหมด
  void _fillViewport() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _maybeLoadMore();
    });
  }

  void _setTab(_ResultTab tab) {
    if (tab == _tab) return;
    setState(() {
      _tab = tab;
      _items = const [];
    });
    _reload();
  }

  void _setKind(FieldApplyKind? kind) {
    if (kind == _kind) return;
    setState(() {
      _kind = kind;
      _items = const [];
    });
    _reload();
  }

  Future<void> _open(ConfigApplyRequest request) async {
    final router = GoRouter.maybeOf(context);
    if (router == null) return;
    await router.push(AppRoutes.taskApplyProgress(widget.taskId, request.id));
    // กลับมาแล้วสถานะอาจเปลี่ยน (ส่งใหม่/กดส่ง) — โหลดหน้าแรกใหม่
    if (mounted) _reload();
  }

  @override
  Widget build(BuildContext context) {
    final navigator = Navigator.of(context);
    return AppV2Theme(
      child: Scaffold(
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AppInkHeader(
              title: 'ประวัติคำขอ',
              subtitle: 'คำขอส่งเข้ากล่องของงานนี้ · ใหม่ไปเก่า',
              onBack: navigator.canPop() ? navigator.pop : null,
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AppSegmentedToggle<_ResultTab>(
                    selected: _tab,
                    onChanged: _setTab,
                    options: [
                      for (final t in _ResultTab.values)
                        AppFilterOption(
                          value: t,
                          label: t.label,
                          key: Key('request_history_result_${t.name}'),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: AppFilterMenu<FieldApplyKind>(
                      key: const Key('request_history_kind_menu'),
                      placeholder: 'ชนิด',
                      allLabel: 'ทุกชนิด',
                      allKey: const Key('request_history_kind_all'),
                      tooltip: 'เลือกชนิดคำขอ',
                      selected: _kind,
                      onChanged: _setKind,
                      options: const [
                        AppFilterOption(
                          value: FieldApplyKind.config,
                          label: 'Config',
                          key: Key('request_history_kind_config'),
                        ),
                        AppFilterOption(
                          value: FieldApplyKind.firmware,
                          label: 'Firmware',
                          key: Key('request_history_kind_firmware'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: RefreshIndicator(onRefresh: _reload, child: _body()),
            ),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return const AppListSkeleton(
        count: 4,
        padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
      );
    }
    final error = _error;
    if (error != null && _items.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const SizedBox(height: 48),
          AppErrorView(
            message: error is ApiException
                ? error.message
                : 'โหลดประวัติคำขอไม่สำเร็จ',
            messageKey: const Key('request_history_error'),
            retryKey: const Key('request_history_retry'),
            onRetry: _reload,
          ),
        ],
      );
    }
    if (_items.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const SizedBox(height: 48),
          _filtered
              ? const AppEmptyState(
                  icon: Icons.filter_alt_off_outlined,
                  message: 'ไม่มีคำขอที่ตรงกับตัวกรอง',
                  messageKey: Key('request_history_no_match'),
                )
              : const AppEmptyState(
                  icon: Icons.history,
                  message: 'งานนี้ยังไม่เคยขอส่งเข้ากล่อง',
                  messageKey: Key('request_history_empty'),
                ),
        ],
      );
    }

    final now = DateTime.now();
    final children = <Widget>[];
    String? lastDay;
    for (final (i, request) in _items.indexed) {
      final day = _dayLabel(request.requestedAt, now);
      if (day != lastDay) {
        lastDay = day;
        children.add(_DayHeader(label: day, first: i == 0));
      }
      children
        ..add(
          AppCard(
            key: Key('request_history_row_$i'),
            size: AppCardSize.small,
            onTap: () => _open(request),
            child: _RequestRow(index: i, request: request),
          ),
        )
        ..add(const SizedBox(height: 8));
    }
    children.add(_footer());

    return ListView(
      key: const Key('request_history_list'),
      controller: _scroll,
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
      children: children,
    );
  }

  Widget _footer() {
    if (_loadingMore) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Center(
          child: SizedBox.square(
            dimension: 24,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }
    if (_moreError != null) {
      return Center(
        child: TextButton.icon(
          key: const Key('request_history_more_retry'),
          onPressed: _loadMore,
          icon: const Icon(Icons.refresh),
          label: const Text('โหลดเพิ่มไม่สำเร็จ แตะเพื่อลองใหม่'),
        ),
      );
    }
    if (_cursor == null) {
      return const Padding(
        key: Key('request_history_end'),
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Text(
          'แสดงครบแล้ว',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: AppTypography.xs,
            height: AppTypography.xsHeight,
            color: AppColors.mutedForeground,
          ),
        ),
      );
    }
    return const SizedBox(height: 48);
  }
}

class _DayHeader extends StatelessWidget {
  const _DayHeader({required this.label, required this.first});

  final String label;
  final bool first;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(top: first ? 4 : 12, bottom: 6),
      child: Text(
        label,
        style: const TextStyle(
          fontSize: AppTypography.xs,
          height: AppTypography.xsHeight,
          fontWeight: FontWeight.w700,
          letterSpacing: .3,
          color: AppColors.mutedForeground,
        ),
      ),
    );
  }
}

/// ไอคอนคู่สถานะ — ไม่ให้สีของป้ายเป็นสิ่งเดียวที่บอกผล
IconData _statusIcon(ConfigApplyRequestStatus status) => switch (status) {
  ConfigApplyRequestStatus.succeeded => Icons.check_circle_outline,
  ConfigApplyRequestStatus.pending ||
  ConfigApplyRequestStatus.approved => Icons.schedule,
  ConfigApplyRequestStatus.sending => Icons.sync,
  ConfigApplyRequestStatus.cancelled => Icons.block,
  ConfigApplyRequestStatus.failed ||
  ConfigApplyRequestStatus.skippedOffline ||
  ConfigApplyRequestStatus.rejected ||
  ConfigApplyRequestStatus.expired => Icons.error_outline,
};

String _title(ConfigApplyRequest r) {
  if (r.kind == FieldApplyKind.firmware) {
    final to = r.firmwareVersion ?? '-';
    final from = r.fromFirmwareVersion;
    return from == null ? 'Firmware $to' : 'Firmware $from → $to';
  }
  return 'Config';
}

class _RequestRow extends StatelessWidget {
  const _RequestRow({required this.index, required this.request});

  final int index;
  final ConfigApplyRequest request;

  static const _muted = TextStyle(
    fontSize: AppTypography.xs,
    height: AppTypography.xsHeight,
    color: AppColors.mutedForeground,
    fontFeatures: [FontFeature.tabularFigures()],
  );

  @override
  Widget build(BuildContext context) {
    final at = request.requestedAt.toLocal();
    final attempts = request.attemptCount;
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // บรรทัดแรก: สิ่งที่ขอ + เวลา (วันที่อยู่ที่หัวกลุ่มแล้ว)
              Row(
                children: [
                  Expanded(
                    child: Text(
                      _title(request),
                      key: Key('request_history_title_$index'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text('${_two(at.hour)}:${_two(at.minute)}', style: _muted),
                ],
              ),
              const SizedBox(height: 6),
              // บรรทัดสอง: ผล (ไอคอน + ป้าย) จำนวนรอบ และแก้ค่าเฉพาะเครื่อง
              Row(
                children: [
                  Icon(
                    _statusIcon(request.status),
                    size: 16,
                    color: AppColors.mutedForeground,
                  ),
                  const SizedBox(width: 4),
                  Flexible(
                    child: AppBadge(
                      label: configApplyRequestStatusLabel(
                        request.status,
                        kind: request.kind,
                      ),
                      tone: configApplyRequestTone(request.status),
                    ),
                  ),
                  if (attempts > 1) ...[
                    const SizedBox(width: 6),
                    AppBadge(label: '$attempts รอบ', tone: AppBadgeTone.info),
                  ],
                  if (request.override != null) ...[
                    const SizedBox(width: 6),
                    const Flexible(
                      child: AppBadge(
                        label: 'แก้ค่าเฉพาะเครื่อง',
                        tone: AppBadgeTone.neutral,
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: 4),
        const Icon(Icons.chevron_right, color: AppColors.mutedForeground),
      ],
    );
  }
}
