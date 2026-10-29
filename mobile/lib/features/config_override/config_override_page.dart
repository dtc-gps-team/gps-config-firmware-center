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
import '../../core/ui/app_sensitive_value.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/widgets/app_error_view.dart';
import '../../core/widgets/text_scale.dart';
import '../task/apply_mode_provider.dart';
import '../task/config_apply_request_repository.dart';
import 'config_override_repository.dart';
import 'config_value_parser.dart';

/// Config Override — Phase 2 (Mobile, issue #211), per-device (issue #223).
/// เข้าได้เฉพาะ role ST (เช็คที่ entry point ใน `device_detail_page.dart`) —
/// ให้ ST**ส่งคำขอ**แก้ค่าบาง field ของ Config ปัจจุบันของ**อุปกรณ์เครื่องนี้
/// เครื่องเดียว** ไม่กระทบอุปกรณ์อื่นที่ใช้ Config เดียวกัน
/// (`POST /devices/{deviceId}/config-override` — ต่างจาก
/// `POST /config/{configId}/override` เดิมที่ Web ยังใช้อยู่ ดู
/// `ConfigOverrideRepository`) **มติ 2026-09-24 (PR #225): ต้องผ่าน Operation
/// อนุมัติก่อนถึงมีผลจริง** ไม่ใช่ apply ทันทีเหมือนที่เคยเป็น — ดู
/// `_PendingOverrideBanner` mirror UX ของ
/// `web/src/app/(app)/config/config-override-panel.tsx` ทุกจุด: แสดงทุก
/// field, เฉพาะ `stOverridable: true` แก้ได้ตาม dataType, เหตุผลบังคับกรอก,
/// ต้องมีอย่างน้อย 1 field เปลี่ยนค่าก่อน submit ได้, ไม่มี confirm dialog
/// เพิ่ม (submit ตรงๆ เหมือน Web).
///
/// design system ใหม่ (docs/22 Batch 4): หัวหน้าจอ "Config Override" ตาม Web (§6.2)
/// + ชื่อ Config ใน meta + ป้าย "มี override เครื่องนี้" เป็น status · ค่า `sensitive`
/// ใช้ `AppSensitiveValue` / `AppRevealToggle` (ซ่อนเป็นค่าเริ่มต้น ปุ่มรูปตามี label,
/// docs/21 #20) · แถบคำขอที่รออนุมัติ / error เป็น `AppNotice` · ตรรกะ/การเรียก API เหมือนเดิม
class ConfigOverridePage extends ConsumerStatefulWidget {
  const ConfigOverridePage({super.key, required this.deviceId});

  final String deviceId;

  /// docs/30 §6 — ข้อความหลังส่งในโหมด central (Override = คำขอส่งเข้ากล่อง)
  static const centralSubmittedMessage =
      'ส่งคำขอแล้ว รอ Operation อนุมัติ แล้วกดส่งเข้ากล่องจากหน้างาน';

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
  // error รายช่อง (fieldName -> ข้อความ) จากการ parse ตาม dataType ก่อนส่ง
  final Map<String, String> _fieldErrors = {};
  // error ใต้ช่องเหตุผล (UX audit #16 — แสดงพร้อม error ของช่องอื่นในรอบเดียว)
  String? _reasonError;

  static const _reasonRequired = 'กรอกเหตุผลก่อน override';

