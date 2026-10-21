import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/db/tables/pending_actions_table.dart';
import '../../core/router/app_router.dart';
import '../../core/sync/sync_providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_info_row.dart';
import '../../core/ui/app_notice.dart';
import '../../core/ui/app_page_header.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/ui/labels.dart';
import '../../core/ui/status_tones.dart';
import '../../core/widgets/app_error_view.dart';
import 'simulation_result_card.dart';
import 'simulator_repository.dart';
import '../incident/incident_repository.dart';
import '../../core/widgets/sync_status_widgets.dart';
import '../device_search/device_status_repository.dart';
import 'confirm_install_repository.dart';
import 'task_repository.dart';
import 'task_timeline_section.dart';

String _formatDate(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

/// Incident description for a failed simulator check. Prefix `[Simulator
/// Check]` marks it as a test result, not a field-observed fault (there is no
/// separate source field on `POST /incidents` yet). Capped at the backend's
/// 2000-char limit.
@visibleForTesting
String simulationIncidentDescription(
  String deviceId,
  DeviceSimulateConfigResult result,
) {
  final conn = result.connectionCheck;
  final buffer = StringBuffer()
    ..writeln('[Simulator Check] ทดสอบ Config กับอุปกรณ์ $deviceId ไม่ผ่าน')
    ..writeln(
      _checkSummary(
        'Config',
        result.configCheck.passed,
        result.configCheck.details,
      ),
    )
    ..writeln(
      _checkSummary(
        'ความเข้ากันได้กับอุปกรณ์',
        result.compatibilityCheck.passed,
        result.compatibilityCheck.details,
      ),
    )
    ..write(
      _checkSummary('สัญญาณอุปกรณ์', conn.passed, [
        'แรงสัญญาณ: ${conn.signalStrength} dBm',
        ...conn.details,
      ]),
    );
  final text = buffer.toString();
  return text.length <= 2000 ? text : text.substring(0, 2000);
}

String _checkSummary(String label, bool passed, List<String> details) {
  final head = '$label: ${passed ? 'ผ่าน' : 'ไม่ผ่าน'}';
  return details.isEmpty ? head : '$head — ${details.join('; ')}';
}

/// Statuses a field tech (ST/OT) may set from Mobile. Cancelling a task is an
/// Operation decision, not the assignee's, and `pending` is the initial state
/// Operation assigns — so neither is offered here. (Matching backend
/// enforcement is tracked in issue #73.)
const _fieldStaffStatusChoices = <TaskStatus>[
  TaskStatus.inProgress,
  TaskStatus.completed,
];

/// "รายละเอียดงาน" — opened from a task card on Home. Shows one task from
/// `GET /tasks/{id}` and, for ST/OT, lets the assignee change its status via
/// `PATCH /tasks/{id}` (backend restricts them to the `status` field of their
/// own tasks).
///
/// design system ใหม่ (docs/22 Batch 5): `AppPageHeader` แทน AppBar สีกรมท่า
/// (ป้ายสถานะงาน + "รอซิงค์" อยู่ข้างชื่อหน้า) · ข้อมูล / เปลี่ยนสถานะ / ส่ง Config /
/// ประวัติงาน แยกเป็น `AppCard` · ข้อความ error ในแถบล่างเป็น `AppNotice` · แถบล่าง
/// มีปุ่มหลักได้ปุ่มเดียว (docs/21 #11) · ตรรกะ/การเรียก API เหมือนเดิม
class TaskDetailPage extends ConsumerWidget {
  const TaskDetailPage({super.key, required this.taskId});

  final String taskId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final taskAsync = ref.watch(taskDetailProvider(taskId));
    final task = taskAsync.valueOrNull;
    final pendingSync =
        task != null &&
        (ref.watch(pendingTaskIdsProvider).value?.contains(task.id) ?? false);
    final navigator = Navigator.of(context);

    return AppV2Theme(
      child: Scaffold(
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppPageHeader(
                title: 'รายละเอียดงาน',
                onBack: navigator.canPop() ? navigator.pop : null,
                status: task == null
                    ? null
                    : Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          AppBadge(
                            key: const Key('task_detail_status_badge'),
                            label: taskStatusLabel(task.status),
                            tone: taskStatusTone(task.status),
                            dot: true,
                          ),
                          if (pendingSync) const PendingSyncBadge(),
                        ],
                      ),
              ),
              Expanded(
                child: taskAsync.when(
                  skipLoadingOnRefresh: true,
                  // sync flush ขยับ syncRevisionProvider = "reload" (ไม่ใช่ refresh)
                  // ถ้าไม่ข้าม loading ตรงนี้ view จะถูกแทนด้วย skeleton แล้ว
                  // dispose ทิ้งระหว่างโหลด (UX audit #3)
                  skipLoadingOnReload: true,
                  data: (task) => _TaskDetailView(
                    // key ตาม id อย่างเดียว (UX audit #3): เดิมรวม status/updatedAt
                    // ทำให้ทุกครั้งที่ sync flush เสร็จ (taskDetailProvider watch
                    // syncRevisionProvider) view ถูกสร้างใหม่ state การส่ง Config
                    // ที่ยังค้างบนสายหาย ปุ่มกดซ้ำได้ — การตามสถานะใหม่ของ server
                    // ทำใน didUpdateWidget แทน
                    key: ValueKey(task.id),
                    taskId: taskId,
                    task: task,
                  ),
                  loading: () => const AppDetailSkeleton(
                    padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                  ),
                  error: (error, _) => ListView(
                    children: [
                      const SizedBox(height: 64),
                      _DetailError(
                        message: _errorMessage(error),
                        onRetry: () =>
                            ref.invalidate(taskDetailProvider(taskId)),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _errorMessage(Object error) {
    if (error is ApiException) {
      switch (error.statusCode) {
        case 404:
          return 'ไม่พบงานนี้ อาจถูกลบไปแล้ว';
        case 403:
          return 'ไม่มีสิทธิ์ดูงานนี้';
        default:
          return error.message;
      }
    }
    return 'โหลดรายละเอียดงานไม่สำเร็จ';
  }
}

class _TaskDetailView extends ConsumerStatefulWidget {
  const _TaskDetailView({super.key, required this.taskId, required this.task});

  final String taskId;
  final Task task;

  @override
  ConsumerState<_TaskDetailView> createState() => _TaskDetailViewState();
}

class _TaskDetailViewState extends ConsumerState<_TaskDetailView> {
  late TaskStatus _selected = widget.task.status;
  bool _saving = false;
  String? _saveError;

  bool _confirmingInstall = false;
  bool _installConfirmed = false;
  String? _confirmInstallError;

  // ทดสอบกับ Device Simulator ก่อนส่ง Config (แถว 26b, ไม่บังคับ) — แยก state
  // จาก _confirmingInstall/_installConfirmed ข้างบน. ผลไม่ผ่าน (`passed ==
  // false`) บล็อกปุ่ม "ส่ง Config เข้าเครื่อง" ฝั่ง client เท่านั้น (ไม่มี gate
  // ฝั่ง server) ส่วน error ของการเรียก simulate เอง (ออฟไลน์ ฯลฯ) ไม่บล็อก
  bool _simulating = false;
  DeviceSimulateConfigResult? _simulationResult;
  String? _simulationError;
  String? _incidentNotice;
  bool _incidentReported = false;

  bool get _simulationBlocked => _simulationResult?.passed == false;

  @override
  void didUpdateWidget(covariant _TaskDetailView oldWidget) {
    super.didUpdateWidget(oldWidget);
    // server เปลี่ยนสถานะงาน (sync / บันทึกเสร็จ): ถ้าผู้ใช้ยังไม่ได้เลือก
    // สถานะอื่นค้างไว้ ให้ตัวเลือกตามสถานะใหม่ — แทนการ reset ทั้ง view ด้วย
    // key แบบเดิม ส่วนตัวเลือกที่ผู้ใช้เลือกค้างไว้ไม่ถูกทับ
    if (widget.task.status != oldWidget.task.status &&
        _selected == oldWidget.task.status) {
      _selected = widget.task.status;
    }
  }

  bool get _dirty => _selected != widget.task.status;

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _saveError = null;
    });
    try {
      await ref
          .read(taskRepositoryProvider)
          .updateStatus(widget.taskId, _selected);
      ref.invalidate(taskListProvider);
      ref.invalidate(taskDetailProvider(widget.taskId));
      final queued = await _stillQueued();
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(
              queued
                  ? 'บันทึกแล้ว จะซิงค์เมื่อมีอินเทอร์เน็ต'
                  : 'อัปเดตสถานะงานแล้ว',
            ),
          ),
        );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _saveError = _saveErrorMessage(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// True when the just-saved change is still waiting in the sync queue
  /// (offline / not yet confirmed) — only changes the snackbar wording.
  Future<bool> _stillQueued() async {
    try {
      final rows = await ref
          .read(pendingActionDaoProvider)
          .getPendingForEntity(
            PendingActionType.taskStatus.wireName,
            widget.taskId,
          );
      return rows.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  static String _saveErrorMessage(ApiException e) {
    switch (e.statusCode) {
      case 403:
        return 'แก้สถานะได้เฉพาะงานที่มอบหมายให้คุณเท่านั้น';
      case 404:
        return 'ไม่พบงานนี้ อาจถูกลบไปแล้ว';
      case 400:
        return 'สถานะที่เลือกไม่ถูกต้อง';
      default:
        return e.message;
    }
  }

  /// `POST /devices/{deviceId}/simulate-config` ด้วย `task.deviceId` +
  /// `task.configId` (ไม่ให้ช่างเลือกเอง) — dry-run ไม่เขียนอะไรในระบบ. ถ้า
  /// ไม่ผ่านจะสร้าง Incident อัตโนมัติ 1 ครั้งต่อรอบที่ไม่ผ่าน (ทดสอบซ้ำแล้ว
  /// ยังไม่ผ่านไม่สร้างซ้ำ จนกว่าจะเคยผ่านคั่น)
  Future<void> _runSimulation() async {
    final deviceId = widget.task.deviceId;
    final configId = widget.task.configId;
    if (deviceId == null || configId == null) return;

    setState(() {
      _simulating = true;
      _simulationError = null;
      // ผลของรอบก่อนไม่ใช่ผลของรอบนี้ — ล้างทุกครั้งที่กดทดสอบใหม่ ไม่งั้นถ้า
      // รอบนี้ simulate ล้ม (ออฟไลน์) ปุ่มส่ง Config จะค้าง disable จากผลเก่า
      _simulationResult = null;
    });
    try {
      final result = await ref
          .read(simulatorRepositoryProvider)
          .simulate(deviceId: deviceId, configId: configId);
      if (!mounted) return;
      setState(() {
        _simulating = false;
        _simulationResult = result;
        if (result.passed) {
          _incidentReported = false;
          _incidentNotice = null;
        }
      });
      if (!result.passed && !_incidentReported) {
        _incidentReported = true;
        await _reportFailedSimulation(deviceId, result);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _simulating = false;
        _simulationError = e.message;
      });
    }
  }

  /// สร้าง Incident อัตโนมัติจากผลที่ไม่ผ่าน — best effort: ล้มเหลว (รวมถึง
  /// ออฟไลน์) ไม่ retry ไม่ throw ไม่กระทบการบล็อกปุ่ม (บล็อกจาก `passed` ตรงๆ)
  Future<void> _reportFailedSimulation(
    String deviceId,
    DeviceSimulateConfigResult result,
  ) async {
    try {
      await ref
          .read(incidentRepositoryProvider)
          .createFieldReport(
            title: 'Simulator Check ไม่ผ่าน: $deviceId',
            description: simulationIncidentDescription(deviceId, result),
            severity: IncidentSeverity.low,
            deviceId: deviceId,
          );
      if (!mounted) return;
      setState(
        () => _incidentNotice = 'บันทึกเป็น Incident ให้ Operation แล้ว',
      );
    } catch (_) {
      if (!mounted) return;
      setState(
        () => _incidentNotice =
            'สร้าง Incident อัตโนมัติไม่สำเร็จ (ไม่กระทบการทดสอบ)',
      );
    }
  }

  /// `configRolloutId` ล่าสุดของอุปกรณ์ (issue #265) — ส่งเป็น `rolloutId` ตอน
  /// apply-config กัน backend match ผิดรอบ · มีค่าเฉพาะตอน `configStatus` เป็น
  /// `pending` · โหลดสถานะไม่สำเร็จ → `null` (ไม่ block การส่ง Config —
  /// backend ใช้วิธี match เดิม)
  Future<String?> _currentConfigRolloutId(String deviceId) async {
    try {
      final status = await ref
          .read(deviceStatusRepositoryProvider)
          .getDeviceStatus(deviceId);
      return status.configStatus == DevicePayloadStatus.pending
          ? status.configRolloutId
          : null;
    } catch (_) {
      return null;
    }
  }

  /// เรียก `POST /devices/{deviceId}/apply-config` ด้วย `task.deviceId` +
  /// `task.configId` — fire-and-forget ฝั่ง backend จึงไม่มีสถานะอุปกรณ์ให้
  /// รีเฟรชหลังเรียกสำเร็จ (กล่องรับค่าตอนเปิดเครื่องครั้งถัดไป) แค่ mark
  /// เครื่องหมายว่ายืนยันแล้วในหน้านี้กันกดซ้ำ.
  Future<void> _confirmInstall() async {
    final deviceId = widget.task.deviceId;
    final configId = widget.task.configId;
    if (deviceId == null || configId == null) return;
    if (_simulationBlocked) return;

    setState(() {
      _confirmingInstall = true;
      _confirmInstallError = null;
    });
    try {
      final rolloutId = await _currentConfigRolloutId(deviceId);
      final result = await ref
          .read(confirmInstallRepositoryProvider)
          .applyConfig(
            deviceId: deviceId,
            configId: configId,
            rolloutId: rolloutId,
          );
      if (!mounted) return;
      setState(() {
        _confirmingInstall = false;
        _installConfirmed = result.applied;
        _confirmInstallError = result.applied
            ? null
            : (result.details.isEmpty
                  ? 'ส่ง Config เข้าอุปกรณ์ไม่สำเร็จ'
                  : result.details.join('\n'));
      });
      if (!mounted || !result.applied) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            content: Text(
              'ส่ง Config เข้าเครื่องแล้ว — กล่องจะรับค่าเมื่อเปิดเครื่องครั้งถัดไป',
            ),
          ),
        );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _confirmingInstall = false;
        _confirmInstallError = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final role = ref.watch(authControllerProvider).role;
    final isFieldStaff = role == UserRole.st || role == UserRole.ot;
    // งานที่เสร็จแล้ว (completed) ห้ามเปลี่ยนสถานะย้อนกลับ (คำตอบ A ใน #303
    // ข้อ 1 — backend ตอบ 409 ด้วย) ซ่อนแถวเปลี่ยนสถานะกับปุ่มบันทึกทั้งหมด
    // ไม่ใช่แค่ disable
    final canEditStatus = isFieldStaff && task.status != TaskStatus.completed;
    // ส่ง Config เข้าเครื่อง (เดิมชื่อ Confirm Install, Sprint 3): เฉพาะ ST/OT
    // ที่กำลังทำงานติดตั้ง config อยู่จริง — ต้องมีทั้ง configId (Operation
    // ผูกไว้ตอนสร้างงาน) และ deviceId (จะส่งไปให้ endpoint ไหน) และงานต้อง
    // in_progress (ไม่ใช่ pending ที่ยังไม่เริ่ม หรือ completed/cancelled ที่
    // จบไปแล้ว) — ปุ่มนี้แค่ "ส่ง" Config เข้าเครื่อง ไม่ใช่ยืนยันว่าติดตั้ง
    // สำเร็จ (apply-config เป็น fire-and-forget, ไม่เปลี่ยนสถานะอุปกรณ์)
    //
    // หมายเหตุ: canEditStatus และ canConfirmInstall เป็นจริงพร้อมกันได้จริง
    // (ST/OT ที่งาน in_progress + มี configId/deviceId ครบ) — bottom bar ด้าน
    // ล่างจึงต้องรองรับโชว์ทั้งคู่พร้อมกันแบบเรียงต่อกัน ไม่ใช่แค่กรณีเดียว
    final canConfirmInstall =
        isFieldStaff &&
        task.configId != null &&
        task.deviceId != null &&
        task.status == TaskStatus.inProgress;
    // เพิ่มบันทึกบน timeline (issue #296): Operation หรือ ST/OT (หน้านี้ ST/OT
    // เห็นเฉพาะงานตัวเองอยู่แล้ว) และงานต้องยังไม่ถูกยกเลิก — ตรงกับเงื่อนไขของ
    // POST /tasks/{id}/notes ที่ backend บังคับอีกชั้น
    final canAddNote =
        (canEditStatus || role == UserRole.operation) &&
        task.status != TaskStatus.cancelled;

    // UX audit #14 — ออฟไลน์ กำลังแสดง cache ในเครื่อง
    final offline = ref.watch(taskDetailCacheSnapshotProvider(widget.taskId));
    final description = (task.description ?? '').trim();
    final deviceId = task.deviceId ?? '';

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          if (offline != null) ...[
            OfflineCacheBanner(cachedAt: offline.cachedAt),
            const SizedBox(height: 12),
          ],
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  task.title,
                  key: const Key('task_detail_title'),
                  style: const TextStyle(
                    fontSize: AppTypography.base,
                    height: AppTypography.baseHeight,
                    fontWeight: FontWeight.w600,
                    color: AppColors.foreground,
                  ),
                ),
                if (description.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  const _CardTitle('รายละเอียด'),
                  Text(
                    description,
                    key: const Key('task_detail_description'),
                    style: const TextStyle(
                      fontSize: AppTypography.sm,
                      height: AppTypography.smHeight,
                      color: AppColors.foreground,
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                const Divider(),
                // UX audit #1: เลขอุปกรณ์กดไปหน้ารายละเอียดอุปกรณ์ได้ (เดิมต้องกลับ
                // Home แล้วค้นหาเอง ก่อนจะไปขอแก้ Config ของเครื่องนั้น)
                if (deviceId.isNotEmpty)
                  _DeviceLinkRow(
                    deviceId: deviceId,
                    onTap: () => context.push(AppRoutes.deviceDetail(deviceId)),
                  )
                else
                  const AppInfoRow(label: 'อุปกรณ์', value: null),
                // raw user id — ยังไม่มี GET /users resolve ชื่อฝั่ง Mobile
                // (gap เดียวกับ reportedBy/reviewedBy ใน Incident Detail, #306)
                AppInfoRow(
                  label: 'ผู้รับผิดชอบ',
                  value: task.assignedTo,
                  selectable: true,
                ),
                AppInfoRow(
                  label: 'กำหนดส่ง',
                  value: task.dueDate == null
                      ? null
                      : _formatDate(task.dueDate!),
                ),
                AppInfoRow(
                  label: 'สร้างเมื่อ',
                  value: _formatDate(task.createdAt),
                ),
                AppInfoRow(
                  label: 'แก้ไขล่าสุด',
                  value: _formatDate(task.updatedAt),
                ),
              ],
            ),
          ),
          if (canEditStatus) ...[
            const SizedBox(height: 12),
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _CardTitle('เปลี่ยนสถานะงาน'),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final status in _fieldStaffStatusChoices)
                        ChoiceChip(
                          key: Key('status_choice_${status.wireName}'),
                          label: Text(taskStatusLabel(status)),
                          selected: _selected == status,
                          onSelected: _saving
                              ? null
                              : (_) => setState(() => _selected = status),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
          if (canConfirmInstall) ...[
            const SizedBox(height: 12),
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _CardTitle('ส่ง Config เข้าเครื่อง'),
                  Text(
                    'ส่ง Config เข้าอุปกรณ์ ${task.deviceId} — ทำหลังติดตั้งกล่อง '
                    'GPS เสร็จแล้วเท่านั้น',
                    style: const TextStyle(
                      fontSize: AppTypography.xs,
                      height: AppTypography.xsHeight,
                      color: AppColors.mutedForeground,
                    ),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    key: const Key('simulate_test_button'),
                    onPressed: (_simulating || _confirmingInstall)
                        ? null
                        : _runSimulation,
                    icon: _simulating
                        ? const SizedBox(
                            height: 16,
                            width: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.fact_check_outlined, size: 18),
                    label: Text(
                      _simulating
                          ? 'กำลังทดสอบ...'
                          : 'ทดสอบกับ Device Simulator (ไม่บังคับ)',
                    ),
                  ),
                  if (_simulationError != null) ...[
                    const SizedBox(height: 12),
                    AppNotice(
                      tone: AppBadgeTone.danger,
                      icon: Icons.error_outline,
                      child: Text(
                        _simulationError!,
                        key: const Key('simulate_error'),
                      ),
                    ),
                  ],
                  if (_simulationResult != null) ...[
                    const SizedBox(height: 12),
                    SimulationResultCard(
                      key: const Key('simulate_result'),
                      result: _simulationResult!,
                    ),
                  ],
                  if (_incidentNotice != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      _incidentNotice!,
                      key: const Key('simulate_incident_notice'),
                      style: const TextStyle(
                        fontSize: AppTypography.xs,
                        height: AppTypography.xsHeight,
                        color: AppColors.mutedForeground,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
          const SizedBox(height: 12),
          TaskTimelineSection(taskId: task.id, canAddNote: canAddNote),
        ],
      ),
      // ย้ายปุ่ม action หลักมาไว้ที่ bottom bar (แทนต่อท้ายเนื้อหาใน ListView)
      // ให้กดได้ง่ายด้วยมือเดียวโดยไม่ต้องเลื่อนจอ — error ของแต่ละปุ่มย้ายมา
      // อยู่เหนือปุ่มของมันในบาร์นี้ด้วย ไม่ทิ้งไว้บนเนื้อหาด้านบนที่ปุ่มลอยอยู่
      // ล่างสุดเสมอ (ผู้ใช้จะมองไม่เห็น error ถ้า error ยังอยู่บน)
      //
      // docs/21 #11: เดิมสองปุ่มเป็น FilledButton สีเดียวกันขนาดเท่ากัน ไม่รู้ว่าปุ่ม
      // ไหนสำคัญกว่า → ปุ่มหลักได้ปุ่มเดียว (ไว้ล่างสุดตามกติกา Web) ตอนมีทั้งคู่
      // "ยืนยันส่ง Config เข้าเครื่อง" เป็นปุ่มหลัก เพราะเป็นงานเฉพาะของใบงานติดตั้ง
      // ส่วน "บันทึกสถานะ" ลดเป็น outline (ขนาดเท่าเดิม สูง 48 เต็มความกว้าง) ·
      // มีปุ่มเดียวเมื่อไหร่ ปุ่มนั้นเป็นปุ่มหลัก
      bottomNavigationBar: (canEditStatus || canConfirmInstall)
          ? DecoratedBox(
              decoration: const BoxDecoration(
                color: AppColors.background,
                border: Border(top: BorderSide(color: AppColors.border)),
              ),
              child: SafeArea(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (canEditStatus)
                        _StatusSaveBar(
                          error: _saveError,
                          saving: _saving,
                          primary: !canConfirmInstall,
                          onPressed: (!_dirty || _saving) ? null : _save,
                        ),
                      if (canEditStatus && canConfirmInstall)
                        const SizedBox(height: 12),
                      if (canConfirmInstall)
                        _ConfirmInstallBar(
                          error: _confirmInstallError,
                          confirming: _confirmingInstall,
                          confirmed: _installConfirmed,
                          blockedMessage: _simulationBlocked
                              ? 'ผลทดสอบกับ Device Simulator ไม่ผ่าน — ส่ง Config '
                                    'ไม่ได้จนกว่าจะทดสอบซ้ำแล้วผ่าน'
                              : null,
                          onPressed:
                              (_confirmingInstall ||
                                  _installConfirmed ||
                                  _simulationBlocked)
                              ? null
                              : _confirmInstall,
                        ),
                    ],
                  ),
                ),
              ),
            )
          : null,
    );
  }
}

/// ข้อความเหนือปุ่มในแถบล่าง (error / เหตุผลที่กดไม่ได้) — [textKey] อยู่ที่ตัว
/// ข้อความเพื่อให้เทสหาเจอแบบเดิม
class _BarNotice extends StatelessWidget {
  const _BarNotice({
    required this.message,
    required this.textKey,
    this.icon = Icons.error_outline,
  });

  final String message;
  final Key textKey;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppNotice(
        tone: AppBadgeTone.danger,
        icon: icon,
        child: Text(message, key: textKey),
      ),
    );
  }
}

