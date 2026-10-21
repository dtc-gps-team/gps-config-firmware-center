import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/router/app_router.dart';
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
import '../firmware_override/firmware_override_repository.dart';
import 'confirm_firmware_install_repository.dart';

String _formatDateTime(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

/// "ยืนยันติดตั้ง Firmware" (issue #261 + #265) — ST/OT เลือก Firmware ที่
/// ติดตั้งเข้าอุปกรณ์เครื่องนี้แล้ว กดยืนยัน → `POST
/// /devices/{deviceId}/confirm-firmware-install` (แค่บันทึก AuditLog ไม่ได้ส่ง
/// อะไรไปที่เครื่อง)
///
/// - รายการ Firmware = `GET /firmware` กรองด้วย `Firmware.isInstallableOn`
///   (stored + approved + รองรับรุ่นเครื่องนี้) เหมือนหน้า Firmware Override
/// - `rolloutId` (#265): อ่าน `DeviceStatus.firmwareRolloutId` ล่าสุดก่อนส่งทุก
///   ครั้ง ส่งเฉพาะตอน `firmwareStatus` เป็น `pending` และมีค่า — โหลดสถานะไม่
///   สำเร็จไม่ block การยืนยัน (แค่ไม่ส่ง rolloutId = backend ใช้วิธี match เดิม)
/// - 409 gate (Firmware ไม่ตรงแผน Campaign / override ถูกใช้ไปแล้ว): แสดง
///   ข้อความ + ปุ่มไปหน้า Firmware Override **เฉพาะ ST** (OT ไม่มีสิทธิ์ขอ
///   override จึงเห็นแค่ข้อความ)
///
/// design system ใหม่ (docs/22 Batch 4): หัวหน้าจอคงไทย "ยืนยันติดตั้ง Firmware"
/// (ไม่มีคู่เทียบใน Web §6.2) + เลขเครื่อง/รุ่นใน meta · กล่อง error / ผลสำเร็จเป็น
/// `AppNotice` · ปุ่มไปหน้าขอ override ชื่อ "Firmware Override" ตามชื่อหน้า · ตรรกะ/
/// การเรียก API เหมือนเดิม
class ConfirmFirmwareInstallPage extends ConsumerStatefulWidget {
  const ConfirmFirmwareInstallPage({super.key, required this.deviceId});

  final String deviceId;

  @override
  ConsumerState<ConfirmFirmwareInstallPage> createState() =>
      _ConfirmFirmwareInstallPageState();
}

class _ConfirmFirmwareInstallPageState
    extends ConsumerState<ConfirmFirmwareInstallPage> {
  String? _selectedFirmwareId;
  bool _submitting = false;
  ConfirmFirmwareInstallResult? _result;
  String? _error;
  bool _gateConflict = false;

  /// `firmwareRolloutId` ล่าสุด — เฉพาะตอน `firmwareStatus` เป็น `pending`
  /// (backend ส่งค่านี้เฉพาะตอน pending อยู่แล้ว เช็คซ้ำกันไว้) · โหลดไม่ได้ →
  /// `null` ไม่ throw
  Future<String?> _currentFirmwareRolloutId() async {
    try {
      final status = await ref
          .read(deviceStatusRepositoryProvider)
          .getDeviceStatus(widget.deviceId);
      return status.firmwareStatus == DevicePayloadStatus.pending
          ? status.firmwareRolloutId
          : null;
    } catch (_) {
      return null;
    }
  }

  Future<void> _confirm() async {
    final firmwareId = _selectedFirmwareId;
    if (_submitting || _result != null) return;
    if (firmwareId == null) {
      setState(() {
        _error = 'เลือก Firmware ก่อน';
        _gateConflict = false;
      });
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
      _gateConflict = false;
    });
    try {
      final rolloutId = await _currentFirmwareRolloutId();
      final result = await ref
          .read(confirmFirmwareInstallRepositoryProvider)
          .confirm(
            deviceId: widget.deviceId,
            firmwareId: firmwareId,
            rolloutId: rolloutId,
          );
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _result = result;
      });
      // สถานะ Config/Firmware และ banner ของอุปกรณ์อาจเปลี่ยน (override ถูกใช้
      // ไปแล้ว) — ให้ Device Detail โหลดใหม่
      ref.invalidate(deviceStatusProvider(widget.deviceId));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = e.message;
        _gateConflict = isFirmwareGateConflict(e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final deviceAsync = ref.watch(deviceDetailProvider(widget.deviceId));
    final firmwareAsync = ref.watch(firmwareListProvider);
    final navigator = Navigator.of(context);

    return AppV2Theme(
      child: Scaffold(
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppPageHeader(
                title: 'ยืนยันติดตั้ง Firmware',
                onBack: navigator.canPop() ? navigator.pop : null,
                description:
                    'กดหลังติดตั้ง Firmware เข้าเครื่องเสร็จแล้ว · ระบบแค่บันทึกว่ามีการ'
                    'ยืนยัน (Audit Log) ไม่ได้ส่งอะไรไปที่อุปกรณ์',
                meta: deviceHeaderMeta(deviceAsync.valueOrNull),
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
                    messageKey: const Key('confirm_firmware_load_error'),
                    retryKey: const Key('confirm_firmware_load_retry'),
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
                      messageKey: const Key('confirm_firmware_load_error'),
                      retryKey: const Key('confirm_firmware_load_retry'),
                      onRetry: () => ref.invalidate(firmwareListProvider),
                    ),
                    data: (all) => _buildForm(device, all),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildForm(Device device, List<Firmware> all) {
    final isSt = ref.watch(authControllerProvider).role == UserRole.st;
    final options = all
        .where((f) => f.isInstallableOn(device.deviceModel))
        .toList(growable: false);
    final done = _result != null;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
      children: [
        const AppFieldLabel('Firmware ที่ติดตั้งแล้ว'),
        if (options.isEmpty)
          const AppNotice(
            key: Key('confirm_firmware_no_options'),
            tone: AppBadgeTone.neutral,
            child: Text(
              'ยังไม่มี Firmware ที่ยืนยันติดตั้งได้กับรุ่นนี้ (ต้องอัปโหลดสำเร็จ '
              '+ ผ่านการอนุมัติคุณภาพ + รองรับรุ่นอุปกรณ์) — แจ้ง Firmware Engineer',
            ),
          )
        else
          DropdownButtonFormField<String>(
            key: const Key('confirm_firmware_select'),
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
            onChanged: (done || _submitting)
                ? null
                : (v) => setState(() => _selectedFirmwareId = v),
          ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          AppNotice(
            key: const Key('confirm_firmware_error'),
            tone: AppBadgeTone.danger,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_error!),
                if (_gateConflict) ...[
                  const SizedBox(height: 8),
                  const Text(
                    'Firmware นี้ยืนยันติดตั้งไม่ได้เพราะไม่ตรงกับแผน Campaign '
                    'ของเครื่องนี้ (หรือ override เดิมถูกใช้ไปแล้ว) — ต้องขอ '
                    'Firmware Override และรอ Operation อนุมัติก่อน',
                    key: Key('confirm_firmware_gate_hint'),
                    style: TextStyle(
                      fontSize: AppTypography.xs,
                      height: AppTypography.xsHeight,
                    ),
                  ),
                  if (isSt) ...[
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      key: const Key('confirm_firmware_goto_override'),
                      onPressed: () => context.push(
                        AppRoutes.deviceFirmwareOverride(widget.deviceId),
                      ),
                      icon: const Icon(Icons.system_update_alt),
                      label: const Text('Firmware Override'),
                    ),
                  ],
                ],
              ],
            ),
          ),
        ],
        if (_result != null) ...[
          const SizedBox(height: 12),
          AppNotice(
            key: const Key('confirm_firmware_success'),
            tone: AppBadgeTone.success,
            icon: Icons.check_circle_outline,
            title: 'บันทึกการยืนยันติดตั้ง Firmware แล้ว',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('อุปกรณ์: ${_result!.deviceId}'),
                Text('Firmware: ${_firmwareLabel(all, _result!.firmwareId)}'),
                Text('เมื่อ: ${_formatDateTime(_result!.confirmedAt)}'),
              ],
            ),
          ),
        ],
        const SizedBox(height: 16),
        FilledButton(
          key: const Key('confirm_firmware_submit'),
          onPressed: (_submitting || done || options.isEmpty) ? null : _confirm,
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
              : const Text('ยืนยันติดตั้ง Firmware'),
        ),
      ],
    );
  }

  static String _firmwareLabel(List<Firmware> all, String id) {
    for (final f in all) {
      if (f.id == id) return 'v${f.version}';
    }
    return id;
  }
}
