import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_error_view.dart';
import 'config_override_repository.dart';

/// parse ค่าจาก input (string เสมอ) กลับเป็นชนิดข้อมูลตาม dataType ของ field —
/// mirror `parseByDataType` ฝั่ง Web (`config-override-panel.tsx`).
dynamic _parseByDataType(String raw, String dataType) {
  if (dataType == 'number') {
    final n = num.tryParse(raw);
    return n ?? raw;
  }
  if (dataType == 'boolean') {
    return raw == 'true';
  }
  return raw;
}

String _toInputValue(dynamic value) {
  if (value == null) return '';
  return value.toString();
}

/// Config Override — Phase 2 (Mobile, issue #211), per-device (issue #223).
/// เข้าได้เฉพาะ role ST (เช็คที่ entry point ใน `device_detail_page.dart`) —
/// ให้ ST แก้ค่าบาง field ของ Config ปัจจุบันของ**อุปกรณ์เครื่องนี้เครื่อง
/// เดียว** ไม่ผ่าน Approval Center ปกติ และไม่กระทบอุปกรณ์อื่นที่ใช้ Config
/// เดียวกัน (`POST /devices/{deviceId}/config-override` — ต่างจาก
/// `POST /config/{configId}/override` เดิมที่ Web ยังใช้อยู่ ดู
/// `ConfigOverrideRepository`) mirror UX ของ
/// `web/src/app/(app)/config/config-override-panel.tsx` ทุกจุด: แสดงทุก
/// field, เฉพาะ `stOverridable: true` แก้ได้ตาม dataType, เหตุผลบังคับกรอก,
/// ต้องมีอย่างน้อย 1 field เปลี่ยนค่าก่อน submit ได้, ไม่มี confirm dialog
/// เพิ่ม (submit ตรงๆ เหมือน Web).
class ConfigOverridePage extends ConsumerStatefulWidget {
  const ConfigOverridePage({super.key, required this.deviceId});

  final String deviceId;

  @override
  ConsumerState<ConfigOverridePage> createState() => _ConfigOverridePageState();
}

class _ConfigOverridePageState extends ConsumerState<ConfigOverridePage> {
  final Map<String, String> _edits = {};
  final Set<String> _revealed = {};
  final _reasonController = TextEditingController();
  bool _submitting = false;
  String? _error;
  List<String> _errorList = const [];

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit(
    DeviceConfigDraft config,
    Map<String, ConfigFieldDefinition> defByName,
  ) async {
    if (_submitting) return;
    setState(() {
      _error = null;
      _errorList = const [];
    });

    final reason = _reasonController.text.trim();
    if (reason.isEmpty) {
      setState(() => _error = 'กรอกเหตุผลก่อน override');
      return;
    }

    final changed = <String, dynamic>{};
    for (final entry in (config.fields ?? const {}).entries) {
      final def = defByName[entry.key];
      if (def == null || !def.stOverridable) continue;
      final rawEdit = _edits[entry.key];
      if (rawEdit == null) continue;
      if (rawEdit == _toInputValue(entry.value)) continue;
      changed[entry.key] = _parseByDataType(rawEdit, def.dataType);
    }

    if (changed.isEmpty) {
      setState(() => _error = 'ยังไม่ได้แก้ค่าไหนเลย');
      return;
    }

    setState(() => _submitting = true);
    try {
      await ref
          .read(configOverrideRepositoryProvider)
          .overrideConfig(
            deviceId: widget.deviceId,
            fields: changed,
            reason: reason,
          );
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _edits.clear();
        _reasonController.clear();
      });
      ref.invalidate(currentConfigProvider(widget.deviceId));
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Override สำเร็จ — ค่าถูกเปลี่ยนแล้ว')),
      );
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
    final configAsync = ref.watch(currentConfigProvider(widget.deviceId));
    final definitionsAsync = ref.watch(configFieldDefinitionListProvider);

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('Override ค่าพารามิเตอร์'),
      ),
      body: configAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => AppErrorView(
          message: _configErrorMessage(error),
          messageKey: const Key('config_override_load_error'),
          retryKey: const Key('config_override_load_retry'),
          onRetry: () {
            ref.invalidate(currentConfigProvider(widget.deviceId));
            ref.invalidate(configFieldDefinitionListProvider);
          },
        ),
        data: (config) => definitionsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => AppErrorView(
            message: 'โหลดข้อมูล Parameter ไม่สำเร็จ',
            messageKey: const Key('config_override_load_error'),
            retryKey: const Key('config_override_load_retry'),
            onRetry: () => ref.invalidate(configFieldDefinitionListProvider),
          ),
          data: (definitions) {
            final defByName = {for (final d in definitions) d.fieldName: d};
            return _OverrideForm(
              config: config,
              defByName: defByName,
              edits: _edits,
              revealed: _revealed,
              reasonController: _reasonController,
              submitting: _submitting,
              error: _error,
              errorList: _errorList,
              onEdit: (key, value) => setState(() => _edits[key] = value),
              onToggleReveal: (key) => setState(() {
                if (!_revealed.remove(key)) _revealed.add(key);
              }),
              onSubmit: () => _submit(config, defByName),
            );
          },
        ),
      ),
    );
  }

  static String _configErrorMessage(Object error) {
    if (error is ApiException) {
      if (error.statusCode == 404) {
        return 'อุปกรณ์นี้ยังไม่มี Config ที่ยืนยันติดตั้งแล้ว';
      }
      if (error.statusCode == 403) {
        return 'ไม่มีสิทธิ์ override Config ของอุปกรณ์นี้';
      }
      return error.message;
    }
    return 'โหลด Config ปัจจุบันของอุปกรณ์ไม่สำเร็จ';
  }
}