/// วงหมุนในปุ่มระหว่างรอ — สีตามตัวอักษรของปุ่ม (ขาวบนปุ่มหลัก, เข้มบน outline)
class _ButtonSpinner extends StatelessWidget {
  const _ButtonSpinner({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 20,
      width: 20,
      child: CircularProgressIndicator(strokeWidth: 2, color: color),
    );
  }
}

class _StatusSaveBar extends StatelessWidget {
  const _StatusSaveBar({
    required this.error,
    required this.saving,
    required this.primary,
    required this.onPressed,
  });

  final String? error;
  final bool saving;

  /// `false` ตอนแถบล่างมีปุ่ม "ยืนยันส่ง Config เข้าเครื่อง" ด้วย — ปุ่มนี้ลดเป็น
  /// outline ให้เหลือปุ่มหลักปุ่มเดียว (docs/21 #11)
  final bool primary;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    const key = Key('task_status_save');
    final child = saving
        ? _ButtonSpinner(
            color: primary ? AppColors.primaryForeground : AppColors.foreground,
          )
        : const Text('บันทึกสถานะ');
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (error != null)
          _BarNotice(message: error!, textKey: const Key('task_status_error')),
        primary
            ? FilledButton(key: key, onPressed: onPressed, child: child)
            : OutlinedButton(key: key, onPressed: onPressed, child: child),
      ],
    );
  }
}

