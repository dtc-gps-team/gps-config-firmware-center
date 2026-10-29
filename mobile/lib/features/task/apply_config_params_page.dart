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
import '../../core/ui/app_field_label.dart';
import '../../core/ui/app_ink_header.dart';
import '../../core/ui/app_notice.dart';
import '../../core/ui/app_role_locked_view.dart';
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
/// แก้ค่าได้เฉพาะ ST (`device-config-override:Override` — RBAC_Matrix) · OT เห็นทุกค่า
/// แบบอ่านอย่างเดียวและส่ง Config ตามเดิมได้ · role อื่นเห็นหน้าไม่มีสิทธิ์ (R4-05)
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

  /// error รายช่องจากการกดครั้งล่าสุด — พิมพ์ใหม่แล้วล้าง
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

  /// ทำงานที่เรียก backend — error ของ backend แสดงเหนือปุ่ม · ระหว่างนี้ปุ่ม
  /// กดไม่ได้ (กันส่งซ้ำ)
  Future<void> _run(Future<void> Function() action) async {
    if (_submitting) return;
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

  /// แก้ค่า — ตรวจค่า + เหตุผลตอนกด (ปุ่มไม่เทาเมื่อค่าผิด ช่างจะเห็นเหตุผลใต้ช่อง ·
  /// มติล็อก r4 ข้อยกเว้นภาพ 1272) แล้วขออนุมัติผ่าน Override ของ Config นี้
  Future<void> _submitEdits(
    ApplyOptionConfig config,
    Map<String, ConfigFieldDefinition> defByName,
  ) async {
    final (:parsed, :errors) = _checkEdits(config, defByName);
    final reason = _reasonController.text.trim();
    setState(() {
      _paramErrors = errors;
      _reasonError = reason.isEmpty ? 'กรุณากรอกเหตุผลที่แก้ค่า' : null;
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

  /// ตรวจค่าที่แก้ (ชนิด + ช่วง min/max ของคลัง Parameter — backend ตรวจซ้ำเสมอ) ·
  /// คืนค่าที่ parse แล้ว และ error รายช่อง
  ({Map<String, dynamic> parsed, Map<String, String> errors}) _checkEdits(
    ApplyOptionConfig config,
    Map<String, ConfigFieldDefinition> defByName,
  ) {
    final parsed = <String, dynamic>{};
    final errors = <String, String>{};
    for (final entry in _changedFields(config).entries) {
      final def = defByName[entry.key];
      final result = parseConfigValue(entry.value, def?.dataType ?? 'string');
      final error =
          result.error ??
          configRangeError(
            result.value,
            def?.minValue,
            def?.maxValue,
            def?.unit,
          );
      if (error != null) {
        errors[entry.key] = error;
      } else {
        parsed[entry.key] = result.value;
      }
    }
    return (parsed: parsed, errors: errors);
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
    final config = options?.configs
        .where((c) => c.id == widget.configId)
        .firstOrNull;
    // นิยามพารามิเตอร์ (แก้ได้ไหม/ชื่อเรียกง่าย/ชนิด/ช่วง) — โหลดไม่ได้ = แก้ไม่ได้ทุกช่อง
    final defByName = {
      if (config != null)
        for (final def
            in ref.watch(configFieldDefinitionListProvider).valueOrNull ??
                const <ConfigFieldDefinition>[])
          def.fieldName: def,
    };
    final navigator = Navigator.of(context);

    return AppV2Theme(
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AppInkHeader(
              title: config?.name ?? 'พารามิเตอร์ของ Config',
              subtitle: locked
                  ? null
                  : config != null && config.latestVersion > 0
                  ? '${widget.deviceId} · เวอร์ชัน ${config.latestVersion}'
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
                                : 'โหลดพารามิเตอร์ไม่สำเร็จ',
                            messageKey: const Key('apply_params_error'),
                            retryKey: const Key('apply_params_retry'),
                            onRetry: () => ref.invalidate(
                              deviceApplyOptionsProvider(widget.deviceId),
                            ),
                          ),
                        ],
                      ),
                      data: (options) => _buildForm(
                        options,
                        config,
                        defByName,
                        canEdit: role == UserRole.st,
                      ),
                    ),
            ),
            if (options != null && config != null)
              _actions(options, config, defByName),
          ],
        ),
      ),
    );
  }

  Widget _buildForm(
    DeviceApplyOptions options,
    ApplyOptionConfig? config,
    Map<String, ConfigFieldDefinition> defByName, {
    required bool canEdit,
  }) {
    if (config == null) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
        children: const [
          AppNotice(
            key: Key('apply_params_not_found'),
            tone: AppBadgeTone.warning,
            icon: Icons.info_outline,
            child: Text(
              'Config นี้ส่งเข้ากล่องนี้ไม่ได้ — ไม่อยู่ในรายการ Config ที่อนุมัติ'
              'แล้วสำหรับรุ่นของกล่อง กลับไปเลือกใหม่ หรือแจ้ง Operation',
            ),
          ),
        ],
      );
    }
    final edited = _changedFields(config).isNotEmpty;

    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
      children: [
        Text(
          canEdit
              ? 'ไม่แก้ค่า = ส่งเข้ากล่องได้ทันที · แก้ค่า = ต้องรอ Operation '
                    'อนุมัติก่อน แล้วกดส่งที่หน้างาน'
              : 'ตรวจค่าแล้วส่งเข้ากล่องได้ทันที · การขอแก้ค่าเฉพาะเครื่องทำได้'
                    'เฉพาะ ST',
          style: const TextStyle(
            fontSize: AppTypography.xs,
            height: AppTypography.xsHeight,
            color: AppColors.mutedForeground,
          ),
        ),
        const SizedBox(height: 12),
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
            canEdit: canEdit,
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
            minLines: 3,
            maxLines: 5,
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
      ],
    );
  }

  /// แถบล่าง: error ของ backend อยู่เหนือปุ่ม เห็นทันทีที่กด
  Widget _actions(
    DeviceApplyOptions options,
    ApplyOptionConfig config,
    Map<String, ConfigFieldDefinition> defByName,
  ) {
    final edited = _changedFields(config).isNotEmpty;
    // คำขอของงานนี้เองที่ค้าง หน้างานไม่เปิดมาที่นี่อยู่แล้ว — ค้างอยู่ = ของงานอื่น
    // หรือเปิดจากหน้ากล่อง (backend ตอบ 409 ถ้าขอซ้ำ)
    final blocked = !options.deviceInstalled || options.openRequest != null;
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
          label: edited ? 'ขออนุมัติค่าที่แก้' : 'ส่งเข้ากล่อง',
          submitting: _submitting,
          onPressed: blocked
              ? null
              : edited
              ? () => _submitEdits(config, defByName)
              : _submitDirect,
        ),
      ],
    );
  }
}