  /// UX audit #17 — คำขอ override ไม่เข้าคิว sync (ต่างจากการเปลี่ยนสถานะงาน)
  /// ไม่มี HTTP response ต้องบอกให้ชัดว่าส่งไม่สำเร็จและต้องกดส่งเอง ผู้ใช้
  /// จะได้ไม่คิดว่าระบบจะส่งให้เองเมื่อเน็ตกลับมา · ค่าในฟอร์มไม่ถูกล้าง ·
  /// ไม่ยืนยันว่า "ยังไม่ได้ส่ง" เพราะกรณี receive timeout คำขออาจถึง server
  /// แล้ว (รีวิว A บน #333) กดส่งซ้ำจะได้ 409 จึงปลอดภัย
  static const offlineMessage =
      'ส่งไม่สำเร็จ ต้องใช้อินเทอร์เน็ต ค่าที่กรอกไว้ยังอยู่ในฟอร์ม '
      'ลองกดส่งอีกครั้ง';

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
      _fieldErrors.clear();
      _reasonError = null;
    });

    // ตรวจทุกช่องก่อนแล้วค่อยแสดง error ทั้งหมดพร้อมกัน (UX audit #16 — เดิม
    // เหตุผลว่างแล้ว return ทันที error ของช่องค่าไม่ขึ้นจนกว่าจะกดส่งรอบสอง)
    final reason = _reasonController.text.trim();
    final reasonError = reason.isEmpty ? _reasonRequired : null;

    final changed = <String, dynamic>{};
    final fieldErrors = <String, String>{};
    for (final entry in (config.fields ?? const {}).entries) {
      final def = defByName[entry.key];
      if (def == null || !def.stOverridable) continue;
      final rawEdit = _edits[entry.key];
      if (rawEdit == null) continue;
      if (rawEdit == configValueToInput(entry.value)) continue;
      // parse ตาม dataType — ไม่ผ่านต้องขึ้น error ที่ฟอร์ม ไม่ throw และไม่
      // ส่งค่าดิบ (string) ไปให้ backend ตีกลับ 400
      final parsed = parseConfigValue(rawEdit, def.dataType);
      if (!parsed.isOk) {
        fieldErrors[entry.key] = parsed.error!;
        continue;
      }
      // docs/30 — ช่วงค่าตัวเลขจากคลัง Parameter (backend ตรวจซ้ำ)
      final outOfRange = configRangeError(
        parsed.value,
        def.minValue,
        def.maxValue,
        def.unit,
      );
      if (outOfRange != null) {
        fieldErrors[entry.key] = outOfRange;
      } else {
        changed[entry.key] = parsed.value;
      }
    }

    if (reasonError != null || fieldErrors.isNotEmpty || changed.isEmpty) {
      setState(() {
        _reasonError = reasonError;
        _fieldErrors.addAll(fieldErrors);
        if (fieldErrors.isNotEmpty) {
          _error = 'ค่าบางช่องไม่ถูกต้อง แก้ไขแล้วลองอีกครั้ง';
          _errorList = [
            for (final e in fieldErrors.entries) '${e.key}: ${e.value}',
          ];
        } else if (changed.isEmpty) {
          _error = 'ยังไม่ได้แก้ค่าไหนเลย';
        } else {
          // เหลือแค่เหตุผลว่าง — ข้อความจริงอยู่ใต้ช่องเหตุผลแล้ว
          _error = 'กรอกข้อมูลไม่ครบ ดูช่องที่มีข้อความสีแดง';
        }
      });
      return;
    }

    final central = ref.read(centralApplyModeProvider).valueOrNull ?? false;
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
      if (central) {
        await _goToRequestTask();
        return;
      }
      // มติ 2026-09-24 (PR #225): ส่งคำขอสำเร็จเท่านั้น ยังไม่มีผลจริง —
      // ข้อความจึงเปลี่ยนจาก "Override สำเร็จ" เดิม (ตอนที่ยัง apply ทันที)
      // เป็นสถานะ "รอ Operation อนุมัติ" แทน ไม่ให้ ST เข้าใจผิดว่าเสร็จแล้ว
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('ส่งคำขอแล้ว รอ Operation อนุมัติ')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      final offline = e.statusCode == null;
      setState(() {
        _submitting = false;
        _error = offline ? offlineMessage : e.message;
        _errorList = offline ? const [] : e.details;
      });
    }
  }

  /// docs/30 §6 — โหมด central: Override กลายเป็นคำขอส่งเข้ากล่องในงานของช่าง
  /// ไปที่หน้างานนั้นเลย (ติดตาม/กดส่งที่นั่น) · งานหาจาก `openRequest` ของ
  /// apply-options (backend ไม่คืน taskId ใน response ของ Override) · หาไม่เจอ
  /// หรือโหลดไม่ได้ = อยู่หน้าเดิมพร้อมข้อความ ไม่ถือว่าส่งไม่สำเร็จ
  Future<void> _goToRequestTask() async {
    String? taskId;
    try {
      final options = await ref
          .read(configApplyRequestRepositoryProvider)
          .applyOptions(widget.deviceId);
      taskId = options.openRequest?.taskId;
    } on Object {
      taskId = null;
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text(ConfigOverridePage.centralSubmittedMessage)),
    );
    if (taskId != null) {
      context.pushReplacement(AppRoutes.taskDetail(taskId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final central = ref.watch(centralApplyModeProvider).valueOrNull ?? false;
    final configAsync = ref.watch(currentConfigProvider(widget.deviceId));
    final definitionsAsync = ref.watch(configFieldDefinitionListProvider);
    final navigator = Navigator.of(context);
    final config = configAsync.valueOrNull;

    return AppV2Theme(
      child: Scaffold(
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppPageHeader(
                title: 'Config Override',
                onBack: navigator.canPop() ? navigator.pop : null,
                // ข้อความนี้ยืนยัน 2 เรื่อง: (1) issue #223 ตัดสินใจแล้วว่า override
                // เป็น**รายเครื่อง** (POST /devices/{deviceId}/config-override ไม่ใช่
                // POST /config/{configId}/override เดิมที่แก้ Config ทั้งชุด) จึงไม่
                // กระทบเครื่องอื่น (2) **แก้ตามรีวิว A บน PR #225 (มติ 2026-09-24)**:
                // เปลี่ยนจากข้อความเดิมที่บอกว่า override มีผลทันที เป็นบอกตรงๆ ว่า
                // ต้องผ่าน Operation อนุมัติก่อน แล้วช่างต้องกด "ใส่ Config เข้าเครื่อง"
                // ต่อเองอีกครั้ง (apply-config ยังไม่ automation ในรอบนี้)
                // docs/30 §6 — โหมด central ค่าไปถึงกล่องผ่านคำขอส่งเข้ากล่อง
                description: central
                    ? 'ค่านี้แก้เฉพาะอุปกรณ์เครื่องนี้ · ส่งแล้วเป็นคำขอส่งเข้ากล่อง รอ '
                          'Operation อนุมัติ แล้วกดส่งเข้ากล่องจากหน้างาน · ต้องระบุ'
                          'เหตุผลและถูกบันทึกลง Audit Log ทุกครั้ง'
                    : 'ค่านี้แก้เฉพาะอุปกรณ์เครื่องนี้ · ต้องรอ Operation อนุมัติ แล้วใส่ '
                          'Config เข้าเครื่องอีกครั้งจึงจะมีผล · ต้องระบุเหตุผลและถูกบันทึกลง '
                          'Audit Log ทุกครั้ง',
                // issue #223 — ค่าที่เห็นในฟอร์มไม่ใช่ base Config ล้วนๆ
                // (`hasDeviceOverride` = true เฉพาะคำขอที่ Operation อนุมัติแล้ว)
                status: config != null && config.hasDeviceOverride
                    ? const AppBadge(
                        key: Key('config_override_has_override_badge'),
                        label: 'มี override เครื่องนี้',
                        tone: AppBadgeTone.info,
                        dot: true,
                      )
                    : null,
                meta: [
                  if (config != null)
                    AppPageHeaderMeta(
                      label: 'Config',
                      value:
                          config.name ??
                          '${config.deviceModel ?? '?'}/${config.protocol ?? '?'}',
                    ),
                ],
              ),
              Expanded(
                child: configAsync.when(
                  loading: () => const AppDetailSkeleton(
                    lines: 6,
                    padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                  ),
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
                    loading: () => const AppDetailSkeleton(
                      lines: 6,
                      padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                    ),
                    error: (error, _) => AppErrorView(
                      message: 'โหลดข้อมูล Parameter ไม่สำเร็จ',
                      messageKey: const Key('config_override_load_error'),
                      retryKey: const Key('config_override_load_retry'),
                      onRetry: () =>
                          ref.invalidate(configFieldDefinitionListProvider),
                    ),
                    data: (definitions) {
                      final defByName = {
                        for (final d in definitions) d.fieldName: d,
                      };
                      return _OverrideForm(
                        central: central,
                        config: config,
                        defByName: defByName,
                        edits: _edits,
                        revealed: _revealed,
                        reasonController: _reasonController,
                        submitting: _submitting,
                        error: _error,
                        errorList: _errorList,
                        fieldErrors: _fieldErrors,
                        reasonError: _reasonError,
                        onReasonChanged: () {
                          if (_reasonError != null) {
                            setState(() => _reasonError = null);
                          }
                        },
                        onEdit: (key, value) => setState(() {
                          _edits[key] = value;
                          _fieldErrors.remove(key);
                        }),
                        onToggleReveal: (key) => setState(() {
                          if (!_revealed.remove(key)) _revealed.add(key);
                        }),
                        onSubmit: () => _submit(config, defByName),
                      );
                    },
                  ),
                ),
              ),
            ],
          ),
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
    required this.central,
    required this.config,
    required this.defByName,
    required this.edits,
    required this.revealed,
    required this.reasonController,
    required this.submitting,
    required this.error,
    required this.errorList,
    required this.fieldErrors,
    required this.reasonError,
    required this.onReasonChanged,
    required this.onEdit,
    required this.onToggleReveal,
    required this.onSubmit,
  });

  final bool central;
  final DeviceConfigDraft config;
  final Map<String, ConfigFieldDefinition> defByName;
  final Map<String, String> edits;
  final Set<String> revealed;
  final TextEditingController reasonController;
  final bool submitting;
  final String? error;
  final List<String> errorList;
  final Map<String, String> fieldErrors;
  final String? reasonError;
  final VoidCallback onReasonChanged;
  final ValueChanged<String> onToggleReveal;
  final void Function(String key, String value) onEdit;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final configFields = config.fields ?? const <String, dynamic>{};
    final fieldEntries = configFields.entries.toList(growable: false);
    // v3.74 — ค่าที่กล่องใช้อยู่แต่ไม่อยู่ใน Config นี้ แสดงต่อท้ายแบบแก้ไม่ได้
    // (Override แก้ได้เฉพาะค่าใน Config) ให้ช่างเห็นค่าในกล่องครบ
    final boxOnlyEntries = (config.boxFields?.fields ?? const {}).entries
        .where((e) => !configFields.containsKey(e.key))
        .toList(growable: false);
    final delivery = config.delivery;
    final undelivered = delivery?.pendingFieldNames.length ?? 0;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
      children: [
        // v3.71 — ค่าในช่องคือค่าหลังส่งครั้งถัดไป (รวม Override ที่อนุมัติแล้ว)
        // ถ้ายังไม่ได้ส่ง ค่าในกล่องจริงยังเป็นค่าเดิม บอกให้ชัดว่าต่างกัน
        if (undelivered > 0) ...[
          AppNotice(
            key: const Key('config_override_undelivered_notice'),
            tone: AppBadgeTone.warning,
            child: Text(
              'มี $undelivered ค่าที่อนุมัติแล้วแต่ยังไม่ได้ส่งเข้ากล่อง · '
              'ช่องด้านล่างแสดงค่าหลังส่ง ค่าในกล่องตอนนี้อยู่ใต้ช่องนั้น'
              '${central ? ' · กดส่งเข้ากล่องได้จากหน้างาน' : ''}',
            ),
          ),
          const SizedBox(height: 16),
        ],
        if (config.pendingOverride != null) ...[
          _PendingOverrideBanner(
            pending: config.pendingOverride!,
            central: central,
          ),
          const SizedBox(height: 16),
        ],
        AppCard(
          size: AppCardSize.small,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (i, entry) in fieldEntries.indexed) ...[
                if (i > 0) const Divider(),
                _FieldRow(
                  key: Key('config_override_field_${entry.key}'),
                  fieldKey: entry.key,
                  originalValue: entry.value,
                  def: defByName[entry.key],
                  editValue: edits[entry.key],
                  inBox: delivery != null && delivery.isPending(entry.key)
                      ? _InBoxValue(delivery.fields[entry.key])
                      : null,
                  errorText: fieldErrors[entry.key],
                  revealed: revealed.contains(entry.key),
                  onToggleReveal: () => onToggleReveal(entry.key),
                  onChanged: (v) => onEdit(entry.key, v),
                ),
              ],
              for (final (i, entry) in boxOnlyEntries.indexed) ...[
                if (i > 0 || fieldEntries.isNotEmpty) const Divider(),
                _FieldRow(
                  key: Key('config_override_field_${entry.key}'),
                  fieldKey: entry.key,
                  originalValue: entry.value,
                  def: defByName[entry.key],
                  editValue: null,
                  outsideConfig: true,
                  errorText: null,
                  revealed: revealed.contains(entry.key),
                  onToggleReveal: () => onToggleReveal(entry.key),
                  onChanged: (_) {},
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 20),
        const AppFieldLabel('เหตุผล', hint: '(บังคับ)'),
        TextField(
          key: const Key('config_override_reason_input'),
          controller: reasonController,
          maxLength: 500,
          onChanged: (_) => onReasonChanged(),
          decoration: InputDecoration(
            hintText: 'เช่น ลูกค้าขอเปลี่ยนค่าหน้างาน / แก้ไขข้อผิดพลาดที่พบ',
            filled: true,
            fillColor: AppColors.card,
            errorText: reasonError,
          ),
        ),
        if (error != null) ...[
          const SizedBox(height: 8),
          AppNotice(
            key: const Key('config_override_error'),
            tone: AppBadgeTone.danger,
            child: AppErrorDetails(message: error!, details: errorList),
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
                    valueColor: AlwaysStoppedAnimation(
                      AppColors.primaryForeground,
                    ),
                  ),
                )
              : Text(
                  central ? 'ขออนุมัติและรอส่งเข้ากล่อง' : 'ยืนยัน Override',
                ),
        ),
      ],
    );
  }
}

