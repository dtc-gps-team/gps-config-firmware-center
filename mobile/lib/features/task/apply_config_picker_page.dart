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
import '../../core/ui/app_bottom_action_bar.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_field_label.dart';
import '../../core/ui/app_ink_header.dart';
import '../../core/ui/app_notice.dart';
import '../../core/ui/app_role_locked_view.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/ui/labels.dart';
import '../../core/widgets/app_error_view.dart';
import 'config_apply_request_repository.dart';
import 'field_task_repository.dart';
import 'task_repository.dart';

/// "เลือกสิ่งที่จะส่งเข้ากล่อง" (docs/28 §6, docs/27 B3) — ช่างเลือก Config หรือ
/// Firmware จาก `GET /devices/{deviceId}/apply-options`
///
/// Config (docs/27 §2.2, v3.75): แตะ Config แล้วไปหน้าพารามิเตอร์
/// ([ApplyConfigParamsPage]) — ดู/แก้ค่า แล้วส่งเข้ากล่องหรือขออนุมัติค่าที่แก้ที่นั่น ·
/// Firmware ยังต้องขออนุมัติทุกครั้ง
///
/// แท็บ Firmware: แสดงเวอร์ชันที่กล่องรันอยู่ (ถ้ารู้) · เวอร์ชันเดียวกับที่รันอยู่
/// เลือกไม่ได้ · เลือกเวอร์ชันต่ำกว่าต้องยืนยันการถอยเวอร์ชันก่อน (D5)
///
/// - เปิดจากหน้ากล่อง ([taskId] = `null`): เริ่มงานก่อน (`POST /tasks/start` —
///   ได้งานเดิมถ้ายังเปิดอยู่) แล้วสร้างคำขอ แล้วแทนหน้านี้ด้วยหน้างาน
/// - เปิดจากหน้างาน ([taskId] มีค่า): สร้างคำขอให้งานนั้น แล้วปิดหน้านี้กลับไป
///   (`pop(true)` ให้หน้างานโหลดคำขอใหม่)
///
/// ต้องออนไลน์ (ไม่เข้าคิว offline) เหมือนปุ่มขอส่ง Config เดิม · ถ้าเริ่มงาน
/// สำเร็จแต่สร้างคำขอไม่ผ่าน (เช่น กล่องมีคำขอค้างของคนอื่น) งานยังอยู่ — แสดง
/// ข้อความของ backend และลิงก์ไปที่งานได้
class ApplyConfigPickerPage extends ConsumerStatefulWidget {
  const ApplyConfigPickerPage({
    super.key,
    required this.deviceId,
    this.taskId,
    this.initialKind = FieldApplyKind.config,
  });

  final String deviceId;
  final String? taskId;

  /// แท็บที่เปิดอยู่ตอนเข้าหน้า — "ขออัปเดต Firmware" จากหน้างานเปิดแท็บ Firmware
  final FieldApplyKind initialKind;

  @override
  ConsumerState<ApplyConfigPickerPage> createState() =>
      _ApplyConfigPickerPageState();
}

class _ApplyConfigPickerPageState extends ConsumerState<ApplyConfigPickerPage> {
  final _noteController = TextEditingController();
  late FieldApplyKind _kind = widget.initialKind;
  String? _selectedFirmwareId;
  bool _submitting = false;
  String? _error;

