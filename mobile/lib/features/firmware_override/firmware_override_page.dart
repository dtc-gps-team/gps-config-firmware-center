import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_field_label.dart';
import '../../core/ui/app_notice.dart';
import '../../core/ui/app_page_header.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/widgets/app_error_view.dart';
import '../device_search/device_header_meta.dart';
import '../device_search/device_search_repository.dart';
import '../device_search/device_status_repository.dart';
import 'firmware_override_repository.dart';
import 'pending_firmware_override_banner.dart';

/// Firmware Override — Phase 2 (Mobile, issue #256, PR #257). เข้าได้เฉพาะ
/// role ST (เช็คที่ entry point ใน `device_detail_page.dart`) — ให้ ST
/// **ส่งคำขอ**ให้อุปกรณ์เครื่องนี้เครื่องเดียวติดตั้ง Firmware ตัวที่เลือกได้
/// แม้ไม่ตรงกับแผน Campaign ที่กำหนดไว้ (`POST /devices/{deviceId}/firmware-override`)
///
/// ทำไมต้องมีหน้านี้: เมื่อ #257 merge `confirm-firmware-install` จะตอบ 409
/// ถ้า Firmware ไม่ตรงกับ Campaign Rollout ที่ active และไม่มี override ที่
/// approved (และยังไม่ถูกใช้) — ช่างต้องมีทางขอ override ได้จากแอป ไม่ใช่เจอ
/// error แล้วติดตัน · ต้องผ่าน Operation อนุมัติ และใช้ได้ครั้งเดียว
///
/// ง่ายกว่า `config_override_page.dart`: Firmware เป็นเวอร์ชันเดียวทั้งก้อน
/// จึงมีแค่ เลือก Firmware → กรอกเหตุผล (บังคับ ≤500) → ส่ง · ไม่มี endpoint
/// ให้ ST อ่านคำขอของตัวเอง จึงไม่มี pending banner — กรณีมีคำขอรออยู่แล้ว
/// backend ตอบ 409 พร้อมข้อความ แสดงตรงๆ พร้อมคำอธิบายใต้กล่อง error
///
/// design system ใหม่ (docs/22 Batch 4): หัวหน้าจอ "Firmware Override" ตาม Web
/// (§6.2) + เครื่อง/รุ่นใน meta · คำอธิบายเป็น description · กล่องแจ้งผล / error
/// เป็น `AppNotice` · ตรรกะ/การเรียก API เหมือนเดิม
class FirmwareOverridePage extends ConsumerStatefulWidget {
  const FirmwareOverridePage({super.key, required this.deviceId});

  final String deviceId;

  @override
  ConsumerState<FirmwareOverridePage> createState() =>
      _FirmwareOverridePageState();
}