/// ค่าในกล่องของ field หนึ่ง (ห่อไว้แยก "ไม่มีค่า" กับ "ไม่ต้องแสดง")
class _InBoxValue {
  const _InBoxValue(this.value);

  final dynamic value;
}

class _FieldRow extends StatefulWidget {
  const _FieldRow({
    super.key,
    required this.fieldKey,
    required this.originalValue,
    required this.def,
    required this.editValue,
    this.inBox,
    this.outsideConfig = false,
    required this.errorText,
    required this.revealed,
    required this.onToggleReveal,
    required this.onChanged,
  });

  final String fieldKey;
  final dynamic originalValue;
  final ConfigFieldDefinition? def;
  final String? editValue;

  /// ค่าในกล่องตอนนี้ เมื่อต่างจากค่าที่อนุมัติแล้ว (รอส่ง) · null = ตรงกัน/ไม่ทราบ
  final _InBoxValue? inBox;

  /// ค่าที่กล่องใช้อยู่แต่ไม่อยู่ใน Config นี้ — แก้ไม่ได้เสมอ
  final bool outsideConfig;
  final String? errorText;
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
    text: widget.editValue ?? configValueToInput(widget.originalValue),
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final currentValue =
        widget.editValue ?? configValueToInput(widget.originalValue);
    final key = Text(
      widget.fieldKey,
      style: const TextStyle(
        fontSize: AppTypography.xs,
        height: AppTypography.xsHeight,
        fontFamily: AppTypography.monoFamily,
        color: AppColors.mutedForeground,
      ),
    );
    // ชื่อเรียกง่ายจาก Parameter Library (`description` เช่น "รอบส่ง GPS
    // (วินาที)") เป็นหัว ชื่อพารามิเตอร์จริงไว้ใต้ ให้ช่างคุยกับทีมได้ตรงตัว
    final label = widget.def?.description?.trim();
    final Widget name = label == null || label.isEmpty
        ? key
        : Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                key: Key('config_override_label_${widget.fieldKey}'),
                style: const TextStyle(
                  fontSize: AppTypography.sm,
                  height: AppTypography.smHeight,
                  fontWeight: FontWeight.w500,
                  color: AppColors.foreground,
                ),
              ),
              key,
            ],
          );

    final inBox = widget.inBox;
    final inBoxText = inBox == null
        ? null
        : Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              'ในกล่องตอนนี้ ${_inBoxLabel(inBox.value)} · รอส่งเข้ากล่อง',
              key: Key('config_override_in_box_${widget.fieldKey}'),
              style: const TextStyle(
                fontSize: AppTypography.xs,
                height: AppTypography.xsHeight,
                color: AppColors.mutedForeground,
              ),
            ),
          );

    final row = isLargeTextScale(context)
        ? Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              name,
              const SizedBox(height: 6),
              _buildValue(currentValue),
            ],
          )
        : Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(flex: 2, child: name),
              const SizedBox(width: 8),
              Expanded(flex: 3, child: _buildValue(currentValue)),
            ],
          );

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      // ตัวอักษรใหญ่: ชื่อ field อยู่เหนือช่องค่า ได้ความกว้างเต็มแถว (UX audit
      // #23) เดิมแบ่ง 2:3 ในแถวเดียว ชื่อยาวอย่าง REPORT_INTERVAL_MOVING ขึ้น
      // บรรทัดใหม่กลางคำหลายครั้ง และช่องกรอกค่าเหลือที่แคบ
      child: inBoxText == null
          ? row
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [row, inBoxText],
            ),
    );
  }

  /// ค่าในกล่องของ field ลับซ่อนไว้จนกว่าจะกดดู (เหมือนช่องค่า) · ไม่มีค่า = "—"
  String _inBoxLabel(dynamic value) {
    if (value == null) return '—';
    if (widget.def?.sensitive != false && !widget.revealed) return '••••';
    return configValueToInput(value);
  }

  Widget _buildValue(String currentValue) {
    final def = widget.def;
    final revealed = widget.revealed;
    final fieldKey = widget.fieldKey;

    if (widget.outsideConfig || def == null || !def.stOverridable) {
      const valueStyle = TextStyle(
        fontSize: AppTypography.xs,
        height: AppTypography.xsHeight,
        fontFamily: AppTypography.monoFamily,
        color: AppColors.mutedForeground,
      );
      // ค่าอยู่บรรทัดบน ป้าย "(แก้ไขไม่ได้)" อยู่บรรทัดล่าง (UX audit #8) —
      // เดิมอยู่ใน Row เดียวกัน ตอนตัวอักษรใหญ่ / จอแคบล้นขอบ และป้ายแย่ง
      // ความกว้างจากค่าที่ช่างต้องอ่าน
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (def?.sensitive != false)
            AppSensitiveValue(
              value: currentValue,
              revealed: revealed,
              onToggle: widget.onToggleReveal,
              style: valueStyle,
            )
          else
            Text(
              currentValue,
              overflow: TextOverflow.ellipsis,
              style: valueStyle,
            ),
          const SizedBox(height: 2),
          const Text(
            '(แก้ไขไม่ได้)',
            style: TextStyle(
              fontSize: AppTypography.xs,
              height: AppTypography.xsHeight,
              color: AppColors.mutedForeground,
            ),
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

    final dataType = def.dataType;
    final multiline = isJsonDataType(dataType);
    return TextField(
      key: Key('config_override_input_$fieldKey'),
      controller: _controller,
      obscureText: def.sensitive && !revealed,
      keyboardType: _keyboardTypeFor(dataType),
      minLines: multiline ? 3 : 1,
      maxLines: multiline ? 6 : 1,
      decoration: InputDecoration(
        isDense: true,
        hintText: _hintFor(dataType),
        // docs/30 §6 — บอกช่วงค่าที่ยอมรับ เช่น "ช่วง 1–200 km/h"
        helperText: _rangeHelper(def),
        errorText: widget.errorText,
        suffixIcon: def.sensitive
            ? AppRevealToggle(
                revealed: revealed,
                onPressed: widget.onToggleReveal,
              )
            : null,
      ),
      onChanged: widget.onChanged,
    );
  }

  /// คีย์บอร์ดตาม dataType — integer ไม่ให้จุดทศนิยม, decimal ให้, json/array
  /// เป็น multiline (`number` legacy นับเป็น decimal)
  static TextInputType _keyboardTypeFor(String dataType) {
    if (isIntegerDataType(dataType)) {
      return const TextInputType.numberWithOptions(signed: true);
    }
    if (isDecimalDataType(dataType)) {
      return const TextInputType.numberWithOptions(signed: true, decimal: true);
    }
    if (isJsonDataType(dataType)) return TextInputType.multiline;
    if (dataType == 'date' || dataType == 'datetime') {
      return TextInputType.datetime;
    }
    return TextInputType.text;
  }

  static String? _rangeHelper(ConfigFieldDefinition def) {
    final label = configRangeLabel(def.minValue, def.maxValue, def.unit);
    return label == null ? null : 'ช่วง $label';
  }

  static String? _hintFor(String dataType) {
    switch (dataType) {
      case 'json':
        return '{"key": "value"}';
      case 'array':
        return '[1, 2, 3]';
      case 'date':
        return 'YYYY-MM-DD';
      case 'datetime':
        return 'YYYY-MM-DDTHH:MM:SS';
      case 'uuid':
        return 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
      default:
        return null;
    }
  }
}

/// บอกช่างว่าอุปกรณ์เครื่องนี้มีคำขอ override ที่ยังรอ Operation ตัดสินใจอยู่
/// (`pendingOverride` จาก `GET /devices/{deviceId}/config`, มติ 2026-09-24,
/// PR #225) — เครื่องหนึ่งมีคำขอ pending พร้อมกันได้แค่ 1 รายการ ส่งคำขอใหม่
/// ตอนนี้จะโดน 409 (แสดง error ปกติผ่าน `_error`/`_errorList` ถ้า ST กด submit
/// ซ้ำ ไม่ block ปุ่มไว้ล่วงหน้า — mirror การจัดการ error อื่นในหน้านี้).
class _PendingOverrideBanner extends StatelessWidget {
  const _PendingOverrideBanner({required this.pending, required this.central});

  final DeviceConfigOverride pending;
  final bool central;

  @override
  Widget build(BuildContext context) {
    return AppNotice(
      key: const Key('config_override_pending_banner'),
      tone: AppBadgeTone.warning,
      icon: Icons.hourglass_top,
      title: 'มีคำขอ override รอ Operation อนุมัติอยู่',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('เหตุผล: ${pending.reason}'),
          if (central) const Text('ติดตามและกดส่งเข้ากล่องได้จากหน้างาน'),
        ],
      ),
    );
  }
}
