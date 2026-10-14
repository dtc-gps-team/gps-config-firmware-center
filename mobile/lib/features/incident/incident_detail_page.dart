import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_error_view.dart';
import 'incident_repository.dart';
import 'incident_ui.dart';

/// "รายละเอียด Incident" — one incident from `GET /incidents/{id}`, opened by
/// tapping a card on the list. Read-only (field staff have no Create/Update
/// permission — RBAC_Matrix.md "Incident & Rollback"). Related Config/Firmware
/// ids are shown as selectable text: Mobile has no Config/Firmware screen to
/// link to.
class IncidentDetailPage extends ConsumerWidget {
  const IncidentDetailPage({super.key, required this.incidentId});

  final String incidentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final incidentAsync = ref.watch(incidentDetailProvider(incidentId));

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('รายละเอียด Incident'),
      ),
      body: incidentAsync.when(
        skipLoadingOnRefresh: true,
        data: (incident) => _IncidentDetailView(incident: incident),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => ListView(
          children: [
            const SizedBox(height: 64),
            AppErrorView(
              message: _errorMessage(error),
              onRetry: () => ref.invalidate(incidentDetailProvider(incidentId)),
              messageKey: const Key('incident_detail_error'),
              retryKey: const Key('incident_detail_retry'),
            ),
          ],
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
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppTheme.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.fieldBorder, width: 1),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                incident.title,
                key: const Key('incident_detail_title'),
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.textPrimary,
                ),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  IncidentSeverityPill(severity: incident.severity),
                  IncidentStatusPill(status: incident.status),
                ],
              ),
              const SizedBox(height: 14),
              const _Label('รายละเอียด'),
              Text(
                description == null || description.isEmpty
                    ? 'ไม่มีรายละเอียด'
                    : description,
                key: const Key('incident_detail_description'),
                style: const TextStyle(
                  fontSize: 14,
                  color: AppTheme.textPrimary,
                ),
              ),
              const SizedBox(height: 14),
              _Field(
                label: 'แหล่งที่มา',
                valueKey: const Key('incident_detail_source'),
                value: incident.source,
              ),
              _DeviceField(deviceId: incident.deviceId),
              _Field(
                label: 'ผู้แจ้ง',
                valueKey: const Key('incident_detail_reported_by'),
                value: incident.reportedBy,
                selectable: true,
              ),
              _Field(
                label: 'Config ที่เกี่ยวข้อง',
                valueKey: const Key('incident_detail_config'),
                value: incident.relatedConfigId,
                selectable: true,
              ),
              _Field(
                label: 'Firmware ที่เกี่ยวข้อง',
                valueKey: const Key('incident_detail_firmware'),
                value: incident.relatedFirmwareId,
                selectable: true,
              ),
              _Field(
                label: 'สร้างเมื่อ',
                value: formatIncidentDate(incident.createdAt),
              ),
              _Field(
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
          Container(
            key: const Key('incident_detail_review'),
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppTheme.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.fieldBorder, width: 1),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'ผลการตรวจสอบ',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textPrimary,
                  ),
                ),
                const SizedBox(height: 10),
                _Field(
                  label: 'ผู้ตรวจสอบ',
                  valueKey: const Key('incident_detail_reviewed_by'),
                  value: incident.reviewedBy,
                  selectable: true,
                ),
                _Field(
                  label: 'ตรวจสอบเมื่อ',
                  valueKey: const Key('incident_detail_reviewed_at'),
                  value: reviewedAt == null
                      ? null
                      : formatIncidentDate(reviewedAt),
                ),
                _Field(
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
          Container(
            key: const Key('incident_detail_metadata'),
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppTheme.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.fieldBorder, width: 1),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _Label('ข้อมูลเพิ่มเติม'),
                for (final entry in metadata.entries)
                  _Field(
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
/// ไม่มี deviceId (incident อัตโนมัติ) แสดง "-" แบบ [_Field]
class _DeviceField extends StatelessWidget {
  const _DeviceField({required this.deviceId});

  final String? deviceId;

  @override
  Widget build(BuildContext context) {
    final id = deviceId;
    if (id == null || id.isEmpty) {
      return const _Field(
        label: 'อุปกรณ์',
        valueKey: Key('incident_detail_device'),
        value: null,
      );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _Label('อุปกรณ์'),
          InkWell(
            onTap: () => context.push(AppRoutes.deviceDetail(id)),
            child: Text(
              id,
              key: const Key('incident_detail_device'),
              style: const TextStyle(
                fontSize: 14,
                color: AppTheme.navy,
                fontWeight: FontWeight.w600,
                decoration: TextDecoration.underline,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Text(
      text,
      style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
    ),
  );
}

/// Label + value; a null/empty [value] renders "-" (the backend omits
/// optional fields rather than sending empty strings).
class _Field extends StatelessWidget {
  const _Field({
    required this.label,
    required this.value,
    this.valueKey,
    this.selectable = false,
  });

  final String label;
  final String? value;
  final Key? valueKey;
  final bool selectable;

  @override
  Widget build(BuildContext context) {
    final text = (value == null || value!.isEmpty) ? '-' : value!;
    const style = TextStyle(fontSize: 14, color: AppTheme.textPrimary);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Label(label),
          selectable
              ? SelectableText(text, key: valueKey, style: style)
              : Text(text, key: valueKey, style: style),
        ],
      ),
    );
  }
}
