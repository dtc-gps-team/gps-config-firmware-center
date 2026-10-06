import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/theme/app_theme.dart';
import '../device_search/device_search_repository.dart';
import 'incident_repository.dart';
import 'incident_ui.dart';

/// Field Incident Report (design issue #236) — ST/OT **แจ้งปัญหาที่เจอหน้างาน**
/// (`POST /incidents`) หัวข้อ + รายละเอียด (บังคับ) + ความรุนแรง + อุปกรณ์
/// (ไม่บังคับ). การแจ้ง**ไม่ auto-pause/rollback ใดๆ** — Operation ตรวจสอบแล้ว
/// ตัดสินใจเองว่าจะปิด/ไม่ใช่ปัญหา/โปรโมทเป็น Campaign (ฝั่ง Web) · ช่างเห็น
/// report ของตัวเองใน "ดู Incident" (backend กรอง `reportedBy` ให้)
///
/// **Scaffolding — backend ยังไม่มี endpoint:** เปิดทางเข้าเฉพาะ
/// `fieldReportEnabledProvider` (ตอนนี้ = `API_MOCK_MODE`) ใช้
/// `MockIncidentRepository` จนกว่า A merge `POST /incidents`
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

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('แจ้งปัญหาหน้างาน'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          const Text(
            'แจ้งปัญหาที่เจอกับอุปกรณ์ให้ Operation ตรวจสอบ — การแจ้งนี้ไม่ได้สั่ง '
            'หยุดหรือ Rollback อัตโนมัติ Operation จะเป็นผู้ตัดสินใจเอง '
            'และแจ้งผลกลับมา',
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
          ),
          const SizedBox(height: 16),
          const Text(
            'หัวข้อปัญหา (บังคับ)',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('field_report_title'),
            controller: _titleController,
            enabled: !_submitted,
            maxLength: 200,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'เช่น อุปกรณ์ไม่ส่งสัญญาณหลังติดตั้ง',
              filled: true,
              fillColor: AppTheme.surface,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'รายละเอียด (บังคับ)',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('field_report_description'),
            controller: _descriptionController,
            enabled: !_submitted,
            minLines: 4,
            maxLines: 8,
            maxLength: 2000,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'เกิดอะไรขึ้น เจอตอนไหน ลองแก้อะไรไปแล้วบ้าง',
              filled: true,
              fillColor: AppTheme.surface,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'ความรุนแรง',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<IncidentSeverity>(
            key: const Key('field_report_severity'),
            initialValue: _severity,
            isExpanded: true,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              filled: true,
              fillColor: AppTheme.surface,
            ),
            items: [
              for (final s in IncidentSeverity.values)
                DropdownMenuItem(
                  value: s,
                  child: Text(IncidentStyle.severityLabel(s)),
                ),
            ],
            onChanged: _submitted
                ? null
                : (v) => setState(() => _severity = v ?? _severity),
          ),
          const SizedBox(height: 12),
          const Text(
            'อุปกรณ์ที่เกี่ยวข้อง (ไม่บังคับ)',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String?>(
            key: const Key('field_report_device'),
            initialValue: selectedDevice,
            isExpanded: true,
            hint: const Text('ไม่ระบุอุปกรณ์'),
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              filled: true,
              fillColor: AppTheme.surface,
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
            onChanged: _submitted ? null : (v) => setState(() => _deviceId = v),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Container(
              key: const Key('field_report_error'),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.error.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: AppTheme.error.withValues(alpha: 0.4),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_error!, style: const TextStyle(color: AppTheme.error)),
                  for (final msg in _errorList)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        '• $msg',
                        style: const TextStyle(
                          color: AppTheme.error,
                          fontSize: 12,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
          if (_submitted) ...[
            const SizedBox(height: 12),
            Container(
              key: const Key('field_report_submitted'),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.mockAccentSoft,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Text(
                'ส่งรายงานแล้ว — Operation จะตรวจสอบและตัดสินใจ ดูสถานะได้ที่ '
                '"ดู Incident"',
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
                      valueColor: AlwaysStoppedAnimation(Colors.white),
                    ),
                  )
                : const Text('ส่งรายงานปัญหา'),
          ),
        ],
      ),
    );
  }
}