  /// งานที่เริ่มสำเร็จแล้วในหน้านี้ (กรณีเปิดจากหน้ากล่อง) — กดซ้ำไม่ต้องเริ่มใหม่
  String? _startedTaskId;

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  /// ถอยเวอร์ชัน (docs/27 D5) — ถามยืนยันก่อนขอ · `true` = ยืนยัน
  Future<bool> _confirmDowngrade(String? from, String to) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('ถอยเวอร์ชัน Firmware?'),
        content: Text(
          'ถอยเวอร์ชันจาก v${from ?? '-'} เป็น v$to — ค่าบางอย่างที่ Firmware '
          'เก่าไม่รู้จักจะใช้ไม่ได้ และ Operation จะเห็นป้ายถอยเวอร์ชันตอนอนุมัติ',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('กลับไปเลือกใหม่'),
          ),
          FilledButton(
            key: const Key('confirm_downgrade'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('ถอยเวอร์ชัน'),
          ),
        ],
      ),
    );
    return confirmed ?? false;
  }

  Future<void> _submitFirmware(
    ApplyOptionFirmware firmware,
    String? currentVersion,
  ) async {
    if (firmware.isDowngrade &&
        !await _confirmDowngrade(currentVersion, firmware.version)) {
      return;
    }
    await _submit(firmwareId: firmware.id);
  }

  /// งานของคำขอ — เปิดจากหน้างานใช้งานนั้น ไม่งั้นเริ่มงาน (ได้งานเดิมถ้ายังเปิดอยู่)
  Future<String> _ensureTask() async {
    final existing = widget.taskId ?? _startedTaskId;
    if (existing != null) return existing;
    final started = await ref
        .read(fieldTaskRepositoryProvider)
        .start(widget.deviceId);
    final taskId = started.task.id;
    if (mounted) setState(() => _startedTaskId = taskId);
    ref.invalidate(taskListProvider);
    ref.invalidate(openTaskForDeviceProvider(widget.deviceId));
    return taskId;
  }

  /// ทำงานที่เรียก backend — error ของ backend แสดงใต้ฟอร์ม
  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await action();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = e.message;
      });
    }
  }

  /// แจ้งผลแล้วไปหน้างาน — เปิดจากหน้างานปิดหน้านี้กลับ (`pop(true)` ให้โหลดคำขอใหม่)
  void _finish(String taskId, String message) {
    ref.invalidate(taskConfigApplyRequestsProvider(taskId));
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
    if (widget.taskId != null) {
      context.pop(true);
    } else {
      context.pushReplacement(AppRoutes.taskDetail(taskId));
    }
  }

  /// Firmware — ขออนุมัติเหมือนเดิม
  Future<void> _submit({String? firmwareId}) => _run(() async {
    final note = _noteController.text.trim();
    final taskId = await _ensureTask();
    await ref
        .read(configApplyRequestRepositoryProvider)
        .create(
          taskId,
          firmwareId: firmwareId,
          note: note.isEmpty ? null : note,
        );
    _finish(taskId, 'ส่งคำขอแล้ว — รอ Operation อนุมัติก่อนส่งเข้ากล่อง');
  });

  /// หน้าพารามิเตอร์ของ Config — ส่ง/ขอสำเร็จ หน้านั้นปิดพร้อม id ของงาน แล้วไป
  /// หน้างานต่อ (เปิดจากหน้างาน = ปิดหน้านี้กลับไปด้วย)
  Future<void> _openParams(String configId) async {
    final taskId = await context.push<String>(
      AppRoutes.deviceApplyConfig(
        widget.deviceId,
        configId,
        taskId: widget.taskId ?? _startedTaskId,
      ),
    );
    if (taskId == null || !mounted) return;
    if (widget.taskId != null) {
      context.pop(true);
    } else {
      context.pushReplacement(AppRoutes.taskDetail(taskId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final role = ref.watch(authControllerProvider).role;
    // ปุ่มในแอปพามาได้เฉพาะช่าง — role อื่นมาจากลิงก์ตรง บอกว่าไม่มีสิทธิ์ ไม่โหลด
    final locked = role != null && !isFieldStaff(role);
    final optionsAsync = locked
        ? null
        : ref.watch(deviceApplyOptionsProvider(widget.deviceId));
    final options = optionsAsync?.valueOrNull;
    final navigator = Navigator.of(context);
    final isFirmware = _kind == FieldApplyKind.firmware;

    return AppV2Theme(
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AppInkHeader(
              // ภาพ r4: แท็บ Config "เลือก Config" · แท็บ Firmware บอกว่าส่งได้ทีละรายการ
              title: isFirmware && !locked
                  ? 'เลือกสิ่งที่จะส่ง'
                  : 'เลือก Config',
              subtitle: locked
                  ? null
                  : isFirmware
                  ? '${widget.deviceId} · ส่งได้หนึ่งรายการต่อคำขอ'
                  : widget.deviceId,
              onBack: navigator.canPop() ? navigator.pop : null,
            ),
            Expanded(
              child: optionsAsync == null
                  ? const AppRoleLockedView()
                  : optionsAsync.when(
                      skipLoadingOnRefresh: true,
                      loading: () => const AppDetailSkeleton(
                        padding: EdgeInsets.fromLTRB(18, 16, 18, 16),
                      ),
                      error: (error, _) => ListView(
                        children: [
                          const SizedBox(height: 64),
                          AppErrorView(
                            message: error is ApiException
                                ? error.message
                                : 'โหลดตัวเลือกไม่สำเร็จ',
                            messageKey: const Key('apply_options_error'),
                            retryKey: const Key('apply_options_retry'),
                            onRetry: () => ref.invalidate(
                              deviceApplyOptionsProvider(widget.deviceId),
                            ),
                          ),
                        ],
                      ),
                      data: _buildForm,
                    ),
            ),
            if (options != null && isFirmware) _firmwareActions(options),
          ],
        ),
      ),
    );
  }

  Widget _buildForm(DeviceApplyOptions options) {
    final isFirmware = _kind == FieldApplyKind.firmware;
    final openRequest = options.openRequest;

    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
      children: [
        if (!isFirmware) ...[
          const Text(
            'แตะ Config เพื่อดูพารามิเตอร์ แล้วส่งเข้ากล่องได้ทันที · แก้ค่าหรือส่ง '
            'Firmware ต้องรอ Operation อนุมัติก่อน',
            style: TextStyle(
              fontSize: AppTypography.xs,
              height: AppTypography.xsHeight,
              color: AppColors.mutedForeground,
            ),
          ),
          const SizedBox(height: 12),
        ],
        _KindTabs(
          selected: _kind,
          onChanged: _submitting
              ? null
              : (kind) => setState(() {
                  _kind = kind;
                  _error = null;
                }),
        ),
        const SizedBox(height: 16),
        if (openRequest != null) ...[
          _OpenRequestNotice(
            request: openRequest,
            onGoToTask: openRequest.taskId == null
                ? null
                : () => _goToTask(openRequest.taskId!),
          ),
          const SizedBox(height: 16),
        ],
        if (!options.deviceInstalled) ...[
          const AppNotice(
            key: Key('apply_device_not_installed'),
            tone: AppBadgeTone.warning,
            icon: Icons.info_outline,
            child: Text(
              'กล่องนี้ยังไม่ได้บันทึกว่าติดตั้งแล้ว — ส่งเข้ากล่องได้หลังติดตั้ง'
              'เท่านั้น (เริ่มงานจากหน้ากล่องเพื่อจดบันทึกได้)',
            ),
          ),
          const SizedBox(height: 16),
        ],
        if (isFirmware)
          ..._firmwareOptions(options)
        else if (options.configs.isEmpty)
          const AppNotice(
            key: Key('apply_options_empty'),
            tone: AppBadgeTone.neutral,
            child: Text(
              'ยังไม่มี Config ที่อนุมัติแล้วสำหรับรุ่นของกล่องนี้ — แจ้ง Config '
              'Engineer',
            ),
          )
        else
          // Operation แนะนำขึ้นก่อน (backend เรียงไว้แล้ว) · แตะ = ไปหน้าพารามิเตอร์
          for (final config in options.configs) ...[
            _OptionTile(config: config, onTap: () => _openParams(config.id)),
            const SizedBox(height: 12),
          ],
      ],
    );
  }

  /// แถบล่างของแท็บ Firmware — error ของ backend อยู่เหนือปุ่ม เห็นทันทีที่กด
  Widget _firmwareActions(DeviceApplyOptions options) {
    // Firmware ไม่มีค่าเริ่มต้น — ต้องเลือกเองทุกครั้ง (ไม่เดาให้)
    final selectedFirmware = options.firmwares
        .where((f) => f.id == _selectedFirmwareId && !f.isCurrent)
        .firstOrNull;
    final canSubmit =
        options.deviceInstalled &&
        options.openRequest == null &&
        selectedFirmware != null;
    final startedTaskId = _startedTaskId;
    return AppBottomActionBar(
      children: [
        if (_error != null) ...[
          AppNotice(
            tone: AppBadgeTone.danger,
            icon: Icons.error_outline,
            child: Text(_error!, key: const Key('apply_submit_error')),
          ),
          if (startedTaskId != null && widget.taskId == null)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                key: const Key('apply_go_to_task'),
                onPressed: () => context.pushReplacement(
                  AppRoutes.taskDetail(startedTaskId),
                ),
                child: const Text('ไปที่งาน (งานเริ่มแล้ว)'),
              ),
            ),
          const SizedBox(height: 8),
        ],
        AppSubmitButton(
          buttonKey: const Key('apply_submit_button'),
          label: 'ขออนุมัติ',
          submitting: _submitting,
          onPressed: !canSubmit
              ? null
              : () => _submitFirmware(
                  selectedFirmware,
                  options.currentFirmwareVersion,
                ),
        ),
      ],
    );
  }

  /// ไปหน้างานของคำขอที่ค้าง — เปิดมาจากหน้างานนั้นเองให้ย้อนกลับ ไม่ซ้อนหน้า
  void _goToTask(String taskId) {
    if (widget.taskId == taskId) {
      context.pop();
    } else {
      context.pushReplacement(AppRoutes.taskDetail(taskId));
    }
  }

  /// เนื้อหาแท็บ Firmware (docs/27 B3) — เวอร์ชันที่กล่องรันอยู่บอกด้วยป้าย "ใช้อยู่"
  /// บนการ์ด · ไม่รู้เวอร์ชัน หรือเวอร์ชันนั้นไม่อยู่ในรายการ จึงขึ้นแถบบอกแยก
  List<Widget> _firmwareOptions(DeviceApplyOptions options) {
    final current = options.currentFirmwareVersion;
    final currentListed = options.firmwares.any((f) => f.isCurrent);
    return [
      if (!currentListed) ...[
        AppNotice(
          key: const Key('apply_firmware_current_version'),
          tone: AppBadgeTone.neutral,
          icon: Icons.memory,
          child: Text(
            current == null
                ? 'ไม่ทราบเวอร์ชัน Firmware ที่กล่องรันอยู่ — ระบบจะตรวจอีกครั้งตอนส่งคำขอ'
                : 'กล่องรัน Firmware v$current อยู่ตอนนี้',
          ),
        ),
        const SizedBox(height: 12),
      ],
      if (options.firmwares.isEmpty)
        const AppNotice(
          key: Key('apply_firmware_empty'),
          tone: AppBadgeTone.neutral,
          child: Text(
            'ยังไม่มี Firmware ที่ QA อนุมัติแล้วสำหรับรุ่นของกล่องนี้ — แจ้ง '
            'Firmware Engineer',
          ),
        )
      else
        for (final firmware in options.firmwares) ...[
          _FirmwareTile(
            firmware: firmware,
            selected: firmware.id == _selectedFirmwareId,
            onTap: _submitting
                ? null
                : () => setState(() => _selectedFirmwareId = firmware.id),
          ),
          const SizedBox(height: 12),
        ],
      const SizedBox(height: 8),
      const AppFieldLabel('หมายเหตุถึง Operation', hint: '(ไม่บังคับ)'),
      TextField(
        key: const Key('apply_note_field'),
        controller: _noteController,
        enabled: !_submitting,
        maxLength: 500,
        minLines: 3,
        maxLines: 5,
        decoration: const InputDecoration(
          hintText: 'เช่น ลูกค้าขอเปลี่ยนรอบส่งพิกัด',
          filled: true,
          fillColor: AppColors.card,
        ),
      ),
      const Text(
        // อายุคำขอ = CONFIG_APPLY_REQUEST_TTL_HOURS ของ backend
        'ขั้นต่อไป: Operation อนุมัติบน Web แล้วผู้ถืองานกดส่งเองเมื่ออยู่หน้ากล่อง · '
        'คำขอหมดอายุใน 24 ชม. ถ้าไม่มีใครตัดสิน',
        key: Key('apply_firmware_next_step'),
        style: TextStyle(
          fontSize: AppTypography.xs,
          height: AppTypography.xsHeight,
          color: AppColors.mutedForeground,
        ),
      ),
    ];
  }
}

