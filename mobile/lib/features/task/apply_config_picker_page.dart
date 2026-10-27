import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_field_label.dart';
import '../../core/ui/app_notice.dart';
import '../../core/ui/app_page_header.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/widgets/app_error_view.dart';
import 'config_apply_request_repository.dart';
import 'field_task_repository.dart';
import 'task_repository.dart';

/// "เลือก Config ที่จะส่งเข้ากล่อง" (docs/28 §6) — ช่างเลือก Config จาก
/// `GET /devices/{deviceId}/apply-options` แล้วขออนุมัติ
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
  const ApplyConfigPickerPage({super.key, required this.deviceId, this.taskId});

  final String deviceId;
  final String? taskId;

  @override
  ConsumerState<ApplyConfigPickerPage> createState() =>
      _ApplyConfigPickerPageState();
}

class _ApplyConfigPickerPageState extends ConsumerState<ApplyConfigPickerPage> {
  final _noteController = TextEditingController();
  String? _selectedId;
  bool _submitting = false;
  String? _error;

  /// งานที่เริ่มสำเร็จแล้วในหน้านี้ (กรณีเปิดจากหน้ากล่อง) — กดซ้ำไม่ต้องเริ่มใหม่
  String? _startedTaskId;

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _submit(String configId) async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    final note = _noteController.text.trim();
    try {
      var taskId = widget.taskId ?? _startedTaskId;
      if (taskId == null) {
        final started = await ref
            .read(fieldTaskRepositoryProvider)
            .start(widget.deviceId);
        taskId = started.task.id;
        if (mounted) setState(() => _startedTaskId = taskId);
        ref.invalidate(taskListProvider);
        ref.invalidate(openTaskForDeviceProvider(widget.deviceId));
      }
      await ref
          .read(configApplyRequestRepositoryProvider)
          .create(taskId, configId: configId, note: note.isEmpty ? null : note);
      ref.invalidate(taskConfigApplyRequestsProvider(taskId));
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            content: Text('ส่งคำขอแล้ว — รอ Operation อนุมัติก่อนส่งเข้ากล่อง'),
          ),
        );
      if (widget.taskId != null) {
        context.pop(true);
      } else {
        context.pushReplacement(AppRoutes.taskDetail(taskId));
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final optionsAsync = ref.watch(deviceApplyOptionsProvider(widget.deviceId));
    final navigator = Navigator.of(context);

    return AppV2Theme(
      child: Scaffold(
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppPageHeader(
                title: 'เลือก Config ที่จะส่ง',
                onBack: navigator.canPop() ? navigator.pop : null,
                description:
                    'เลือก Config ที่อนุมัติแล้วสำหรับกล่องนี้ — Operation ต้อง'
                    'อนุมัติคำขอก่อน แล้วคุณจึงกดส่งเข้ากล่องเองจากหน้างาน',
                meta: [
                  AppPageHeaderMeta(
                    label: 'เลขเครื่อง',
                    value: widget.deviceId,
                  ),
                ],
              ),
              Expanded(
                child: optionsAsync.when(
                  skipLoadingOnRefresh: true,
                  loading: () => const AppDetailSkeleton(
                    padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                  ),
                  error: (error, _) => ListView(
                    children: [
                      const SizedBox(height: 64),
                      AppErrorView(
                        message: error is ApiException
                            ? error.message
                            : 'โหลดรายการ Config ไม่สำเร็จ',
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
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildForm(DeviceApplyOptions options) {
    // ค่าเริ่มต้น = ตัวที่ Operation แนะนำ (backend เรียงไว้บนสุดแล้ว)
    final selectedId =
        _selectedId ??
        options.configs.where((c) => c.suggested).firstOrNull?.id;
    final canSubmit =
        options.deviceInstalled && selectedId != null && !_submitting;
    final startedTaskId = _startedTaskId;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
      children: [
        if (!options.deviceInstalled) ...[
          const AppNotice(
            key: Key('apply_device_not_installed'),
            tone: AppBadgeTone.warning,
            icon: Icons.info_outline,
            child: Text(
              'กล่องนี้ยังไม่ได้บันทึกว่าติดตั้งแล้ว — ส่ง Config เข้ากล่องได้หลัง'
              'ติดตั้งเท่านั้น (เริ่มงานจากหน้ากล่องเพื่อจดบันทึกได้)',
            ),
          ),
          const SizedBox(height: 16),
        ],
        const AppFieldLabel('Config'),
        if (options.configs.isEmpty)
          const AppNotice(
            key: Key('apply_options_empty'),
            tone: AppBadgeTone.neutral,
            child: Text(
              'ยังไม่มี Config ที่อนุมัติแล้วสำหรับรุ่นของกล่องนี้ — แจ้ง Config '
              'Engineer',
            ),
          )
        else
          for (final config in options.configs) ...[
            _OptionTile(
              config: config,
              selected: config.id == selectedId,
              onTap: _submitting
                  ? null
                  : () => setState(() => _selectedId = config.id),
            ),
            const SizedBox(height: 8),
          ],
        const SizedBox(height: 12),
        const AppFieldLabel('หมายเหตุถึง Operation', hint: '(ไม่บังคับ)'),
        TextField(
          key: const Key('apply_note_field'),
          controller: _noteController,
          enabled: !_submitting,
          maxLength: 500,
          decoration: const InputDecoration(
            hintText: 'เช่น ลูกค้าขอเปลี่ยนรอบส่งพิกัด',
            filled: true,
            fillColor: AppColors.card,
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
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
        ],
        const SizedBox(height: 16),
        FilledButton(
          key: const Key('apply_submit_button'),
          onPressed: canSubmit ? () => _submit(selectedId) : null,
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
              : const Text('ขออนุมัติส่งเข้ากล่อง'),
        ),
      ],
    );
  }
}

/// 1 ตัวเลือก Config — กดทั้งการ์ดเพื่อเลือก (สูงพอสำหรับนิ้วหน้างาน)
class _OptionTile extends StatelessWidget {
  const _OptionTile({
    required this.config,
    required this.selected,
    required this.onTap,
  });

  final ApplyOptionConfig config;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      button: true,
      child: AppCard(
        key: Key('apply_option_${config.id}'),
        onTap: onTap,
        highlighted: selected,
        child: Row(
          children: [
            Icon(
              selected ? Icons.radio_button_checked : Icons.radio_button_off,
              color: selected ? AppColors.primary : AppColors.mutedForeground,
            ),
            const SizedBox(width: 12),
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
                ],
              ),
            ),
            if (config.suggested) ...[
              const SizedBox(width: 8),
              const AppBadge(
                key: Key('apply_option_suggested'),
                label: 'Operation แนะนำ',
                tone: AppBadgeTone.info,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