class _OverrideForm extends StatelessWidget {
  const _OverrideForm({
    required this.config,
    required this.defByName,
    required this.edits,
    required this.revealed,
    required this.reasonController,
    required this.submitting,
    required this.error,
    required this.errorList,
    required this.onEdit,
    required this.onToggleReveal,
    required this.onSubmit,
  });

  final DeviceConfigDraft config;
  final Map<String, ConfigFieldDefinition> defByName;
  final Map<String, String> edits;
  final Set<String> revealed;
  final TextEditingController reasonController;
  final bool submitting;
  final String? error;
  final List<String> errorList;
  final ValueChanged<String> onToggleReveal;
  final void Function(String key, String value) onEdit;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final fieldEntries = (config.fields ?? const <String, dynamic>{}).entries
        .toList(growable: false);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                config.name ??
                    '${config.deviceModel ?? '?'}/${config.protocol ?? '?'}',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.textPrimary,
                ),
              ),
            ),
            if (config.hasDeviceOverride) ...[
              const SizedBox(width: 8),
              const _DeviceOverrideBadge(),
            ],
          ],
        ),
        const SizedBox(height: 4),
        // issue #223 ตัดสินใจแล้วว่า override เป็น**รายเครื่อง**
        // (POST /devices/{deviceId}/config-override, ไม่ใช่
        // POST /config/{configId}/override เดิมที่แก้ Config ทั้งชุด) —
        // ข้อความนี้เลยยืนยันได้ตรงๆ ว่าไม่กระทบเครื่องอื่น ต่างจากข้อความชั่วคราว
        // เดิมของ PR #222 ที่เตือนว่ากระทบทั้งระบบ (ตอนนั้นยังใช้ endpoint เดิม)
        const Text(
          'ค่านี้จะแก้เฉพาะอุปกรณ์เครื่องนี้เท่านั้น ไม่กระทบอุปกรณ์เครื่องอื่นที่ '
          'ใช้ Config เดียวกัน — ต้องระบุเหตุผลทุกครั้งและถูกบันทึกลง Audit Log '
          'แบบไม่มีข้อยกเว้น',
          style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
        ),
        const SizedBox(height: 16),
        Container(
          decoration: BoxDecoration(
            color: AppTheme.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.fieldBorder),
          ),
          child: Column(
            children: [
              for (final entry in fieldEntries)
                _FieldRow(
                  key: Key('config_override_field_${entry.key}'),
                  fieldKey: entry.key,
                  originalValue: entry.value,
                  def: defByName[entry.key],
                  editValue: edits[entry.key],
                  revealed: revealed.contains(entry.key),
                  onToggleReveal: () => onToggleReveal(entry.key),
                  onChanged: (v) => onEdit(entry.key, v),
                ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        const Text(
          'เหตุผล (บังคับ)',
          style: TextStyle(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        TextField(
          key: const Key('config_override_reason_input'),
          controller: reasonController,
          maxLength: 500,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: 'เช่น ลูกค้าขอเปลี่ยนค่าหน้างาน / แก้ไขข้อผิดพลาดที่พบ',
            filled: true,
            fillColor: AppTheme.surface,
          ),
        ),
        if (error != null) ...[
          const SizedBox(height: 8),
          Container(
            key: const Key('config_override_error'),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppTheme.error.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: AppTheme.error.withValues(alpha: 0.4)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(error!, style: const TextStyle(color: AppTheme.error)),
                for (final msg in errorList)
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
        const SizedBox(height: 16),
        FilledButton(
          key: const Key('config_override_submit'),
          onPressed: submitting ? null : onSubmit,
          child: submitting
              ? const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation(Colors.white),
                  ),
                )
              : const Text('ยืนยัน Override'),
        ),
      ],
    );
  }
}

class _FieldRow extends StatefulWidget {
  const _FieldRow({
    super.key,
    required this.fieldKey,
    required this.originalValue,
    required this.def,
    required this.editValue,
    required this.revealed,
    required this.onToggleReveal,
    required this.onChanged,
  });