/// แท็บ Config / Firmware แบบ pill ตามภาพ r4 — แท็บที่เลือกเป็นพื้นขาวบนรางเทา
class _KindTabs extends StatelessWidget {
  const _KindTabs({required this.selected, required this.onChanged});

  final FieldApplyKind selected;

  /// `null` = กำลังส่ง สลับแท็บไม่ได้
  final ValueChanged<FieldApplyKind>? onChanged;

  @override
  Widget build(BuildContext context) {
    final onChanged = this.onChanged;
    Widget tab(FieldApplyKind kind, String label) {
      final active = kind == selected;
      return Expanded(
        child: Semantics(
          button: true,
          selected: active,
          child: Material(
            color: active ? AppColors.card : Colors.transparent,
            borderRadius: BorderRadius.circular(14),
            child: InkWell(
              key: Key('apply_kind_${kind.name}'),
              borderRadius: BorderRadius.circular(14),
              onTap: onChanged == null || active ? null : () => onChanged(kind),
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 48),
                child: Center(
                  child: Text(
                    label,
                    style: TextStyle(
                      fontSize: AppTypography.sm,
                      fontWeight: FontWeight.w600,
                      color: active
                          ? AppColors.foreground
                          : AppColors.mutedForeground,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      key: const Key('apply_kind_selector'),
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.muted,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          tab(FieldApplyKind.config, 'Config'),
          tab(FieldApplyKind.firmware, 'Firmware'),
        ],
      ),
    );
  }
}

/// กล่องมีคำขอที่ยังไม่จบ — ขอใหม่ไม่ได้ (backend ตอบ 409) บอกตั้งแต่เปิดหน้า
/// ว่าค้างอะไรอยู่และต้องทำอะไรต่อ แทนที่จะรู้หลังกดขอ
class _OpenRequestNotice extends StatelessWidget {
  const _OpenRequestNotice({required this.request, required this.onGoToTask});

  final ApplyOptionOpenRequest request;

  /// `null` = คำขอของงานช่างคนอื่น — ไปที่งานไม่ได้ ต้องรอให้จบ
  final VoidCallback? onGoToTask;

  @override
  Widget build(BuildContext context) {
    final firmwareVersion = request.firmwareVersion;
    final configName = request.configName;
    final subject = request.kind == FieldApplyKind.firmware
        ? (firmwareVersion == null ? 'Firmware' : 'Firmware v$firmwareVersion')
        : (configName == null ? 'Config' : 'Config "$configName"');
    final status = configApplyRequestStatusLabel(
      request.status,
      kind: request.kind,
    );
    final next = onGoToTask == null
        ? 'คำขอนี้เป็นของงานช่างคนอื่น — ขอใหม่ได้หลังคำขอนี้จบ'
        : request.status == ConfigApplyRequestStatus.sending
        ? 'รอผลจากกล่องที่หน้างาน แล้วจึงขอใหม่ได้'
        : 'กดส่งหรือยกเลิกคำขอนี้ที่หน้างานก่อน แล้วจึงขอใหม่ได้';
    return AppNotice(
      key: const Key('apply_open_request'),
      tone: AppBadgeTone.warning,
      icon: Icons.pending_actions,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'กล่องนี้มีคำขอส่ง $subject ค้างอยู่ ($status)',
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 4),
          Text(next),
          if (onGoToTask != null)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                key: const Key('apply_open_request_go_to_task'),
                onPressed: onGoToTask,
                child: const Text('ไปที่งานของคำขอนี้'),
              ),
            ),
        ],
      ),
    );
  }
}

