import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/realtime/live_refresh.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_empty_state.dart';
import '../../core/ui/app_filter_controls.dart';
import '../../core/ui/app_ink_header.dart';
import '../../core/ui/app_fade_in.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/ui/labels.dart';
import '../../core/ui/status_tones.dart';
import '../../core/widgets/app_error_view.dart';
import '../auth/account_sheet.dart';
import 'incident_repository.dart';
import 'incident_ui.dart';

/// "Incidents" — read-only list from `GET /incidents` (every role may read
/// it). Tapping a card opens [IncidentDetailPage]. Opened from the Home
/// shortcut. **No create / edit** — field staff have no
/// Create permission (RBAC_Matrix.md "Incident & Rollback"); the Home label is
/// "ดู Incident" for the same reason.
///
/// design system ใหม่ (docs/22 Batch 2): หัวหน้าจอชื่อ "Incidents" (มติ B ข้อ 10)
/// · ป้าย severity / status เป็น `AppBadge` + dot · ตรรกะ/การเรียก API เหมือนเดิม
///
/// B (04/11/2026): รายการยาวแล้วใช้ยาก จึงเพิ่มช่องค้นหา แท็บสถานะพร้อมจำนวน
/// (เริ่มที่ "ต้องติดตาม" = open/investigating) ตัวกรองแหล่งที่มา หัวข้อตาม
/// ช่วงวันที่ และการ์ดแบบกระชับ · กรองในเครื่องทั้งหมด (`GET /incidents`
/// คืนรายการเดียวอยู่แล้ว ไม่ต้องแก้ backend)
class IncidentListPage extends ConsumerStatefulWidget {
  const IncidentListPage({super.key});

  @override
  ConsumerState<IncidentListPage> createState() => _IncidentListPageState();
}

enum _StatusTab { active, closed, all }

enum _SourceFilter { all, mine, system }

bool _isActive(Incident incident) =>
    incident.status == IncidentStatus.open ||
    incident.status == IncidentStatus.investigating;

class _IncidentListPageState extends ConsumerState<IncidentListPage> {
  final _search = TextEditingController();
  String _query = '';
  _StatusTab _tab = _StatusTab.active;
  _SourceFilter _source = _SourceFilter.all;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  bool _matchesSource(Incident incident) => switch (_source) {
    _SourceFilter.all => true,
    _SourceFilter.mine => incident.isFieldReport,
    _SourceFilter.system => !incident.isFieldReport,
  };

  bool _matchesQuery(Incident incident) {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return true;
    return incident.title.toLowerCase().contains(q) ||
        (incident.deviceId?.toLowerCase().contains(q) ?? false) ||
        (incident.description?.toLowerCase().contains(q) ?? false);
  }

  static bool _matchesTab(Incident incident, _StatusTab tab) => switch (tab) {
    _StatusTab.active => _isActive(incident),
    _StatusTab.closed => !_isActive(incident),
    _StatusTab.all => true,
  };

