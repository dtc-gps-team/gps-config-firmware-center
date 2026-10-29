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
import '../config_override/config_override_repository.dart';
import '../config_override/config_value_parser.dart';
import 'config_apply_request_repository.dart';
import 'field_task_repository.dart';
import 'task_repository.dart';

/// "พารามิเตอร์ของ Config" (docs/27 §2.2, v3.75) — หน้าถัดจากหน้าเลือก Config
/// และจากปุ่ม "ส่ง Config เข้าเครื่อง" ของหน้างาน (Config ที่ Operation ผูกไว้)
///
/// แสดงทุกค่าที่จะส่งเข้ากล่อง (Config + Override ที่อนุมัติแล้วของกล่อง จาก
/// `GET /devices/{deviceId}/apply-options`) · ค่าที่ช่างแก้ได้มีช่องกรอก
/// - **ไม่แก้** → "ส่งเข้ากล่อง": คำขอแบบส่งตรง (`direct` — อนุมัติแล้วทันที เพราะ
///   Config ผ่านการอนุมัติมาแล้ว) แล้วกดส่งเข้ากล่องให้เลย
/// - **แก้** → กรอกเหตุผล "ขออนุมัติค่าที่แก้": Override ของ Config นี้ + คำขอผูกกัน
///   (docs/30) รอ Operation อนุมัติ แล้วช่างกดส่งที่หน้างาน
///
/// [taskId] `null` = เปิดจากหน้ากล่อง เริ่มงานให้ก่อน (ได้งานเดิมถ้ายังเปิดอยู่) ·
/// สำเร็จแล้วปิดหน้านี้พร้อม id ของงาน (`pop(taskId)`) ให้หน้าที่เปิดไปต่อเอง
class ApplyConfigParamsPage extends ConsumerStatefulWidget {
  const ApplyConfigParamsPage({
    super.key,
    required this.deviceId,
    required this.configId,
    this.taskId,
  });

  final String deviceId;
  final String configId;
  final String? taskId;

  @override
  ConsumerState<ApplyConfigParamsPage> createState() =>
      _ApplyConfigParamsPageState();
}

class _ApplyConfigParamsPageState extends ConsumerState<ApplyConfigParamsPage> {
  final _reasonController = TextEditingController();

  /// ค่าที่ช่างพิมพ์ในช่องพารามิเตอร์ (ชื่อ field -> ข้อความ)
  final Map<String, String> _edits = {};
  Map<String, String> _paramErrors = const {};
  String? _reasonError;
  bool _submitting = false;
  String? _error;

  /// งานที่เริ่มสำเร็จแล้วในหน้านี้ (กรณีเปิดจากหน้ากล่อง) — กดซ้ำไม่ต้องเริ่มใหม่
  String? _startedTaskId;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
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

  /// ทำงานที่เรียก backend — error ของ backend แสดงเหนือปุ่ม
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

  /// แจ้งผลแล้วปิดหน้านี้พร้อม id ของงาน
  void _finish(String taskId, String message) {
    ref.invalidate(taskConfigApplyRequestsProvider(taskId));
    ref.invalidate(deviceApplyOptionsProvider(widget.deviceId));
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
    context.pop(taskId);
  }

  /// ไม่แก้ค่า — คำขอแบบส่งตรง (อนุมัติแล้วทันที) แล้วกดส่งเข้ากล่องให้เลย ·
  /// กดส่งไม่ผ่าน (เช่น กล่องออฟไลน์) คำขอยังอนุมัติอยู่ ไปกดส่งใหม่ที่หน้างานได้
  Future<void> _submitDirect() => _run(() async {
    final repo = ref.read(configApplyRequestRepositoryProvider);
    final taskId = await _ensureTask();
    final created = await repo.create(
      taskId,
      configId: widget.configId,
      direct: true,
    );
    String message;
    try {
      await repo.release(created.id);
      message = 'กำลังส่ง Config เข้ากล่อง — ดูผลได้ที่หน้างาน';
    } on ApiException catch (e) {
      message =
          'ยังส่งเข้ากล่องไม่ได้: ${e.message} — กดส่งเข้ากล่องอีกครั้งที่หน้างาน';
    }
    _finish(taskId, message);
  });