/// พารามิเตอร์ทุกค่าของ Config — ค่าที่ช่างแก้ได้ (`stOverridable` และเป็น ST) มี
/// ช่องกรอกเต็มความกว้าง ที่เหลือแสดงค่า + "(แก้ไขไม่ได้)" · ชื่อเรียกง่ายจาก
/// `description` อยู่บนชื่อจริง (ภาพ r4 1259)
class _ConfigParams extends StatelessWidget {
  const _ConfigParams({
    required this.config,
    required this.defByName,
    required this.errors,
    required this.canEdit,
    required this.enabled,
    required this.onChanged,
  });

  final ApplyOptionConfig config;
  final Map<String, ConfigFieldDefinition> defByName;
  final Map<String, String> errors;
  final bool canEdit;
  final bool enabled;
  final void Function(String field, String value) onChanged;

  @override
  Widget build(BuildContext context) {
    final entries = config.fields.entries.toList(growable: false);
    return Container(
      key: const Key('apply_params'),
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final entry in entries)
            _ParamRow(
              key: Key('apply_param_row_${entry.key}'),
              field: entry.key,
              value: entry.value,
              def: defByName[entry.key],
              editable:
                  canEdit && (defByName[entry.key]?.stOverridable ?? false),
              error: errors[entry.key],
              enabled: enabled,
              onChanged: (v) => onChanged(entry.key, v),
            ),
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
    required this.editable,
    required this.error,
    required this.enabled,
    required this.onChanged,
  });

  final String field;
  final dynamic value;
  final ConfigFieldDefinition? def;
  final bool editable;
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

  static const _valueStyle = TextStyle(
    fontSize: AppTypography.sm,
    height: AppTypography.smHeight,
    color: AppColors.foreground,
  );

  /// ช่องแก้ค่าตามชนิด: boolean = สวิตช์เปิด/ปิด · มีค่าที่อนุญาต = เลือกจากรายการ ·
  /// อื่นๆ = พิมพ์ (error ของช่องขึ้นใต้ช่องทันทีที่พิมพ์)
  Widget _input(ConfigFieldDefinition? def) {
    final key = Key('apply_param_${widget.field}');
    if (def?.dataType == 'boolean') {
      final on = _choice == 'true';
      return Row(
        children: [
          Expanded(child: Text(on ? 'เปิด' : 'ปิด', style: _valueStyle)),
          Switch(
            key: key,
            value: on,
            onChanged: widget.enabled ? (v) => _choose('$v') : null,
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
      decoration: InputDecoration(
        filled: true,
        fillColor: AppColors.card,
        // ข้อความ error แยกไว้ใต้ช่อง (มี key ให้เทสต์) — ตรงนี้แค่ทำขอบเป็นสีแดง
        errorText: widget.error == null ? null : '',
        errorStyle: const TextStyle(height: 0, fontSize: 0),
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
    final label = def?.description?.trim();
    const muted = TextStyle(
      fontSize: AppTypography.xs,
      height: AppTypography.xsHeight,
      color: AppColors.mutedForeground,
    );
    final readOnlyValue = def?.sensitive != false
        ? '••••'
        : def?.dataType == 'boolean' && widget.value is bool
        ? (widget.value as bool ? 'เปิด' : 'ปิด')
        : configValueToInput(widget.value);
    final error = widget.error;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (label != null && label.isNotEmpty)
            Text(
              label,
              style: const TextStyle(
                fontSize: AppTypography.sm,
                height: AppTypography.smHeight,
                fontWeight: FontWeight.w600,
                color: AppColors.foreground,
              ),
            ),
          Text(
            widget.field,
            style: muted.copyWith(fontFamily: AppTypography.monoFamily),
          ),
          const SizedBox(height: 8),
          if (widget.editable) ...[
            _input(def),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  error,
                  key: Key('apply_param_error_${widget.field}'),
                  style: muted.copyWith(
                    color: AppColors.destructive,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
          ] else
            Wrap(
              spacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  readOnlyValue,
                  style: _valueStyle.copyWith(color: AppColors.mutedForeground),
                ),
                const Text('(แก้ไขไม่ได้)', style: muted),
              ],
            ),
        ],
      ),
    );
  }
}
