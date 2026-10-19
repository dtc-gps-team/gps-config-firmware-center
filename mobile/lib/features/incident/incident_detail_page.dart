import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_info_row.dart';
import '../../core/ui/app_page_header.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/ui/labels.dart';
import '../../core/ui/status_tones.dart';
import '../../core/widgets/app_error_view.dart';
import 'incident_repository.dart';
import 'incident_ui.dart';

/// "รายละเอียด Incident" — one incident from `GET /incidents/{id}`, opened by
/// tapping a card on the list. Read-only (field staff have no Create/Update
/// permission — RBAC_Matrix.md "Incident & Rollback"). Related Config/Firmware
/// ids are shown as selectable text: Mobile has no Config/Firmware screen to
/// link to.
///
/// design system ใหม่ (docs/22 Batch 2): ป้าย severity / status ย้ายขึ้น
/// `AppPageHeader` (หลังโหลดเสร็จ) · แถวข้อมูลเป็น `AppInfoRow` · ตรรกะ/การเรียก
/// API เหมือนเดิม
class IncidentDetailPage extends ConsumerWidget {
  const IncidentDetailPage({super.key, required this.incidentId});

  final String incidentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final incidentAsync = ref.watch(incidentDetailProvider(incidentId));
    final navigator = Navigator.of(context);
    final incident = incidentAsync.valueOrNull;

    return AppV2Theme(
      child: Scaffold(
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppPageHeader(
                title: 'รายละเอียด Incident',
                onBack: navigator.canPop() ? navigator.pop : null,
                status: incident == null
                    ? null
                    : Wrap(
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
              ),
              Expanded(
                child: incidentAsync.when(
                  skipLoadingOnRefresh: true,
                  data: (incident) => _IncidentDetailView(incident: incident),
                  loading: () => const AppDetailSkeleton(
                    padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                  ),
                  error: (error, _) => ListView(
                    children: [
                      const SizedBox(height: 64),
                      AppErrorView(
                        message: _errorMessage(error),
                        onRetry: () =>
                            ref.invalidate(incidentDetailProvider(incidentId)),
                        messageKey: const Key('incident_detail_error'),
                        retryKey: const Key('incident_detail_retry'),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _errorMessage(Object error) {
    if (error is ApiException) {
      return error.statusCode == 404 ? 'ไม่พบ Incident นี้' : error.message;
    }
    return 'โหลดรายละเอียด Incident ไม่สำเร็จ';
  }
}

class _IncidentDetailView extends StatelessWidget {
  const _IncidentDetailView({required this.incident});

  final Incident incident;

  @override
  Widget build(BuildContext context) {
    final description = incident.description;
    final metadata = incident.metadata;
    final reviewedAt = incident.reviewedAt;
    final reviewNote = incident.reviewNote;
    final hasReview =
        incident.reviewedBy != null ||
        reviewedAt != null ||
        (reviewNote != null && reviewNote.isNotEmpty);
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      children: [
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                incident.title,
                key: const Key('incident_detail_title'),
                style: const TextStyle(
                  fontSize: AppTypography.base,
                  height: AppTypography.baseHeight,
                  fontWeight: FontWeight.w600,
                  color: AppColors.foreground,
                ),
              ),
              const SizedBox(height: 12),
              const _SectionLabel('รายละเอียด'),
              Text(
                description == null || description.isEmpty
                    ? 'ไม่มีรายละเอียด'
                    : description,
                key: const Key('incident_detail_description'),
                style: const TextStyle(
                  fontSize: AppTypography.sm,
                  height: AppTypography.smHeight,
                  color: AppColors.foreground,
                ),
              ),
              const SizedBox(height: 8),
              const Divider(),
              AppInfoRow(
                label: 'แหล่งที่มา',
                valueKey: const Key('incident_detail_source'),
                value: incident.source,
              ),
              _DeviceRow(deviceId: incident.deviceId),
              AppInfoRow(
                label: 'ผู้แจ้ง',
                valueKey: const Key('incident_detail_reported_by'),
                value: incident.reportedBy,
                selectable: true,
              ),
              AppInfoRow(
                label: 'Config ที่เกี่ยวข้อง',
                valueKey: const Key('incident_detail_config'),
                value: incident.relatedConfigId,
                selectable: true,
              ),
              AppInfoRow(
                label: 'Firmware ที่เกี่ยวข้อง',
                valueKey: const Key('incident_detail_firmware'),
                value: incident.relatedFirmwareId,
                selectable: true,
              ),
              AppInfoRow(
                label: 'สร้างเมื่อ',
                value: formatIncidentDate(incident.createdAt),
              ),
              AppInfoRow(
                label: 'อัปเดตล่าสุด',
                value: formatIncidentDate(incident.updatedAt),
              ),
            ],
          ),
        ),
        // ผลการตรวจสอบของ Operation (`POST /incidents/{id}/decide`) — แสดงเมื่อ
        // มีข้อมูลตรวจสอบอย่างน้อยหนึ่งตัว incident ที่ยังไม่ถูกตัดสินใจไม่มี
        // section นี้เลย (ไม่ใช่การ์ดว่างที่เต็มไปด้วย "-")
        if (hasReview) ...[
          const SizedBox(height: 12),
          AppCard(
            key: const Key('incident_detail_review'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const _CardTitle('ผลการตรวจสอบ'),
                AppInfoRow(
                  label: 'ผู้ตรวจสอบ',
                  valueKey: const Key('incident_detail_reviewed_by'),
                  value: incident.reviewedBy,
                  selectable: true,
                ),
                AppInfoRow(
                  label: 'ตรวจสอบเมื่อ',
                  valueKey: const Key('incident_detail_reviewed_at'),
                  value: reviewedAt == null
                      ? null
                      : formatIncidentDate(reviewedAt),
                ),
                AppInfoRow(
                  label: 'หมายเหตุ',
                  valueKey: const Key('incident_detail_review_note'),
                  value: incident.reviewNote,
                ),
              ],
            ),
          ),
        ],
        if (metadata != null && metadata.isNotEmpty) ...[
          const SizedBox(height: 12),
          AppCard(
            key: const Key('incident_detail_metadata'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const _CardTitle('ข้อมูลเพิ่มเติม'),
                for (final entry in metadata.entries)
                  AppInfoRow(
                    label: entry.key,
                    value: entry.value is String
                        ? entry.value as String
                        : jsonEncode(entry.value),
                    selectable: true,
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

/// อุปกรณ์ที่ report ผูกไว้ — แตะแล้วไปหน้า Device Detail ของเครื่องนั้น
/// ไม่มี deviceId (incident อัตโนมัติ) แสดง "-" แบบแถวอื่น
class _DeviceRow extends StatelessWidget {
  const _DeviceRow({required this.deviceId});

  final String? deviceId;

  @override
  Widget build(BuildContext context) {
    final id = deviceId;
    if (id == null || id.isEmpty) {
      return const AppInfoRow(
        label: 'อุปกรณ์',
        valueKey: Key('incident_detail_device'),
        value: null,
      );
    }
    return AppInfoRow(
      label: 'อุปกรณ์',
      child: InkWell(
        onTap: () => context.push(AppRoutes.deviceDetail(id)),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        child: Text(
          id,
          key: const Key('incident_detail_device'),
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
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: AppTypography.xs,
        height: AppTypography.xsHeight,
        color: AppColors.mutedForeground,
      ),
    ),
  );
}

class _CardTitle extends StatelessWidget {
  const _CardTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: AppTypography.sm,
        height: AppTypography.smHeight,
        fontWeight: FontWeight.w600,
        color: AppColors.foreground,
      ),
    ),
  );
}