class _FirmwareOverridePageState extends ConsumerState<FirmwareOverridePage> {
  final _reasonController = TextEditingController();
  String? _selectedFirmwareId;
  bool _submitting = false;
  bool _submitted = false;
  String? _error;
  int? _errorStatus;
  List<String> _errorList = const [];

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting || _submitted) return;
    setState(() {
      _error = null;
      _errorStatus = null;
      _errorList = const [];
    });

    final firmwareId = _selectedFirmwareId;
    if (firmwareId == null) {
      setState(() => _error = 'เลือก Firmware ก่อน');
      return;
    }
    final reason = _reasonController.text.trim();
    if (reason.isEmpty) {
      setState(() => _error = 'กรอกเหตุผลก่อนส่งคำขอ');
      return;
    }

    setState(() => _submitting = true);
    try {
      await ref
          .read(firmwareOverrideRepositoryProvider)
          .overrideFirmware(
            deviceId: widget.deviceId,
            firmwareId: firmwareId,
            reason: reason,
          );
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _submitted = true;
      });
      // รีเฟรชสถานะอุปกรณ์ให้ banner "รออนุมัติ" ขึ้นทั้งหน้านี้และ Device Detail
      ref.invalidate(deviceStatusProvider(widget.deviceId));
      // ส่งคำขอสำเร็จเท่านั้น ยังไม่มีผล — ต้องรอ Operation อนุมัติ แล้วจึง
      // ยืนยันติดตั้ง Firmware ได้ (ใช้ได้ครั้งเดียว)
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('ส่งคำขอแล้ว รอ Operation อนุมัติ')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = e.message;
        _errorStatus = e.statusCode;
        _errorList = e.details;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final deviceAsync = ref.watch(deviceDetailProvider(widget.deviceId));
    final firmwareAsync = ref.watch(firmwareListProvider);
    // โหลดสถานะไม่สำเร็จไม่ block ฟอร์ม — แค่ไม่มี banner (ถ้ามี pending อยู่
    // จริง backend ยังตอบ 409 ตอนส่ง)
    final pending = ref
        .watch(deviceStatusProvider(widget.deviceId))
        .valueOrNull
        ?.pendingFirmwareOverride;
    final navigator = Navigator.of(context);
    final device = deviceAsync.valueOrNull;

    return AppV2Theme(
      child: Scaffold(
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppPageHeader(
                title: 'Firmware Override',
                onBack: navigator.canPop() ? navigator.pop : null,
                description:
                    'ใช้เมื่อ Firmware ที่ต้องการติดตั้งไม่ตรงกับแผน Campaign ที่กำหนดไว้ '
                    'ต้องรอ Operation อนุมัติก่อน แล้วจึงยืนยันติดตั้งได้ · ใช้ได้ครั้งเดียว '
                    '(ติดตั้งซ้ำต้องขอใหม่) · ต้องระบุเหตุผลและถูกบันทึกลง Audit Log',
                meta: deviceHeaderMeta(device),
              ),
              Expanded(
                child: deviceAsync.when(
                  loading: () => const AppDetailSkeleton(
                    padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                  ),
                  error: (error, _) => AppErrorView(
                    message: error is ApiException
                        ? error.message
                        : 'โหลดข้อมูลอุปกรณ์ไม่สำเร็จ',
                    messageKey: const Key('firmware_override_load_error'),
                    retryKey: const Key('firmware_override_load_retry'),
                    onRetry: () {
                      ref.invalidate(deviceDetailProvider(widget.deviceId));
                      ref.invalidate(firmwareListProvider);
                    },
                  ),
                  data: (device) => firmwareAsync.when(
                    loading: () => const AppDetailSkeleton(
                      padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                    ),
                    error: (error, _) => AppErrorView(
                      message: error is ApiException
                          ? error.message
                          : 'โหลดรายการ Firmware ไม่สำเร็จ',
                      messageKey: const Key('firmware_override_load_error'),
                      retryKey: const Key('firmware_override_load_retry'),
                      onRetry: () => ref.invalidate(firmwareListProvider),
                    ),
                    data: (all) => _buildForm(device, all, pending),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildForm(
    Device device,
    List<Firmware> all,
    DeviceFirmwareOverride? pending,
  ) {
    // แสดงเฉพาะตัวที่ backend ยอมรับ (stored + approved + รองรับรุ่นเครื่องนี้)
    // — ตัวอื่นขอไปก็ได้ 409 อยู่ดี
    final options = all
        .where((f) => f.isInstallableOn(device.deviceModel))
        .toList(growable: false);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
      children: [
        if (pending != null) ...[
          PendingFirmwareOverrideBanner(pending: pending),
          const SizedBox(height: 16),
        ],
        const AppFieldLabel('Firmware ที่ต้องการติดตั้ง'),
        if (options.isEmpty)
          const AppNotice(
            key: Key('firmware_override_no_options'),
            tone: AppBadgeTone.neutral,
            child: Text(
              'ยังไม่มี Firmware ที่ติดตั้งได้กับรุ่นนี้ (ต้องอัปโหลดสำเร็จ + '
              'ผ่านการอนุมัติคุณภาพ + รองรับรุ่นอุปกรณ์) — แจ้ง Firmware Engineer',
            ),
          )
        else
          DropdownButtonFormField<String>(
            key: const Key('firmware_override_select'),
            initialValue: _selectedFirmwareId,
            isExpanded: true,
            hint: const Text('เลือก Firmware'),
            decoration: const InputDecoration(
              filled: true,
              fillColor: AppColors.card,
            ),
            items: [
              for (final f in options)
                DropdownMenuItem(
                  value: f.id,
                  child: Text(
                    f.originalFilename.isEmpty
                        ? 'v${f.version}'
                        : 'v${f.version} · ${f.originalFilename}',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: _submitted
                ? null
                : (v) => setState(() => _selectedFirmwareId = v),
          ),
        const SizedBox(height: 20),
        const AppFieldLabel('เหตุผล', hint: '(บังคับ)'),
        TextField(
          key: const Key('firmware_override_reason_input'),
          controller: _reasonController,
          enabled: !_submitted,
          maxLength: 500,
          decoration: const InputDecoration(
            hintText: 'เช่น ลูกค้าขอใช้ Firmware รุ่นนี้ / แก้ปัญหาหน้างาน',
            filled: true,
            fillColor: AppColors.card,
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          AppNotice(
            key: const Key('firmware_override_error'),
            tone: AppBadgeTone.danger,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AppErrorDetails(message: _error!, details: _errorList),
                if (_errorStatus == 409) ...[
                  const SizedBox(height: 8),
                  const Text(
                    'ถ้ามีคำขอรออยู่แล้ว ให้รอ Operation อนุมัติ/ปฏิเสธก่อน '
                    'จึงส่งคำขอใหม่ได้ · ถ้า Firmware ยังติดตั้งไม่ได้ ให้เลือกตัวอื่น '
                    'หรือแจ้ง Firmware Engineer',
                    key: Key('firmware_override_conflict_hint'),
                    style: TextStyle(
                      fontSize: AppTypography.xs,
                      height: AppTypography.xsHeight,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
        if (_submitted) ...[
          const SizedBox(height: 8),
          const AppNotice(
            key: Key('firmware_override_submitted'),
            tone: AppBadgeTone.success,
            icon: Icons.check_circle_outline,
            child: Text(
              'ส่งคำขอแล้ว — รอ Operation อนุมัติ (จะมีแจ้งเตือนเมื่อมีผล) '
              'แล้วจึงยืนยันติดตั้ง Firmware นี้ได้',
            ),
          ),
        ],
        const SizedBox(height: 16),
        FilledButton(
          key: const Key('firmware_override_submit'),
          onPressed:
              (_submitting || _submitted || options.isEmpty || pending != null)
              ? null
              : _submit,
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
              : const Text('ส่งคำขอ Override'),
        ),
      ],
    );
  }
}
