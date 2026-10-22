import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_field_label.dart';
import '../../core/ui/app_notice.dart';
import '../../core/ui/app_page_header.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/ui/labels.dart';
import '../device_search/device_search_repository.dart';
import 'incident_repository.dart';

/// Field Incident Report (design issue #236) — ST/OT **แจ้งปัญหาที่เจอหน้างาน**
/// (`POST /incidents`) หัวข้อ + รายละเอียด (บังคับ) + ความรุนแรง + อุปกรณ์
/// (ไม่บังคับ). การแจ้ง**ไม่ auto-pause/rollback ใดๆ** — Operation ตรวจสอบแล้ว
/// ตัดสินใจเองว่าจะปิด/ไม่ใช่ปัญหา/โปรโมทเป็น Campaign (ฝั่ง Web) · ช่างเห็น
/// report ของตัวเองใน "ดู Incident" (backend กรอง `reportedBy` ให้)
///
/// ทางเข้า: ปุ่ม "Field Report" ในแท็บ Incidents และในหน้า Device Detail (ST/OT
/// เท่านั้น — docs/22 §7.2) · backend `POST /incidents` อยู่บน `main` แล้ว (PR #267)
/// · ใน `API_MOCK_MODE` ใช้ `MockIncidentRepository`
///
/// design system ใหม่ (docs/22 Batch 4): หัวหน้าจอ "Field Report" ตาม Web (§6.2)
/// · ระดับความรุนแรงใช้ label ชุดเดียวกับป้าย (Critical/High/...) · error / ส่งแล้ว
/// เป็น `AppNotice` · ตรรกะ/การเรียก API เหมือนเดิม
class FieldReportPage extends ConsumerStatefulWidget {
  const FieldReportPage({super.key, this.initialDeviceId});

  /// pre-fill อุปกรณ์ (เช่นเปิดจาก Device Detail)
  final String? initialDeviceId;

  @override
  ConsumerState<FieldReportPage> createState() => _FieldReportPageState();
}

class _FieldReportPageState extends ConsumerState<FieldReportPage> {
  final _titleController = TextEditingController();
  final _descriptionController = TextEditingController();
  IncidentSeverity _severity = IncidentSeverity.medium;
  String? _deviceId;
  bool _submitting = false;
  bool _submitted = false;
  String? _error;
  List<String> _errorList = const [];