  final String fieldKey;
  final dynamic originalValue;
  final ConfigFieldDefinition? def;
  final String? editValue;
  final bool revealed;
  final VoidCallback onToggleReveal;
  final ValueChanged<String> onChanged;

  @override
  State<_FieldRow> createState() => _FieldRowState();
}

class _FieldRowState extends State<_FieldRow> {
  // Owned by this row (keyed by fieldKey — see the `for` loop that builds
  // these) so the Element/State survives sibling rebuilds triggered by
  // editing *other* fields. Created once from the field's starting value;
  // never overwritten from `widget.editValue` afterwards, since that value
  // originates from this same controller's `onChanged` in the first place —
  // rebuilding it from a fresh `TextEditingController(text: ...)` on every
  // keystroke (the previous, stateless version of this widget) reset the
  // cursor position and dropped focus after each character typed.
  late final TextEditingController _controller = TextEditingController(
    text: widget.editValue ?? _toInputValue(widget.originalValue),
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final currentValue =
        widget.editValue ?? _toInputValue(widget.originalValue);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppTheme.fieldBorder)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            flex: 2,
            child: Text(
              widget.fieldKey,
              style: const TextStyle(
                fontSize: 12,
                fontFamily: 'monospace',
                color: AppTheme.textSecondary,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(flex: 3, child: _buildValue(currentValue)),
        ],
      ),
    );
  }

  Widget _buildValue(String currentValue) {
    final def = widget.def;
    final revealed = widget.revealed;
    final fieldKey = widget.fieldKey;

    if (def == null || !def.stOverridable) {
      final masked = def?.sensitive == true && !revealed;
      final display = masked ? '••••••' : currentValue;
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: Text(
              display,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 12,
                fontFamily: 'monospace',
                color: AppTheme.textSecondary,
              ),
            ),
          ),
          if (def?.sensitive == true)
            IconButton(
              iconSize: 16,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(),
              onPressed: widget.onToggleReveal,
              icon: Icon(
                revealed
                    ? Icons.visibility_off_outlined
                    : Icons.visibility_outlined,
              ),
            ),
          const SizedBox(width: 4),
          const Text(
            '(override ไม่ได้)',
            style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
          ),
        ],
      );
    }

    if (def.dataType == 'boolean') {
      final safeValue = currentValue == 'true' || currentValue == 'false'
          ? currentValue
          : null;
      return DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          key: Key('config_override_input_$fieldKey'),
          value: safeValue,
          isExpanded: true,
          hint: const Text('เลือกค่า'),
          items: const [
            DropdownMenuItem(value: 'true', child: Text('true')),
            DropdownMenuItem(value: 'false', child: Text('false')),
          ],
          onChanged: (v) => v == null ? null : widget.onChanged(v),
        ),
      );
    }

    if (def.allowedValues.isNotEmpty) {
      final safeValue = def.allowedValues.contains(currentValue)
          ? currentValue
          : null;
      return DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          key: Key('config_override_input_$fieldKey'),
          value: safeValue,
          isExpanded: true,
          hint: const Text('เลือกค่า'),
          items: [
            for (final v in def.allowedValues)
              DropdownMenuItem(value: v, child: Text(v)),
          ],
          onChanged: (v) => v == null ? null : widget.onChanged(v),
        ),
      );
    }

    return TextField(
      key: Key('config_override_input_$fieldKey'),
      controller: _controller,
      obscureText: def.sensitive && !revealed,
      keyboardType: def.dataType == 'number'
          ? const TextInputType.numberWithOptions(decimal: true)
          : TextInputType.text,
      decoration: InputDecoration(
        isDense: true,
        border: const OutlineInputBorder(),
        suffixIcon: def.sensitive
            ? IconButton(
                iconSize: 16,
                onPressed: widget.onToggleReveal,
                icon: Icon(
                  revealed
                      ? Icons.visibility_off_outlined
                      : Icons.visibility_outlined,
                ),
              )
            : null,
      ),
      onChanged: widget.onChanged,
    );
  }
}

/// บอกช่างว่าอุปกรณ์เครื่องนี้มี override เฉพาะเครื่องอยู่แล้ว (issue #223) —
/// ค่าที่เห็นในฟอร์มด้านล่างจึงไม่ใช่ base Config ล้วนๆ (`hasDeviceOverride`
/// จาก `GET /devices/{deviceId}/config`).
class _DeviceOverrideBadge extends StatelessWidget {
  const _DeviceOverrideBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('config_override_has_override_badge'),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: AppTheme.mockAccentSoft,
        borderRadius: BorderRadius.circular(999),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.tune, size: 12, color: AppTheme.mockAccent),
          SizedBox(width: 4),
          Text(
            'มี override เครื่องนี้',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: AppTheme.mockAccent,
            ),
          ),
        ],
      ),
    );
  }
}