  /// แก้ค่า — ตรวจค่า + เหตุผลก่อน แล้วขออนุมัติผ่าน Override ของ Config นี้
  Future<void> _submitEdits(
    ApplyOptionConfig config,
    Map<String, ConfigFieldDefinition> defByName,
  ) async {
    final errors = <String, String>{};
    final parsed = <String, dynamic>{};
    for (final entry in _changedFields(config).entries) {
      final dataType = defByName[entry.key]?.dataType ?? 'string';
      final result = parseConfigValue(entry.value, dataType);
      if (result.isOk) {
        parsed[entry.key] = result.value;
      } else {
        errors[entry.key] = result.error!;
      }
    }
    final reason = _reasonController.text.trim();
    setState(() {
      _paramErrors = errors;
      _reasonError = reason.isEmpty ? 'กรอกเหตุผลที่แก้ค่า' : null;
    });
    if (errors.isNotEmpty || reason.isEmpty) return;

    await _run(() async {
      final taskId = await _ensureTask();
      await ref
          .read(configOverrideRepositoryProvider)
          .overrideConfig(
            deviceId: widget.deviceId,
            fields: parsed,
            reason: reason,
            configId: config.id,
          );
      _finish(
        taskId,
        'ส่งคำขอแก้ค่าแล้ว — รอ Operation อนุมัติ แล้วกดส่งเข้ากล่องที่หน้างาน',
      );
    });
  }

  /// ช่องที่ค่าที่พิมพ์ต่างจากค่าเดิมของ Config (แก้แล้วแก้กลับ = ไม่นับ)
  Map<String, String> _changedFields(ApplyOptionConfig config) => {
    for (final entry in _edits.entries)
      if (config.fields.containsKey(entry.key) &&
          entry.value != configValueToInput(config.fields[entry.key]))
        entry.key: entry.value,
  };

