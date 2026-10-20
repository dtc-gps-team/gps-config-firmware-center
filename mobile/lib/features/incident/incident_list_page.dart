import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/router/app_router.dart';
import '../../core/router/app_shell.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_empty_state.dart';
import '../../core/ui/app_page_header.dart';
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
class IncidentListPage extends ConsumerWidget {
  const IncidentListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final incidentsAsync = ref.watch(incidentListProvider);
    final navigator = Navigator.of(context);

    return AppV2Theme(
      child: Scaffold(
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppPageHeader(
                title: 'Incidents',
                onBack: navigator.canPop() ? navigator.pop : null,
                trailing: const AccountButton(),
                // ST/OT แจ้งปัญหาหน้างาน (docs/22 §7.2) — role อื่นซ่อนปุ่ม (ไม่ใช่
                // disable) เพราะไม่มีสิทธิ์ `POST /incidents` แบบ field report
                actions: [
                  AppPageHeaderAction(
                    key: const Key('incidents_field_report'),
                    label: 'Field Report',
                    icon: Icons.add,
                    primary: true,
                    visible: isFieldStaff(
                      ref.watch(authControllerProvider.select((s) => s.role)),
                    ),
                    onPressed: () => context.push(AppRoutes.incidentReport),
                  ),
                ],
              ),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () => ref.refresh(incidentListProvider.future),
                  child: incidentsAsync.when(
                    skipLoadingOnRefresh: true,
                    data: (incidents) {
                      if (incidents.isEmpty) return const _IncidentsEmpty();
                      return ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                        itemCount: incidents.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 12),
                        itemBuilder: (context, i) => _IncidentCard(
                          key: Key('incident_card_$i'),
                          incident: incidents[i],
                          index: i,
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

class _IncidentCard extends StatelessWidget {
  const _IncidentCard({super.key, required this.incident, required this.index});

  final Incident incident;
  final int index;

  @override
  Widget build(BuildContext context) {
    final description = incident.description;
    final source = IncidentStyle.sourceLabel(incident.source);
    return AppCard(
      onTap: () => context.push(AppRoutes.incidentDetail(incident.id)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            incident.title,
            style: const TextStyle(
              fontSize: AppTypography.base,
              height: AppTypography.baseHeight,
              fontWeight: FontWeight.w600,
              color: AppColors.foreground,
            ),
          ),
          if (description != null && description.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              description,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: AppTypography.sm,
                height: AppTypography.smHeight,
                color: AppColors.mutedForeground,
              ),
            ),
          ],
          if (incident.deviceId != null || source != null) ...[
            const SizedBox(height: 4),
            Wrap(
              spacing: 12,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (incident.deviceId != null)
                  // แยก tap target ของตัวเองออกจากการ์ด — แตะเลขอุปกรณ์ไป Device
                  // Detail ไม่ใช่ Incident Detail · padding บนล่างให้พื้นที่กดสูงขึ้น
                  // (docs/21 #18 — เดิมสูงเท่าตัวอักษร กดพลาดไปโดนการ์ดบ่อย)
                  InkWell(
                    onTap: () => context.push(
                      AppRoutes.deviceDetail(incident.deviceId!),
                    ),
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 10),
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
                if (source != null)
                  Text(
                    source,
                    style: const TextStyle(
                      fontSize: AppTypography.xs,
                      height: AppTypography.xsHeight,
                      color: AppColors.mutedForeground,
                    ),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
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
            ],
          ),
          const SizedBox(height: 8),
          Text(
            formatIncidentDate(incident.createdAt),
            style: const TextStyle(
              fontSize: AppTypography.xs,
              height: AppTypography.xsHeight,
              color: AppColors.mutedForeground,
            ),
          ),
        ],
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
      children: const [
        AppEmptyState(
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
