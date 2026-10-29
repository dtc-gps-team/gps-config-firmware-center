import 'dart:async';

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
import '../config_override/config_value_parser.dart';
import '../incident/incident_repository.dart';
import '../../core/widgets/sync_status_widgets.dart';
import 'config_apply_request_repository.dart';
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

  // คำขอส่ง Config เข้าเครื่อง (docs/25) — สถานะของคำขอมาจาก server
  // (`latestConfigApplyRequestProvider`) ตรงนี้เก็บแค่ระหว่างกดยกเลิก/ส่ง
  bool _cancelling = false;
  String? _cancelError;
  bool _releasing = false;
  String? _releaseError;

  // docs/27 §9 — โหลดสถานะคำขอใหม่เป็นระยะระหว่างที่ยังเปลี่ยนได้จากฝั่ง server
  // (รออนุมัติ / รอกดส่ง / กำลังส่ง) เพราะ push อาจไม่มา (เช่น NOTIFICATION_MODE=
  // mock) · เริ่ม/หยุดตามสถานะใน build() ผ่าน [_syncRequestPolling]
  static const _requestPollInterval = Duration(seconds: 5);
  Timer? _requestPoll;

  // ทดสอบกับ Device Simulator ก่อนส่ง Config (แถว 26b, ไม่บังคับ) — ผลไม่ผ่าน
  // (`passed == false`) บล็อกปุ่ม "ส่ง Config เข้าเครื่อง" ฝั่ง client เท่านั้น
  // (ไม่มี gate ฝั่ง server) ส่วน error ของการเรียก simulate เอง (ออฟไลน์ ฯลฯ)
  // ไม่บล็อก
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

  /// ปิดงาน (docs/28 §5.4): คำขอที่รออนุมัติ/รอกดส่งจะถูกยกเลิกให้ — ยืนยันก่อน
  Future<void> _confirmThenSave(ConfigApplyRequest? latest) async {
    final willCancel =
        _selected == TaskStatus.completed &&
        (latest?.status == ConfigApplyRequestStatus.pending ||
            latest?.status == ConfigApplyRequestStatus.approved);
    if (willCancel) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('ปิดงานนี้?'),
          content: const Text(
            'คำขอส่ง Config ที่ยังไม่ได้ส่งเข้ากล่องจะถูกยกเลิกด้วย',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('ยังไม่ปิด'),
            ),
            FilledButton(
              key: const Key('confirm_complete_task'),
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('ปิดงาน'),
            ),
          ],
        ),
      );
      if (ok != true || !mounted) return;
    }
    await _save();
  }

  /// เลือก Config เอง (docs/28 §6) — เปิดหน้าเลือกให้งานนี้ แล้วโหลดคำขอใหม่
  /// เมื่อกลับมา
  /// [firmware] = เปิดแท็บ Firmware (docs/27 B3 — "ขออัปเดต Firmware" และขอซ้ำหลัง
  /// คำขอ Firmware ไม่สำเร็จ)
  Future<void> _openPicker({bool firmware = false}) async {
    final deviceId = widget.task.deviceId;
    if (deviceId == null) return;
    await context.push<bool>(
      AppRoutes.deviceApply(
        deviceId,
        taskId: widget.taskId,
        firmware: firmware,
      ),
    );
    if (!mounted) return;
    ref.invalidate(taskConfigApplyRequestsProvider(widget.taskId));
  }

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

  /// `POST /tasks/{taskId}/config-apply-requests` (docs/25 §3.3) — backend อ่าน
  /// Config/เครื่องจาก Task เอง · สร้างคำขอ `pending` ให้ Operation **อีกคน**
  /// อนุมัติ ระบบจึงส่งเข้ากล่องจริง · ต้องออนไลน์ (ไม่เข้าคิว offline) · 409
  /// (มีคำขอค้าง, Campaign กำลังส่ง, งานไม่มีผู้ผูก Config ฯลฯ) แสดงข้อความของ
  /// backend ตรงๆ แล้วโหลดสถานะคำขอใหม่
  /// Config ที่ Operation ผูกกับงาน (docs/27 §2.2) — ไปหน้าพารามิเตอร์ของ Config
  /// นั้น ไม่แก้ค่า = ส่งเข้ากล่องได้ทันที · แก้ = ขออนุมัติค่าที่แก้
  Future<void> _openAssignedConfig() async {
    final deviceId = widget.task.deviceId;
    final configId = widget.task.configId;
    if (_simulationBlocked || deviceId == null || configId == null) return;
    await context.push<String>(
      AppRoutes.deviceApplyConfig(deviceId, configId, taskId: widget.taskId),
    );
    if (!mounted) return;
    ref.invalidate(taskConfigApplyRequestsProvider(widget.taskId));
  }

  /// `POST /config-apply-requests/{id}/release` (docs/27 §5.4) — กดส่งคำขอที่
  /// อนุมัติแล้วเข้ากล่อง · 409 (กล่องออฟไลน์, หมดอายุ, Config เปลี่ยน ฯลฯ) แสดง
  /// ข้อความของ backend ตรงๆ แล้วโหลดสถานะใหม่ (บางกรณี backend ปิดคำขอให้แล้ว)
  Future<void> _releaseRequest(String requestId) async {
    setState(() {
      _releasing = true;
      _releaseError = null;
      _cancelError = null;
    });
    try {
      await ref.read(configApplyRequestRepositoryProvider).release(requestId);
      ref.invalidate(taskConfigApplyRequestsProvider(widget.taskId));
      if (!mounted) return;
      setState(() => _releasing = false);
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(content: Text('ส่งเข้ากล่องแล้ว — รอกล่องยืนยัน')),
        );
    } on ApiException catch (e) {
      ref.invalidate(taskConfigApplyRequestsProvider(widget.taskId));
      if (!mounted) return;
      setState(() {
        _releasing = false;
        _releaseError = e.message;
      });
    }
  }

  void _syncRequestPolling(bool inFlight) {
    if (inFlight && _requestPoll == null) {
      _requestPoll = Timer.periodic(_requestPollInterval, (_) {
        if (!mounted) return;
        ref.invalidate(taskConfigApplyRequestsProvider(widget.taskId));
      });
    } else if (!inFlight && _requestPoll != null) {
      _requestPoll!.cancel();
      _requestPoll = null;
    }
  }

  @override
  void dispose() {
    _requestPoll?.cancel();
    super.dispose();
  }

  /// `POST /config-apply-requests/{id}/cancel` — ยกเลิกคำขอ `pending`/`approved`
  Future<void> _cancelRequest(String requestId) async {
    setState(() {
      _cancelling = true;
      _cancelError = null;
      _releaseError = null;
    });
    try {
      await ref.read(configApplyRequestRepositoryProvider).cancel(requestId);
      ref.invalidate(taskConfigApplyRequestsProvider(widget.taskId));
      if (!mounted) return;
      setState(() => _cancelling = false);
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(content: Text('ยกเลิกคำขอแล้ว')));
    } on ApiException catch (e) {
      ref.invalidate(taskConfigApplyRequestsProvider(widget.taskId));
      if (!mounted) return;
      setState(() {
        _cancelling = false;
        _cancelError = e.message;
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
    // ส่ง Config เข้าเครื่อง (docs/25 — เดิม "ส่ง" ตรงผ่าน apply-config แบบ
    // mock): เฉพาะ ST/OT ที่งานมีเครื่องและ in_progress (เงื่อนไขเดียวกับที่
    // backend บังคับ) · docs/28: ไม่ต้องมี configId แล้ว — งานที่ช่างเริ่มเองหรือ
    // ไม่มี Config ผูก ช่างเลือก Config จากหน้าเลือก ([_openPicker])
    //
    // หมายเหตุ: canEditStatus และ canConfirmInstall เป็นจริงพร้อมกันได้จริง
    // (ST/OT ที่งาน in_progress + มี configId/deviceId ครบ) — bottom bar ด้าน
    // ล่างจึงต้องรองรับโชว์ทั้งคู่พร้อมกันแบบเรียงต่อกัน ไม่ใช่แค่กรณีเดียว
    final canConfirmInstall =
        isFieldStaff &&
        task.deviceId != null &&
        task.status == TaskStatus.inProgress;
    // มี Config ที่ Operation ผูกไว้ = ปุ่มล่างพาไปหน้าพารามิเตอร์ของตัวนั้น และ
    // ทดสอบกับ Simulator ได้ · ไม่มี = ปุ่มล่างพาไปหน้าเลือก
    final hasAssignedConfig = task.configId != null;
    // เพิ่มบันทึกบน timeline (issue #296): Operation หรือ ST/OT (หน้านี้ ST/OT
    // เห็นเฉพาะงานตัวเองอยู่แล้ว) และงานต้องยังไม่ถูกยกเลิก — ตรงกับเงื่อนไขของ
    // POST /tasks/{id}/notes ที่ backend บังคับอีกชั้น
    // คำขอล่าสุดของงาน — โหลดเฉพาะตอนเห็นการ์ดนี้ · ปุ่มขอส่งอยู่ในแถบล่างเมื่อ
    // ยังไม่เคยขอ หรือคำขอล่าสุดจบแบบไม่สำเร็จ (docs/25 §3.3) ระหว่างโหลด/โหลด
    // ไม่สำเร็จปุ่มยังอยู่แต่กดไม่ได้ (ไม่รู้ว่ามีคำขอค้างอยู่ไหม)
    final applyRequest = canConfirmInstall
        ? ref.watch(latestConfigApplyRequestProvider(task.id))
        : null;
    final latestRequest = applyRequest?.valueOrNull;
    final requestKnown =
        applyRequest != null &&
        !applyRequest.isLoading &&
        !applyRequest.hasError;
    final showRequestButton =
        canConfirmInstall &&
        (latestRequest == null || latestRequest.status.allowsNewRequest);
    _syncRequestPolling(latestRequest?.status.isInFlight ?? false);
    // docs/28 §5.4 — ปิดงานระหว่างกำลังส่งเข้ากล่องไม่ได้ (backend ตอบ 409)
    final completeBlocked =
        _selected == TaskStatus.completed &&
        latestRequest?.status == ConfigApplyRequestStatus.sending;
    final earlierRequests = canConfirmInstall
        ? (ref.watch(taskConfigApplyRequestsProvider(task.id)).valueOrNull ??
                  const <ConfigApplyRequest>[])
              .skip(1)
              .toList(growable: false)
        : const <ConfigApplyRequest>[];
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
                // ชื่อมากับ GET /tasks/{id} (v3.67) · ไม่มี (cache ในเครื่อง /
                // backend เก่า) = user id ดิบแบบเดิม
                AppInfoRow(
                  key: const Key('task_detail_assignee'),
                  label: 'ผู้รับผิดชอบ',
                  value: task.assignee?.label ?? task.assignedTo,
                  selectable: true,
                ),
                AppInfoRow(
                  key: const Key('task_detail_source'),
                  label: 'ที่มา',
                  value: taskSourceLabel(task.source),
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
                if (task.completedAt != null)
                  AppInfoRow(
                    label: 'ปิดงานเมื่อ',
                    value: _formatDate(task.completedAt!),
                  ),
                if (task.autoClosed) ...[
                  const SizedBox(height: 8),
                  const AppNotice(
                    key: Key('task_detail_auto_closed'),
                    tone: AppBadgeTone.neutral,
                    icon: Icons.schedule,
                    child: Text(
                      'ระบบปิดงานให้ เพราะไม่มีความเคลื่อนไหวเกิน 24 ชม.',
                    ),
                  ),
                ],
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
                  const _CardTitle('ส่ง Config / Firmware เข้ากล่อง'),
                  Text(
                    hasAssignedConfig
                        ? 'ส่ง Config ของงานนี้ หรือขออัปเดต Firmware เข้าอุปกรณ์ '
                              '${task.deviceId} — ทำหลังติดตั้งกล่อง GPS เสร็จแล้ว · '
                              'Config ที่ไม่แก้ค่าส่งได้ทันที · แก้ค่าหรือ Firmware '
                              'ต้องรอ Operation อนุมัติก่อน แล้วกดส่งจากหน้านี้'
                        : 'เลือก Config หรือ Firmware ที่อนุมัติแล้วสำหรับอุปกรณ์ '
                              '${task.deviceId} · Config ที่ไม่แก้ค่าส่งได้ทันที · '
                              'แก้ค่าหรือ Firmware ต้องรอ Operation อนุมัติก่อน แล้วกด'
                              'ส่งจากหน้านี้',
                    style: const TextStyle(
                      fontSize: AppTypography.xs,
                      height: AppTypography.xsHeight,
                      color: AppColors.mutedForeground,
                    ),
                  ),
                  if (showRequestButton)
                    Wrap(
                      spacing: 8,
                      children: [
                        if (hasAssignedConfig)
                          TextButton(
                            key: const Key('choose_other_config_button'),
                            onPressed: _openPicker,
                            child: const Text('เลือก Config อื่น'),
                          ),
                        // docs/27 §9 ปุ่มรอง "ขออัปเดต Firmware" (B3)
                        TextButton.icon(
                          key: const Key('request_firmware_button'),
                          onPressed: () => _openPicker(firmware: true),
                          icon: const Icon(Icons.memory, size: 18),
                          label: const Text('ขออัปเดต Firmware'),
                        ),
                      ],
                    ),
                  if (hasAssignedConfig) ...[
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      key: const Key('simulate_test_button'),
                      onPressed: _simulating ? null : _runSimulation,
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
                  ],
                  _ApplyRequestSection(
                    request: applyRequest!,
                    cancelling: _cancelling,
                    cancelError: _cancelError,
                    onCancel: _cancelRequest,
                    releasing: _releasing,
                    releaseError: _releaseError,
                    onRelease: _releaseRequest,
                    onRetry: () => ref.invalidate(
                      taskConfigApplyRequestsProvider(task.id),
                    ),
                  ),
                  if (earlierRequests.isNotEmpty)
                    _RequestHistoryLink(
                      earlierCount: earlierRequests.length,
                      onTap: () =>
                          context.push(AppRoutes.taskRequestHistory(task.id)),
                    ),
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
      // ให้กดได้ง่ายด้วยมือเดียวโดยไม่ต้องเลื่อนจอ — error ของปุ่มย้ายมาอยู่เหนือ
      // แถวปุ่มในบาร์นี้ด้วย ไม่ทิ้งไว้บนเนื้อหาด้านบนที่ปุ่มลอยอยู่ล่างสุดเสมอ
      // (ผู้ใช้จะมองไม่เห็น error ถ้า error ยังอยู่บน)
      //
      // docs/21 #11: เดิมสองปุ่มเป็น FilledButton สีเดียวกันขนาดเท่ากัน ไม่รู้ว่าปุ่ม
      // ไหนสำคัญกว่า → ปุ่มหลักได้ปุ่มเดียว (ไว้ท้ายสุดตามกติกา Web) ตอนมีทั้งคู่
      // "ขอส่ง Config เข้าเครื่อง" เป็นปุ่มหลัก เพราะเป็นงานเฉพาะของใบงานติดตั้ง
      // ส่วน "บันทึกสถานะ" ลดเป็น outline · สองปุ่มวางเคียงกัน (ปุ่มหลักขวา) สูง 48
      // ดู `_BottomActionBar` · มีปุ่มเดียวเมื่อไหร่ ปุ่มนั้นเป็นปุ่มหลักเต็มความกว้าง
      bottomNavigationBar: (canEditStatus || showRequestButton)
          ? DecoratedBox(
              decoration: const BoxDecoration(
                color: AppColors.background,
                border: Border(top: BorderSide(color: AppColors.border)),
              ),
              child: SafeArea(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                  child: _BottomActionBar(
                    save: canEditStatus
                        ? _StatusSaveBar(
                            error: _saveError,
                            saving: _saving,
                            primary: !showRequestButton,
                            blockedMessage: completeBlocked
                                ? 'กำลังส่งเข้ากล่องอยู่ — รอผลจากกล่องก่อน'
                                      'แล้วค่อยปิดงาน'
                                : null,
                            onPressed: (!_dirty || _saving || completeBlocked)
                                ? null
                                : () => _confirmThenSave(latestRequest),
                          )
                        : null,
                    confirm: showRequestButton
                        ? _ConfirmInstallBar(
                            retry: latestRequest != null,
                            blockedMessage: _simulationBlocked
                                ? 'ผลทดสอบกับ Device Simulator ไม่ผ่าน — ส่ง '
                                      'Config ไม่ได้จนกว่าจะทดสอบซ้ำแล้วผ่าน'
                                : null,
                            onPressed: (!requestKnown || _simulationBlocked)
                                ? null
                                // คำขอล่าสุดเป็น Firmware ที่ไม่สำเร็จ — ขอซ้ำ
                                // ต้องเลือก Firmware ใหม่ ไม่ใช่ส่ง Config ของงาน
                                : latestRequest?.kind == FieldApplyKind.firmware
                                ? () => _openPicker(firmware: true)
                                : hasAssignedConfig
                                ? _openAssignedConfig
                                : _openPicker,
                          )
                        : null,
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

/// แถบปุ่มล่าง — มีปุ่มเดียว: เต็มความกว้าง · มีสองปุ่ม: เคียงกันแถวเดียว
/// (บันทึกสถานะ = รอง ซ้าย 2 ส่วน, ส่ง Config = หลัก ขวา 3 ส่วน ตามกติกา Web ที่ปุ่ม
/// หลักอยู่ท้าย) ข้อความแจ้งเตือนของทั้งสองปุ่มอยู่เหนือแถวปุ่มเต็มความกว้าง
///
/// เดิมสองปุ่มวางซ้อนกัน แถบสูง ~156dp (17% ของจอโทรศัพท์) บังเนื้อหา · แถวเดียว
/// เหลือ ~96dp · ถ้า label ไม่พอบรรทัดเดียวในความกว้างที่ได้ (จอแคบ / ผู้ใช้ตั้ง
/// ตัวอักษรใหญ่) กลับไปวางซ้อนแบบเดิม — **ไม่ย่อหรือตัดข้อความ** และปุ่มยังสูง 48
class _BottomActionBar extends StatelessWidget {
  const _BottomActionBar({this.save, this.confirm});

  final _StatusSaveBar? save;
  final _ConfirmInstallBar? confirm;

  static const _gap = 8.0;
  static const _saveFlex = 2;
  static const _confirmFlex = 3;

  /// ระยะขอบซ้ายขวาในปุ่ม (ค่าเริ่มต้นของ Material 3 ที่สเกลตัวอักษรปกติ) —
  /// ใช้ค่าสูงสุดเผื่อไว้ สเกลใหญ่ Material ลดระยะลงเองซึ่งยิ่งพอ
  static const _buttonHorizontalPadding = 24.0 * 2;

  @override
  Widget build(BuildContext context) {
    final save = this.save;
    final confirm = this.confirm;
    if (save == null || confirm == null) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ...?save?.notices(),
          ?save?.button(),
          ...?confirm?.notices(),
          ?confirm?.button(),
        ],
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final sideBySide = _fitsSideBySide(context, constraints.maxWidth);
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: sideBySide
              ? [
                  ...save.notices(),
                  ...confirm.notices(),
                  Row(
                    children: [
                      Expanded(flex: _saveFlex, child: save.button()),
                      const SizedBox(width: _gap),
                      Expanded(flex: _confirmFlex, child: confirm.button()),
                    ],
                  ),
                ]
              : [
                  ...save.notices(),
                  save.button(),
                  const SizedBox(height: 12),
                  ...confirm.notices(),
                  confirm.button(),
                ],
        );
      },
    );
  }

  /// label ยาวสุดของแต่ละปุ่มพอบรรทัดเดียวในส่วนของตัวเองไหม — วัดด้วยฟอนต์ /
  /// สเกลตัวอักษรจริงของเครื่อง (ไม่เดาจากความกว้างจอ)
  bool _fitsSideBySide(BuildContext context, double maxWidth) {
    final theme = Theme.of(context);
    final style = (theme.textTheme.labelLarge ?? const TextStyle()).merge(
      theme.filledButtonTheme.style?.textStyle?.resolve({}),
    );
    final scaler = MediaQuery.textScalerOf(context);
    final direction = Directionality.of(context);
    double labelWidth(String text) {
      final painter = TextPainter(
        text: TextSpan(text: text, style: style),
        textDirection: direction,
        textScaler: scaler,
        maxLines: 1,
      )..layout();
      final width = painter.width;
      painter.dispose();
      return width;
    }

    final available = maxWidth - _gap;
    const total = _saveFlex + _confirmFlex;
    final saveWidth = available * _saveFlex / total;
    final confirmWidth = available * _confirmFlex / total;
    return labelWidth(_StatusSaveBar.label) + _buttonHorizontalPadding <=
            saveWidth &&
        _ConfirmInstallBar.labels
            .map(labelWidth)
            .every((w) => w + _buttonHorizontalPadding <= confirmWidth);
  }
}

class _StatusSaveBar {
  const _StatusSaveBar({
    required this.error,
    required this.saving,
    required this.primary,
    required this.onPressed,
    this.blockedMessage,
  });

  /// เหตุผลที่กดบันทึกไม่ได้ (docs/28 — ปิดงานระหว่างกำลังส่งเข้ากล่อง)
  final String? blockedMessage;

  static const label = 'บันทึกสถานะ';

  final String? error;
  final bool saving;

  /// `false` ตอนแถบล่างมีปุ่ม "ยืนยันส่ง Config เข้าเครื่อง" ด้วย — ปุ่มนี้ลดเป็น
  /// outline ให้เหลือปุ่มหลักปุ่มเดียว (docs/21 #11)
  final bool primary;
  final VoidCallback? onPressed;

  List<Widget> notices() => [
    if (blockedMessage != null)
      _BarNotice(
        message: blockedMessage!,
        textKey: const Key('task_complete_blocked'),
        icon: Icons.hourglass_top,
      ),
    if (error != null)
      _BarNotice(message: error!, textKey: const Key('task_status_error')),
  ];

  Widget button() {
    const key = Key('task_status_save');
    final child = saving
        ? _ButtonSpinner(
            color: primary ? AppColors.primaryForeground : AppColors.foreground,
          )
        : const Text(label, maxLines: 1);
    return primary
        ? FilledButton(key: key, onPressed: onPressed, child: child)
        : OutlinedButton(key: key, onPressed: onPressed, child: child);
  }
}

/// ปุ่ม "ส่ง Config เข้าเครื่อง" ในแถบล่าง (docs/25, docs/27 §2.2) — key เดิม
/// `confirm_install_button` · พาไปหน้าพารามิเตอร์ (Config ที่ผูกกับงาน) หรือหน้า
/// เลือก ซึ่งเป็นที่ส่ง/ขออนุมัติจริง
class _ConfirmInstallBar {
  const _ConfirmInstallBar({
    required this.retry,
    required this.onPressed,
    this.blockedMessage,
  });

  /// คำขอล่าสุดจบแบบไม่สำเร็จ — ปุ่มเป็น "ส่งอีกครั้ง"
  final bool retry;
  final VoidCallback? onPressed;

  /// Why the button is disabled by a failed simulator check (null = not
  /// blocked). Shown above the button.
  final String? blockedMessage;

  static const _label = 'ส่ง Config เข้าเครื่อง';
  static const _retryLabel = 'ส่งอีกครั้ง';

  /// ทุก label ที่ปุ่มนี้แสดงได้ — `_BottomActionBar` วัดทุกตัวเพื่อไม่ให้แถบ
  /// สลับ layout ไปมาตอนข้อความเปลี่ยน
  static const labels = [_label, _retryLabel];

  List<Widget> notices() => [
    if (blockedMessage != null)
      _BarNotice(
        message: blockedMessage!,
        textKey: const Key('simulate_blocked_message'),
        icon: Icons.block,
      ),
  ];

  Widget button() => FilledButton(
    key: const Key('confirm_install_button'),
    onPressed: onPressed,
    child: Text(retry ? _retryLabel : _label, maxLines: 1),
  );
}

/// สถานะคำขอล่าสุดในการ์ด "ส่ง Config เข้าเครื่อง" (docs/25 §3.3 ตารางการ์ด) —
/// ไม่มีคำขอ = ไม่แสดงอะไร (ปุ่มขอส่งอยู่แถบล่าง) · `pending` มีปุ่มยกเลิก ·
/// `approved` (docs/27) มีปุ่มหลัก "ส่งเข้ากล่อง" + ยกเลิก · จบแบบไม่สำเร็จบอก
/// เหตุผล แล้วขอส่งอีกครั้งจากแถบล่าง
class _ApplyRequestSection extends StatelessWidget {
  const _ApplyRequestSection({
    required this.request,
    required this.cancelling,
    required this.cancelError,
    required this.onCancel,
    required this.releasing,
    required this.releaseError,
    required this.onRelease,
    required this.onRetry,
  });

  final AsyncValue<ConfigApplyRequest?> request;
  final bool cancelling;
  final String? cancelError;
  final ValueChanged<String> onCancel;
  final bool releasing;
  final String? releaseError;
  final ValueChanged<String> onRelease;
  final VoidCallback onRetry;

  static const _mutedStyle = TextStyle(
    fontSize: AppTypography.xs,
    height: AppTypography.xsHeight,
    color: AppColors.mutedForeground,
  );

  @override
  Widget build(BuildContext context) {
    return request.when(
      skipLoadingOnRefresh: true,
      skipLoadingOnReload: true,
      loading: () => const Padding(
        padding: EdgeInsets.only(top: 12),
        child: Text(
          'กำลังโหลดสถานะคำขอ...',
          key: Key('apply_request_loading'),
          style: _mutedStyle,
        ),
      ),
      error: (_, _) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 12),
          const AppNotice(
            tone: AppBadgeTone.danger,
            icon: Icons.error_outline,
            child: Text(
              'โหลดสถานะคำขอไม่สำเร็จ — ขอส่งได้เมื่อโหลดสำเร็จ',
              key: Key('apply_request_load_error'),
            ),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              key: const Key('apply_request_retry'),
              onPressed: onRetry,
              child: const Text('ลองใหม่'),
            ),
          ),
        ],
      ),
      data: (latest) {
        if (latest == null) return const SizedBox.shrink();
        final lines = _lines(latest);
        final showDowngrade =
            latest.isDowngrade &&
            (latest.status == ConfigApplyRequestStatus.pending ||
                latest.status == ConfigApplyRequestStatus.approved);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 12),
            AppNotice(
              key: const Key('apply_request_status'),
              tone: configApplyRequestTone(latest.status),
              icon: _icon(latest.status),
              title: configApplyRequestStatusLabel(
                latest.status,
                kind: latest.kind,
              ),
              child: lines.isEmpty
                  ? null
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [for (final line in lines) Text(line)],
                    ),
            ),
            // docs/27 §9 — คำขอถอยเวอร์ชัน: แถบเตือนสีส้มก่อนกดส่ง
            if (showDowngrade) ...[
              const SizedBox(height: 8),
              AppNotice(
                key: const Key('apply_request_downgrade'),
                tone: AppBadgeTone.warning,
                icon: Icons.warning_amber_rounded,
                child: Text(
                  'ถอยเวอร์ชัน Firmware จาก v${latest.fromFirmwareVersion ?? '-'} '
                  'เป็น v${latest.firmwareVersion ?? '-'} — ค่าบางอย่างที่ Firmware '
                  'เก่าไม่รู้จักจะใช้ไม่ได้',
                ),
              ),
            ],
            if (latest.status == ConfigApplyRequestStatus.approved) ...[
              const SizedBox(height: 8),
              FilledButton.icon(
                key: const Key('release_apply_request_button'),
                onPressed: releasing || cancelling
                    ? null
                    : () => onRelease(latest.id),
                icon: releasing
                    ? const _ButtonSpinner(color: AppColors.primaryForeground)
                    : const Icon(Icons.send),
                label: const Text('ส่งเข้ากล่อง'),
              ),
            ],
            if (releaseError != null) ...[
              const SizedBox(height: 8),
              AppNotice(
                tone: AppBadgeTone.danger,
                icon: Icons.error_outline,
                child: Text(
                  releaseError!,
                  key: const Key('release_apply_request_error'),
                ),
              ),
            ],
            if (latest.status == ConfigApplyRequestStatus.pending ||
                latest.status == ConfigApplyRequestStatus.approved) ...[
              const SizedBox(height: 8),
              OutlinedButton(
                key: const Key('cancel_apply_request_button'),
                onPressed: cancelling || releasing
                    ? null
                    : () => onCancel(latest.id),
                child: cancelling
                    ? const _ButtonSpinner(color: AppColors.foreground)
                    : const Text('ยกเลิกคำขอ'),
              ),
            ],
            if (cancelError != null) ...[
              const SizedBox(height: 8),
              AppNotice(
                tone: AppBadgeTone.danger,
                icon: Icons.error_outline,
                child: Text(
                  cancelError!,
                  key: const Key('cancel_apply_request_error'),
                ),
              ),
            ],
          ],
        );
      },
    );
  }

  static List<String> _lines(ConfigApplyRequest r) {
    final detail = r.resultDetail?.trim();
    final reason = r.rejectReason?.trim();
    return [
      // คำขอ Firmware บอกเวอร์ชันที่ขอเสมอ (docs/27 B3) — คำขอ Config ไม่มีบรรทัดนี้
      if (r.kind == FieldApplyKind.firmware) _firmwareLine(r),
      ..._overrideLines(r),
      ..._statusLines(r, detail, reason),
    ];
  }

  /// docs/30 §6 — คำขอที่มาจาก Config Override: ค่าที่ขอแก้ + เหตุผล · ยกเลิกหรือ
  /// หมดอายุ**หลัง**อนุมัติ ค่าถูกอนุมัติแล้วจะติดไปกับการส่ง Config ครั้งถัดไป
  static List<String> _overrideLines(ConfigApplyRequest r) {
    final override = r.override;
    if (override == null) return const [];
    final approvedThenClosed =
        r.decidedAt != null &&
        (r.status == ConfigApplyRequestStatus.cancelled ||
            r.status == ConfigApplyRequestStatus.expired);
    return [
      for (final e in override.fields.entries)
        'ขอแก้ ${e.key} → ${configValueToInput(e.value)}',
      if (override.reason.trim().isNotEmpty)
        'เหตุผลที่ขอแก้: ${override.reason.trim()}',
      if (approvedThenClosed)
        'ค่าที่ขอแก้อนุมัติแล้ว จะติดไปกับการส่ง Config ตัวนี้ครั้งถัดไป',
    ];
  }

  static String _firmwareLine(ConfigApplyRequest r) {
    final target = 'Firmware v${r.firmwareVersion ?? '-'}';
    final from = r.fromFirmwareVersion;
    return from == null ? target : '$target (กล่องรัน v$from ตอนขอ)';
  }

  static List<String> _statusLines(
    ConfigApplyRequest r,
    String? detail,
    String? reason,
  ) {
    return switch (r.status) {
      ConfigApplyRequestStatus.pending => [
        'ส่งคำขอเมื่อ ${_formatDate(r.requestedAt)}',
        'หมดอายุ ${_formatDate(r.expiresAt)} ถ้ายังไม่มีใครตัดสิน',
      ],
      ConfigApplyRequestStatus.approved => [
        if (r.decidedAt != null) 'อนุมัติเมื่อ ${_formatDate(r.decidedAt!)}',
        'กดส่งได้ถึง ${_formatDate(r.expiresAt)} — อยู่หน้ากล่องและกล่องเปิดอยู่ก่อนกดส่ง',
      ],
      ConfigApplyRequestStatus.sending => [
        if (r.releasedAt != null) 'กดส่งเมื่อ ${_formatDate(r.releasedAt!)}',
      ],
      ConfigApplyRequestStatus.succeeded => [
        if (r.completedAt != null) 'เมื่อ ${_formatDate(r.completedAt!)}',
      ],
      ConfigApplyRequestStatus.rejected => [
        if (reason != null && reason.isNotEmpty) 'เหตุผล: $reason',
      ],
      ConfigApplyRequestStatus.failed ||
      ConfigApplyRequestStatus.skippedOffline ||
      ConfigApplyRequestStatus.cancelled ||
      ConfigApplyRequestStatus.expired => [
        if (detail != null && detail.isNotEmpty) detail,
      ],
    };
  }

  static IconData _icon(ConfigApplyRequestStatus status) => switch (status) {
    ConfigApplyRequestStatus.pending => Icons.hourglass_top,
    ConfigApplyRequestStatus.approved => Icons.task_alt,
    ConfigApplyRequestStatus.sending => Icons.send_outlined,
    ConfigApplyRequestStatus.succeeded => Icons.check_circle_outline,
    ConfigApplyRequestStatus.failed ||
    ConfigApplyRequestStatus.skippedOffline ||
    ConfigApplyRequestStatus.rejected => Icons.error_outline,
    ConfigApplyRequestStatus.cancelled => Icons.block,
    ConfigApplyRequestStatus.expired => Icons.timer_off_outlined,
  };
}

/// ปุ่มไปหน้าประวัติคำขอ (docs/28 — งาน 1 ใบขอได้หลายครั้ง) ใต้การ์ดคำขอล่าสุด
/// · เดิมแสดงทุกคำขอในหน้านี้ รายการยาวอัดหน้างาน จึงย้ายไป
/// [ApplyRequestHistoryPage] · กดได้ทั้งแถว สูงอย่างน้อย 48dp
class _RequestHistoryLink extends StatelessWidget {
  const _RequestHistoryLink({required this.earlierCount, required this.onTap});

  final int earlierCount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: InkWell(
        key: const Key('apply_request_history'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Row(
            children: [
              const Icon(Icons.history, size: 20, color: AppColors.primary),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'ประวัติคำขอ',
                  style: TextStyle(
                    fontSize: AppTypography.sm,
                    height: AppTypography.smHeight,
                    fontWeight: FontWeight.w600,
                    color: AppColors.primary,
                  ),
                ),
              ),
              Text(
                'ก่อนหน้า $earlierCount ครั้ง',
                style: const TextStyle(
                  fontSize: AppTypography.sm,
                  height: AppTypography.smHeight,
                  color: AppColors.mutedForeground,
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
      ),
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