  @override
  Widget build(BuildContext context) {
    final optionsAsync = ref.watch(deviceApplyOptionsProvider(widget.deviceId));
    final config = optionsAsync.valueOrNull?.configs
        .where((c) => c.id == widget.configId)
        .firstOrNull;
    final navigator = Navigator.of(context);

    return AppV2Theme(
      child: Scaffold(
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppPageHeader(
                title: config?.name ?? 'พารามิเตอร์ของ Config',
                onBack: navigator.canPop() ? navigator.pop : null,
                description:
                    'ไม่แก้ค่า = ส่งเข้ากล่องได้ทันที · แก้ค่า = ต้องรอ Operation '
                    'อนุมัติก่อน แล้วกดส่งที่หน้างาน',
                meta: [
                  AppPageHeaderMeta(
                    label: 'เลขเครื่อง',
                    value: widget.deviceId,
                  ),
                  if (config != null && config.latestVersion > 0)
                    AppPageHeaderMeta(
                      label: 'เวอร์ชัน',
                      value: '${config.latestVersion}',
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
                            : 'โหลดพารามิเตอร์ไม่สำเร็จ',
                        messageKey: const Key('apply_params_error'),
                        retryKey: const Key('apply_params_retry'),
                        onRetry: () => ref.invalidate(
                          deviceApplyOptionsProvider(widget.deviceId),
                        ),
                      ),
                    ],
                  ),
                  data: (options) => _buildForm(options, config),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildForm(DeviceApplyOptions options, ApplyOptionConfig? config) {
    if (config == null) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: const [
          AppNotice(
            key: Key('apply_params_not_found'),
            tone: AppBadgeTone.warning,
            icon: Icons.info_outline,
            child: Text(
              'Config นี้ส่งเข้ากล่องนี้ไม่ได้ — ไม่อยู่ในรายการ Config ที่อนุมัติ'
              'แล้วสำหรับรุ่นของกล่อง แจ้ง Operation',
            ),
          ),
        ],
      );
    }
    // นิยามพารามิเตอร์ (แก้ได้ไหม/ชื่อเรียกง่าย/ชนิด) — โหลดไม่ได้ = แก้ไม่ได้ทุกช่อง
    final defByName = {
      for (final def
          in ref.watch(configFieldDefinitionListProvider).valueOrNull ??
              const <ConfigFieldDefinition>[])
        def.fieldName: def,
    };
    final edited = _changedFields(config).isNotEmpty;
    // คำขอของงานนี้เองที่ค้าง หน้างานไม่เปิดมาที่นี่อยู่แล้ว — ค้างอยู่ = ของงานอื่น
    // หรือเปิดจากหน้ากล่อง (backend ตอบ 409 ถ้าขอซ้ำ)
    final blocked = !options.deviceInstalled || options.openRequest != null;
    final startedTaskId = _startedTaskId;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
      children: [
        if (!options.deviceInstalled) ...[
          const AppNotice(
            key: Key('apply_params_not_installed'),
            tone: AppBadgeTone.warning,
            icon: Icons.info_outline,
            child: Text(
              'กล่องนี้ยังไม่ได้บันทึกว่าติดตั้งแล้ว — ส่งเข้ากล่องได้หลังติดตั้ง'
              'เท่านั้น',
            ),
          ),
          const SizedBox(height: 16),
        ] else if (options.openRequest != null) ...[
          const AppNotice(
            key: Key('apply_params_open_request'),
            tone: AppBadgeTone.warning,
            icon: Icons.pending_actions,
            child: Text(
              'กล่องนี้มีคำขอส่งที่ยังไม่จบอยู่ — กดส่งหรือยกเลิกคำขอนั้นที่หน้างาน'
              'ก่อน แล้วจึงส่งใหม่ได้',
            ),
          ),
          const SizedBox(height: 16),
        ],
        if (config.fields.isEmpty)
          const AppNotice(
            key: Key('apply_params_empty'),
            tone: AppBadgeTone.neutral,
            child: Text('Config นี้ไม่มีพารามิเตอร์ให้แสดง'),
          )
        else
          _ConfigParams(
            config: config,
            defByName: defByName,
            errors: _paramErrors,
            enabled: !_submitting,
            onChanged: (field, value) => setState(() {
              _edits[field] = value;
              _paramErrors = const {};
            }),
          ),
        if (edited) ...[
          const SizedBox(height: 16),
          // แก้ค่า = ต้องให้ Operation อนุมัติ จึงต้องมีเหตุผล (ลง Audit Log)
          const AppFieldLabel('เหตุผลที่แก้ค่า', hint: '(บังคับ)'),
          TextField(
            key: const Key('apply_reason_field'),
            controller: _reasonController,
            enabled: !_submitting,
            maxLength: 500,
            onChanged: (_) {
              if (_reasonError != null) setState(() => _reasonError = null);
            },
            decoration: InputDecoration(
              hintText: 'เช่น ลูกค้าขอส่งพิกัดถี่ขึ้น',
              filled: true,
              fillColor: AppColors.card,
              errorText: _reasonError,
            ),
          ),
        ],
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
          onPressed: blocked || _submitting
              ? null
              : edited
              ? () => _submitEdits(config, defByName)
              : _submitDirect,
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
              : Text(edited ? 'ขออนุมัติค่าที่แก้' : 'ส่งเข้ากล่อง'),
        ),
      ],
    );
  }
}

/// พารามิเตอร์ทุกค่าของ Config — ค่าที่ช่างแก้ได้ (`stOverridable`) มีช่องกรอก
/// ที่เหลือแสดงค่า + "(แก้ไขไม่ได้)" · ชื่อเรียกง่ายจาก `description` อยู่บนชื่อจริง
class _ConfigParams extends StatelessWidget {
  const _ConfigParams({
    required this.config,
    required this.defByName,
    required this.errors,
    required this.enabled,
    required this.onChanged,
  });

  final ApplyOptionConfig config;
  final Map<String, ConfigFieldDefinition> defByName;
  final Map<String, String> errors;
  final bool enabled;
  final void Function(String field, String value) onChanged;

  @override
  Widget build(BuildContext context) {
    final entries = config.fields.entries.toList(growable: false);
    return AppCard(
      key: const Key('apply_params'),
      size: AppCardSize.small,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (i, entry) in entries.indexed) ...[
            if (i > 0) const Divider(),
            _ParamRow(
              key: Key('apply_param_row_${entry.key}'),
              field: entry.key,
              value: entry.value,
              def: defByName[entry.key],
              error: errors[entry.key],
              enabled: enabled,
              onChanged: (v) => onChanged(entry.key, v),
            ),
          ],
        ],
      ),
    );
  }
}

class _ParamRow extends StatefulWidget {
  const _ParamRow({
    super.key,
    required this.field,
    required this.value,
    required this.def,
    required this.error,
    required this.enabled,
    required this.onChanged,
  });