class _ConfirmInstallBar extends StatelessWidget {
  const _ConfirmInstallBar({
    required this.error,
    required this.confirming,
    required this.confirmed,
    required this.onPressed,
    this.blockedMessage,
  });

  final String? error;
  final bool confirming;
  final bool confirmed;
  final VoidCallback? onPressed;

  /// Why the button is disabled by a failed simulator check (null = not
  /// blocked). Shown above the button.
  final String? blockedMessage;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (blockedMessage != null)
          _BarNotice(
            message: blockedMessage!,
            textKey: const Key('simulate_blocked_message'),
            icon: Icons.block,
          ),
        if (error != null)
          _BarNotice(
            message: error!,
            textKey: const Key('confirm_install_error'),
          ),
        FilledButton(
          key: const Key('confirm_install_button'),
          onPressed: onPressed,
          child: confirming
              ? const _ButtonSpinner(color: AppColors.primaryForeground)
              : Text(
                  confirmed
                      ? 'ส่ง Config เข้าเครื่องแล้ว'
                      : 'ยืนยันส่ง Config เข้าเครื่อง',
                ),
        ),
      ],
    );
  }
}

/// แถว "อุปกรณ์" ที่กดไปหน้ารายละเอียดอุปกรณ์ได้ — กดได้ทั้งแถว สูงอย่างน้อย
/// 48dp (กดด้วยนิ้วหน้างาน) · หน้าตาลิงก์แบบเดียวกับ Incident Detail
class _DeviceLinkRow extends StatelessWidget {
  const _DeviceLinkRow({required this.deviceId, required this.onTap});

  final String deviceId;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      key: const Key('task_detail_device_link'),
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 48),
        child: Row(
          children: [
            Expanded(
              child: AppInfoRow(
                label: 'อุปกรณ์',
                child: Text(
                  deviceId,
                  style: const TextStyle(
                    fontSize: AppTypography.sm,
                    height: AppTypography.smHeight,
                    fontWeight: FontWeight.w600,
                    color: AppColors.primary,
                    decoration: TextDecoration.underline,
                    decorationColor: AppColors.primary,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 4),
            const ExcludeSemantics(
              child: Icon(
                Icons.chevron_right,
                size: 20,
                color: AppColors.mutedForeground,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CardTitle extends StatelessWidget {
  const _CardTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: AppTypography.sm,
        height: AppTypography.smHeight,
        fontWeight: FontWeight.w600,
        color: AppColors.foreground,
      ),
    ),
  );
}

class _DetailError extends StatelessWidget {
  const _DetailError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return AppErrorView(
      message: message,
      onRetry: onRetry,
      messageKey: const Key('task_detail_error'),
      retryKey: const Key('task_detail_retry'),
    );
  }
}