  @override
  void initState() {
    super.initState();
    _deviceId = widget.initialDeviceId;
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting || _submitted) return;
    final title = _titleController.text.trim();
    final description = _descriptionController.text.trim();
    if (title.isEmpty) {
      setState(() {
        _error = 'กรอกหัวข้อปัญหาก่อน';
        _errorList = const [];
      });
      return;
    }
    if (description.isEmpty) {
      setState(() {
        _error = 'กรอกรายละเอียดปัญหาก่อน';
        _errorList = const [];
      });
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
      _errorList = const [];
    });
    try {
      await ref
          .read(incidentRepositoryProvider)
          .createFieldReport(
            title: title,
            description: description,
            severity: _severity,
            deviceId: _deviceId,
          );
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _submitted = true;
      });
      ref.invalidate(incidentListProvider);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = e.message;
        _errorList = e.details;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    // โหลดรายการอุปกรณ์ไม่ได้ไม่ block ฟอร์ม — อุปกรณ์เป็น optional
    final devices = ref.watch(deviceListProvider).valueOrNull ?? const [];
    final deviceIds = {for (final d in devices) d.deviceId};
    final selectedDevice = (_deviceId != null && deviceIds.contains(_deviceId))
        ? _deviceId
        : null;
    final navigator = Navigator.of(context);

    return AppV2Theme(
      child: Scaffold(
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppPageHeader(
                title: 'Field Report',
                onBack: navigator.canPop() ? navigator.pop : null,
                description:
                    'แจ้งปัญหาที่เจอกับอุปกรณ์ให้ Operation ตรวจสอบ — การแจ้งนี้ไม่ได้สั่ง '
                    'หยุดหรือ Rollback อัตโนมัติ Operation จะเป็นผู้ตัดสินใจเอง '
                    'และแจ้งผลกลับมา',
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                  children: [
                    const AppFieldLabel('หัวข้อปัญหา', hint: '(บังคับ)'),
                    TextField(
                      key: const Key('field_report_title'),
                      controller: _titleController,
                      enabled: !_submitted,
                      maxLength: 200,
                      decoration: const InputDecoration(
                        hintText: 'เช่น อุปกรณ์ไม่ส่งสัญญาณหลังติดตั้ง',
                        filled: true,
                        fillColor: AppColors.card,
                      ),
                    ),
                    const SizedBox(height: 12),
                    const AppFieldLabel('รายละเอียด', hint: '(บังคับ)'),
                    TextField(
                      key: const Key('field_report_description'),
                      controller: _descriptionController,
                      enabled: !_submitted,
                      minLines: 4,
                      maxLines: 8,
                      maxLength: 2000,
                      decoration: const InputDecoration(
                        hintText: 'เกิดอะไรขึ้น เจอตอนไหน ลองแก้อะไรไปแล้วบ้าง',
                        filled: true,
                        fillColor: AppColors.card,
                      ),
                    ),
                    const SizedBox(height: 12),
                    const AppFieldLabel('ความรุนแรง'),
                    DropdownButtonFormField<IncidentSeverity>(
                      key: const Key('field_report_severity'),
                      initialValue: _severity,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        filled: true,
                        fillColor: AppColors.card,
                      ),
                      items: [
                        for (final s in IncidentSeverity.values)
                          DropdownMenuItem(
                            value: s,
                            child: Text(incidentSeverityLabel(s)),
                          ),
                      ],
                      onChanged: _submitted
                          ? null
                          : (v) => setState(() => _severity = v ?? _severity),
                    ),
                    const SizedBox(height: 12),
                    const AppFieldLabel(
                      'อุปกรณ์ที่เกี่ยวข้อง',
                      hint: '(ไม่บังคับ)',
                    ),
                    DropdownButtonFormField<String?>(
                      key: const Key('field_report_device'),
                      initialValue: selectedDevice,
                      isExpanded: true,
                      hint: const Text('ไม่ระบุอุปกรณ์'),
                      decoration: const InputDecoration(
                        filled: true,
                        fillColor: AppColors.card,
                      ),
                      items: [
                        const DropdownMenuItem<String?>(
                          value: null,
                          child: Text('ไม่ระบุอุปกรณ์'),
                        ),
                        for (final d in devices)
                          DropdownMenuItem<String?>(
                            value: d.deviceId,
                            child: Text(
                              d.deviceModel.isEmpty
                                  ? d.deviceId
                                  : '${d.deviceId} · ${d.deviceModel}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                      onChanged: _submitted
                          ? null
                          : (v) => setState(() => _deviceId = v),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      AppNotice(
                        key: const Key('field_report_error'),
                        tone: AppBadgeTone.danger,
                        child: AppErrorDetails(
                          message: _error!,
                          details: _errorList,
                        ),
                      ),
                    ],
                    if (_submitted) ...[
                      const SizedBox(height: 12),
                      const AppNotice(
                        key: Key('field_report_submitted'),
                        tone: AppBadgeTone.success,
                        icon: Icons.check_circle_outline,
                        child: Text(
                          'ส่งรายงานแล้ว — Operation จะตรวจสอบและตัดสินใจ ดูสถานะได้ที่ '
                          'แท็บ Incidents',
                        ),
                      ),
                    ],
                    const SizedBox(height: 16),
                    FilledButton(
                      key: const Key('field_report_submit'),
                      onPressed: (_submitting || _submitted) ? null : _submit,
                      child: _submitting
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor: AlwaysStoppedAnimation(
                                  AppColors.primaryForeground,
                                ),
                              ),
                            )
                          : const Text('ส่งรายงานปัญหา'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