  @override
  Widget build(BuildContext context) {
    final incidentsAsync = ref.watch(incidentListProvider);
    final navigator = Navigator.of(context);

    return LiveRefresh(
      interval: const Duration(seconds: 30),
      onRefresh: () async {
        await ref.refresh(incidentListProvider.future).then<void>((_) {});
      },
      child: AppV2Theme(
        child: Scaffold(
          body: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppInkHeader(
                title: 'Incidents',
                subtitle: 'Field Report ของคุณ + Incident จากระบบ',
                onBack: navigator.canPop() ? navigator.pop : null,
                trailing: const AccountButton(),
              ),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () => ref.refresh(incidentListProvider.future),
                  child: incidentsAsync.when(
                    skipLoadingOnRefresh: true,
                    skipError: true,
                    data: (incidents) {
                      if (incidents.isEmpty) {
                        return const _IncidentsEmpty();
                      }
                      // จำนวนบนแท็บนับหลังกรองค้นหา/แหล่งที่มาแล้ว ตัวเลข
                      // จึงตรงกับที่จะเห็นเมื่อกดแท็บนั้น
                      final base = incidents
                          .where((i) => _matchesSource(i) && _matchesQuery(i))
                          .toList(growable: false);
                      int count(_StatusTab tab) =>
                          base.where((i) => _matchesTab(i, tab)).length;
                      final visible = base
                          .where((i) => _matchesTab(i, _tab))
                          .toList(growable: false);
                      // แถบค้นหา/กรองเลื่อนไปพร้อมรายการ (ไม่ตรึงไว้) จอเล็ก
                      // + ตัวอักษรใหญ่จึงไม่ล้นจอ และเลื่อนลงแล้วเห็นการ์ดเต็มจอ
                      // · จางเข้าทั้งรายการตอนโหลดเสร็จ (ไม่ใช่ทีละแถว)
                      return AppFadeIn(
                        child: _IncidentSections(
                          visible: visible,
                          all: incidents,
                          header: _IncidentFilterBar(
                            controller: _search,
                            query: _query,
                            onQuery: (v) => setState(() => _query = v),
                            tab: _tab,
                            counts: {
                              for (final t in _StatusTab.values) t: count(t),
                            },
                            onTab: (t) => setState(() => _tab = t),
                            source: _source,
                            onSource: (s) => setState(() => _source = s),
                          ),
                          noMatch: _NoMatch(
                            closedCount: _tab == _StatusTab.active
                                ? count(_StatusTab.closed)
                                : 0,
                            onShowClosed: () =>
                                setState(() => _tab = _StatusTab.closed),
                          ),
                        ),
                      );
                    },
                    loading: () => const AppListSkeleton(
                      padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                    ),
                    error: (error, _) => _IncidentsError(
                      message: error is ApiException
                          ? error.message
                          : 'โหลดรายการ Incident ไม่สำเร็จ',
                      onRetry: () => ref.invalidate(incidentListProvider),
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

class _IncidentFilterBar extends StatelessWidget {
  const _IncidentFilterBar({
    required this.controller,
    required this.query,
    required this.onQuery,
    required this.tab,
    required this.counts,
    required this.onTab,
    required this.source,
    required this.onSource,
  });

  final TextEditingController controller;
  final String query;
  final ValueChanged<String> onQuery;
  final _StatusTab tab;
  final Map<_StatusTab, int> counts;
  final ValueChanged<_StatusTab> onTab;
  final _SourceFilter source;
  final ValueChanged<_SourceFilter> onSource;

  static const _tabLabels = {
    _StatusTab.active: 'ต้องติดตาม',
    _StatusTab.closed: 'ปิดแล้ว',
    _StatusTab.all: 'ทั้งหมด',
  };

  @override
  Widget build(BuildContext context) {
    final search = TextField(
      key: const Key('incidents_search'),
      controller: controller,
      onChanged: onQuery,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: 'ค้นหาด้วยหัวข้อ หรือ device_id',
        isDense: true,
        filled: true,
        fillColor: AppColors.card,
        prefixIcon: const Icon(Icons.search, size: 20),
        suffixIcon: query.isEmpty
            ? null
            : IconButton(
                key: const Key('incidents_search_clear'),
                tooltip: 'ล้างคำค้น',
                icon: const Icon(Icons.close, size: 20),
                onPressed: () {
                  controller.clear();
                  onQuery('');
                },
              ),
      ),
    );
    final sourceMenu = AppFilterMenu<_SourceFilter>(
      key: const Key('incidents_source_menu'),
      placeholder: 'แหล่งที่มา',
      allLabel: 'ทุกแหล่ง',
      allKey: const Key('incidents_source_all'),
      tooltip: 'เลือกแหล่งที่มา',
      selected: source == _SourceFilter.all ? null : source,
      onChanged: (s) => onSource(s ?? _SourceFilter.all),
      options: const [
        AppFilterOption(
          value: _SourceFilter.mine,
          label: 'ที่คุณแจ้ง',
          key: Key('incidents_source_mine'),
        ),
        AppFilterOption(
          value: _SourceFilter.system,
          label: 'จากระบบ',
          key: Key('incidents_source_system'),
        ),
      ],
    );
    // ตัวอักษรใหญ่ (จอ 360px / 2x) ช่องค้นหากับปุ่มแหล่งที่มาวางคู่กันไม่พอ
    final stacked = MediaQuery.textScalerOf(context).scale(10) > 14;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // B (04/11/2026): ชิป 5 อันปนกัน 2 แบบใช้ยาก → แถวบน = ค้นหา +
          // ปุ่มเมนูแหล่งที่มา · แถวล่าง = สวิตช์สถานะเต็มความกว้าง (3 ช่อง
          // วางคู่ปุ่มเมนูแล้วแคบจนชื่อถูกตัด)
          if (stacked) ...[
            search,
            const SizedBox(height: 8),
            Align(alignment: Alignment.centerLeft, child: sourceMenu),
          ] else
            Row(
              children: [
                Expanded(flex: 3, child: search),
                const SizedBox(width: 8),
                Flexible(flex: 2, child: sourceMenu),
              ],
            ),
          const SizedBox(height: 8),
          AppSegmentedToggle<_StatusTab>(
            selected: tab,
            onChanged: onTab,
            options: [
              for (final t in _StatusTab.values)
                AppFilterOption(
                  value: t,
                  label: '${_tabLabels[t]} ${counts[t] ?? 0}',
                  key: Key('incidents_tab_${t.name}'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// หัวข้อช่วงเวลาของ `createdAt` (เวลาเครื่อง) · `GET /incidents` เรียง
/// ใหม่ไปเก่าอยู่แล้ว หัวข้อจึงต่อเนื่องไม่สลับไปมา
String _dateBucket(DateTime createdAt, DateTime now) {
  final d = createdAt.toLocal();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(d.year, d.month, d.day);
  final diff = today.difference(day).inDays;
  if (diff <= 0) return 'วันนี้';
  if (diff == 1) return 'เมื่อวาน';
  if (diff < 7) return '7 วันที่ผ่านมา';
  if (diff < 30) return '30 วันที่ผ่านมา';
  return 'เก่ากว่านั้น';
}

class _IncidentSections extends StatelessWidget {
  const _IncidentSections({
    required this.visible,
    required this.all,
    required this.header,
    required this.noMatch,
  });

  final List<Incident> visible;

  /// รายการเต็มจาก API ใช้หา index เดิมให้ key `incident_card_N` คงที่
  /// ไม่ว่าจะกรองอย่างไร
  final List<Incident> all;

  /// แถบค้นหา/กรอง เป็นแถวแรกของรายการ
  final Widget header;

  /// แสดงแทนรายการเมื่อกรองแล้วไม่เหลืออะไร
  final Widget noMatch;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    // Widget = แถบกรอง/ไม่พบ, String = หัวข้อ, Incident = การ์ด
    final rows = <Object>[header, if (visible.isEmpty) noMatch];
    String? last;
    for (final incident in visible) {
      final bucket = _dateBucket(incident.createdAt, now);
      if (bucket != last) {
        rows.add(bucket);
        last = bucket;
      }
      rows.add(incident);
    }
    // builder สร้างเฉพาะแถวที่อยู่บนจอ รายการหลายร้อยก็ไม่หน่วง
    return ListView.builder(
      key: const Key('incidents_list'),
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: 24),
      itemCount: rows.length,
      itemBuilder: (context, i) {
        final row = rows[i];
        if (row is Widget) return row;
        if (row is String) return _IncidentGroupTitle(row);
        final incident = row as Incident;
        final index = all.indexOf(incident);
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: _IncidentCard(
            key: Key('incident_card_$index'),
            incident: incident,
            index: index,
          ),
        );
      },
    );
  }
}

class _NoMatch extends StatelessWidget {
  const _NoMatch({required this.closedCount, required this.onShowClosed});

  final int closedCount;
  final VoidCallback onShowClosed;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const AppEmptyState(
          icon: Icons.search_off,
          message: 'ไม่พบ Incident ตามที่เลือก',
          messageKey: Key('incidents_no_match'),
        ),
        if (closedCount > 0)
          Center(
            child: TextButton(
              key: const Key('incidents_show_closed'),
              onPressed: onShowClosed,
              child: Text('ดูที่ปิดแล้ว ($closedCount)'),
            ),
          ),
      ],
    );
  }
}

class _IncidentGroupTitle extends StatelessWidget {
  const _IncidentGroupTitle(this.title);

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

/// การ์ดกระชับ 3 แถว: หัวข้อ + เวลา · คำอธิบาย 1 บรรทัด · ป้าย + เครื่อง/แหล่ง
/// · แถบสีด้านซ้ายตามความรุนแรง ให้กวาดตาหาตัวสำคัญได้โดยไม่ต้องอ่านป้าย
class _IncidentCard extends StatelessWidget {
  const _IncidentCard({super.key, required this.incident, required this.index});

  final Incident incident;
  final int index;

  static const _muted = TextStyle(
    fontSize: AppTypography.xs,
    height: AppTypography.xsHeight,
    color: AppColors.mutedForeground,
  );

  @override
  Widget build(BuildContext context) {
    final description = incident.description;
    final source = IncidentStyle.sourceLabel(incident.source);
    return AppCard(
      onTap: () => context.push(AppRoutes.incidentDetail(incident.id)),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              key: Key('incident_card_strip_$index'),
              width: 4,
              decoration: BoxDecoration(
                color: incidentSeverityTone(incident.severity).style.dot,
                borderRadius: BorderRadius.circular(2),
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
                          incident.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: AppTypography.base,
                            height: AppTypography.baseHeight,
                            fontWeight: FontWeight.w600,
                            color: AppColors.foreground,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Padding(
                        padding: const EdgeInsets.only(top: 3),
                        child: Text(
                          formatIncidentDate(incident.createdAt),
                          style: _muted,
                        ),
                      ),
                    ],
                  ),
                  if (description != null && description.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      description,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: AppTypography.sm,
                        height: AppTypography.smHeight,
                        color: AppColors.mutedForeground,
                      ),
                    ),
                  ],
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    runSpacing: 2,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      AppBadge(
                        label: incidentSeverityLabel(incident.severity),
                        tone: incidentSeverityTone(incident.severity),
                        dot: true,
                      ),
                      AppBadge(
                        label: incidentStatusLabel(incident.status),
                        tone: incidentStatusTone(incident.status),
                        dot: true,
                      ),
                      if (incident.deviceId != null)
                        // แยก tap target ของตัวเองออกจากการ์ด แตะเลขอุปกรณ์
                        // ไป Device Detail ไม่ใช่ Incident Detail · padding
                        // บนล่างให้พื้นที่กดสูงขึ้น (docs/21 #18)
                        InkWell(
                          onTap: () => context.push(
                            AppRoutes.deviceDetail(incident.deviceId!),
                          ),
                          borderRadius: BorderRadius.circular(AppRadius.sm),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              vertical: 10,
                              horizontal: 2,
                            ),
                            child: Text(
                              incident.deviceId!,
                              key: Key('incident_card_device_$index'),
                              style: const TextStyle(
                                fontSize: AppTypography.sm,
                                height: AppTypography.smHeight,
                                color: AppColors.primary,
                                fontWeight: FontWeight.w600,
                                decoration: TextDecoration.underline,
                                decorationColor: AppColors.primary,
                              ),
                            ),
                          ),
                        ),
                      if (source != null) Text(source, style: _muted),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _IncidentsEmpty extends StatelessWidget {
  const _IncidentsEmpty();

  @override
  Widget build(BuildContext context) {
    // อยู่ใน ListView ให้ดึงลงเพื่อรีเฟรชได้เหมือนเดิม
    return ListView(
      children: [
        const AppEmptyState(
          icon: Icons.check_circle_outline,
          message: 'ยังไม่มี Incident',
          messageKey: Key('incidents_empty'),
        ),
      ],
    );
  }
}

class _IncidentsError extends StatelessWidget {
  const _IncidentsError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 64),
        AppErrorView(
          message: message,
          onRetry: onRetry,
          messageKey: const Key('incidents_error'),
          retryKey: const Key('incidents_retry'),
        ),
      ],
    );
  }
}