/// 1 ตัวเลือก Firmware — เวอร์ชันที่กล่องรันอยู่เลือกไม่ได้ (backend ตอบ 409) ·
/// เวอร์ชันต่ำกว่ามีป้ายถอยเวอร์ชัน (docs/27 D5)
class _FirmwareTile extends StatelessWidget {
  const _FirmwareTile({
    required this.firmware,
    required this.selected,
    required this.onTap,
  });

  final ApplyOptionFirmware firmware;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final disabled = firmware.isCurrent;
    return Semantics(
      selected: selected,
      button: true,
      enabled: !disabled,
      child: AppCard(
        key: Key('apply_firmware_${firmware.id}'),
        onTap: disabled ? null : onTap,
        highlighted: selected,
        child: Row(
          children: [
            Icon(
              selected ? Icons.radio_button_checked : Icons.radio_button_off,
              color: disabled
                  ? AppColors.border
                  : selected
                  ? AppColors.primary
                  : AppColors.mutedForeground,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        'Firmware ${firmware.version}',
                        style: TextStyle(
                          fontSize: AppTypography.sm,
                          height: AppTypography.smHeight,
                          fontWeight: FontWeight.w600,
                          color: disabled
                              ? AppColors.mutedForeground
                              : AppColors.foreground,
                        ),
                      ),
                      if (firmware.isCurrent)
                        const AppBadge(
                          key: Key('apply_firmware_current'),
                          label: 'ใช้อยู่',
                          tone: AppBadgeTone.neutral,
                        )
                      else if (firmware.isDowngrade)
                        const AppBadge(
                          key: Key('apply_firmware_downgrade'),
                          label: 'ถอยเวอร์ชัน',
                          tone: AppBadgeTone.warning,
                        ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  // apply-options คืนเฉพาะ Firmware ที่ QA อนุมัติแล้ว (docs/13 §3.2)
                  const Text(
                    'QA อนุมัติแล้ว',
                    style: TextStyle(
                      fontSize: AppTypography.xs,
                      height: AppTypography.xsHeight,
                      color: AppColors.mutedForeground,
                    ),
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

/// 1 ตัวเลือก Config — กดทั้งการ์ดเพื่อไปหน้าพารามิเตอร์ (สูงพอสำหรับนิ้วหน้างาน)
class _OptionTile extends StatelessWidget {
  const _OptionTile({required this.config, required this.onTap});

  final ApplyOptionConfig config;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      child: AppCard(
        key: Key('apply_option_${config.id}'),
        onTap: onTap,
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    config.name,
                    style: const TextStyle(
                      fontSize: AppTypography.sm,
                      height: AppTypography.smHeight,
                      fontWeight: FontWeight.w600,
                      color: AppColors.foreground,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    config.latestVersion > 0
                        ? 'เวอร์ชัน ${config.latestVersion}'
                        : 'ยังไม่มีเวอร์ชันที่บันทึก',
                    style: const TextStyle(
                      fontSize: AppTypography.xs,
                      height: AppTypography.xsHeight,
                      color: AppColors.mutedForeground,
                    ),
                  ),
                  if (config.suggested) ...[
                    const SizedBox(height: 6),
                    const AppBadge(
                      key: Key('apply_option_suggested'),
                      label: 'Operation แนะนำ',
                      tone: AppBadgeTone.success,
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            const Icon(Icons.chevron_right, color: AppColors.mutedForeground),
          ],
        ),
      ),
    );
  }
}