  final String field;
  final dynamic value;
  final ConfigFieldDefinition? def;
  final String? error;
  final bool enabled;
  final ValueChanged<String> onChanged;

  @override
  State<_ParamRow> createState() => _ParamRowState();
}

class _ParamRowState extends State<_ParamRow> {
  // ของแถวนี้เอง สร้างครั้งเดียวจากค่าเดิม — ไม่สร้างใหม่ทุกครั้งที่พิมพ์ (เคอร์เซอร์ไม่กระโดด)
  late final TextEditingController _controller = TextEditingController(
    text: configValueToInput(widget.value),
  );

  /// ค่าที่เลือกอยู่ของสวิตช์/ตัวเลือก (boolean, allowedValues) — ไม่ต้องพิมพ์เอง
  late String _choice = configValueToInput(widget.value);

  void _choose(String value) {
    setState(() => _choice = value);
    widget.onChanged(value);
  }

  /// ช่องแก้ค่าตามชนิด: boolean = สวิตช์เปิด/ปิด · มีค่าที่อนุญาต = เลือกจากรายการ ·
  /// อื่นๆ = พิมพ์
  Widget _input(ConfigFieldDefinition? def) {
    final key = Key('apply_param_${widget.field}');
    if (def?.dataType == 'boolean') {
      final on = _choice == 'true';
      return Row(
        children: [
          Switch(
            key: key,
            value: on,
            onChanged: widget.enabled ? (v) => _choose('$v') : null,
          ),
          const SizedBox(width: 8),
          Text(
            on ? 'เปิด' : 'ปิด',
            style: const TextStyle(
              fontSize: AppTypography.sm,
              height: AppTypography.smHeight,
              color: AppColors.foreground,
            ),
          ),
        ],
      );
    }
    final allowed = def?.allowedValues ?? const <String>[];
    if (allowed.isNotEmpty) {
      return DropdownButtonFormField<String>(
        key: key,
        initialValue: allowed.contains(_choice) ? _choice : null,
        isExpanded: true,
        decoration: const InputDecoration(
          isDense: true,
          filled: true,
          fillColor: AppColors.card,
        ),
        items: [
          for (final v in allowed) DropdownMenuItem(value: v, child: Text(v)),
        ],
        onChanged: widget.enabled
            ? (v) {
                if (v != null) _choose(v);
              }
            : null,
      );
    }
    return TextField(
      key: key,
      controller: _controller,
      enabled: widget.enabled,
      obscureText: def?.sensitive != false,
      onChanged: widget.onChanged,
      decoration: const InputDecoration(
        isDense: true,
        filled: true,
        fillColor: AppColors.card,
      ),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final def = widget.def;
    final editable = def?.stOverridable ?? false;
    final label = def?.description?.trim();
    const muted = TextStyle(
      fontSize: AppTypography.xs,
      height: AppTypography.xsHeight,
      color: AppColors.mutedForeground,
    );
    final name = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null && label.isNotEmpty)
          Text(
            label,
            style: const TextStyle(
              fontSize: AppTypography.sm,
              height: AppTypography.smHeight,
              fontWeight: FontWeight.w500,
              color: AppColors.foreground,
            ),
          ),
        Text(
          widget.field,
          style: muted.copyWith(fontFamily: AppTypography.monoFamily),
        ),
      ],
    );
    final Widget value = editable
        ? Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _input(def),
              if (widget.error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    widget.error!,
                    key: Key('apply_param_error_${widget.field}'),
                    style: muted.copyWith(color: AppColors.destructive),
                  ),
                ),
            ],
          )
        : Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                def?.sensitive != false
                    ? '••••'
                    : def?.dataType == 'boolean' && widget.value is bool
                    ? (widget.value as bool ? 'เปิด' : 'ปิด')
                    : configValueToInput(widget.value),
                style: muted.copyWith(
                  fontFamily: AppTypography.monoFamily,
                  color: AppColors.foreground,
                ),
              ),
              const SizedBox(height: 2),
              const Text('(แก้ไขไม่ได้)', style: muted),
            ],
          );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(flex: 2, child: name),
          const SizedBox(width: 8),
          Expanded(flex: 3, child: value),
        ],
      ),
    );
  }
}
