import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_ink_header.dart';
import '../../core/ui/app_v2_theme.dart';
import 'config_apply_request_repository.dart';
import 'task_repository.dart';

/// ช่วงเวลาที่ถามความคืบหน้าซ้ำ (เฉพาะตอนเปิดหน้านี้และคำขอยังไม่จบ)
const progressPollInterval = Duration(seconds: 2);

/// หน้า "ส่งเข้ากล่อง" (mockup ที่ B เลือก 4 พ.ย. 2569) — เปิดเองหลังกดส่ง และ
/// เปิดซ้ำได้จากแถบในหน้างาน · ถาม `GET /tasks/{taskId}/config-apply-requests/
/// {id}/progress` ทุก [progressPollInterval] · ภาพกลางจอเปลี่ยนตามขั้นที่กล่อง
/// รายงานจริงผ่าน Server กลาง ไม่มีข้อมูลขั้นตอน (ไม่ใช่โหมด central หรือ
/// Server กลางล่ม) = เหลือ 3 ขั้นตามสถานะคำขอของเรา · ลองส่งใหม่อัตโนมัติ
/// (docs/31 §3.7): ป้าย "รอบ 2/3", นับถอยหลังตอนรอรอบใหม่ และประวัติการส่งรายรอบ
class ConfigApplyProgressPage extends ConsumerStatefulWidget {
  const ConfigApplyProgressPage({
    super.key,
    required this.taskId,
    required this.requestId,
  });

  final String taskId;
  final String requestId;

  @override
  ConsumerState<ConfigApplyProgressPage> createState() =>
      _ConfigApplyProgressPageState();
}

/// ผลรวมของคำขอที่หน้านี้ใช้วาด
enum _Outcome { running, succeeded, rolledBack, failed }

class _ConfigApplyProgressPageState
    extends ConsumerState<ConfigApplyProgressPage>
    with TickerProviderStateMixin {
  late final AnimationController _loop;
  late final AnimationController _finish;
  Timer? _tick;
  Timer? _poll;
  ConfigApplyRequestProgress? _progress;
  Object? _error;
  bool _loading = false;
  bool _invalidated = false;
  bool _reducedMotion = false;

  /// คำขอที่หน้านี้ติดตามอยู่ — เริ่มจากคำขอที่เปิดมา แล้วเปลี่ยนเป็นคำขอใหม่เมื่อ
  /// กด "ส่งใหม่อีกครั้ง" (ติดตามต่อในหน้าเดิม ไม่พาไปหน้าเลือกใหม่)
  late String _requestId = widget.requestId;

  /// กำลังยื่นคำขอใหม่หรือกดส่งเข้ากล่อง — กันกดซ้ำ
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loop = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2400),
    );
    _finish = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );
    _startPolling();
  }

  void _startPolling() {
    _tick?.cancel();
    _poll?.cancel();
    unawaited(_load());
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && !_done) setState(() {});
    });
    _poll = Timer.periodic(progressPollInterval, (_) {
      if (!_done) unawaited(_load());
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reducedMotion = MediaQuery.disableAnimationsOf(context);
    _syncMotion();
  }

  @override
  void dispose() {
    _tick?.cancel();
    _poll?.cancel();
    _loop.dispose();
    _finish.dispose();
    super.dispose();
  }

  bool get _done => _outcome(_progress) != _Outcome.running;

  void _syncMotion() {
    if (_reducedMotion) {
      _loop.stop();
      _finish.value = _done ? 1 : 0;
      return;
    }
    if (_done) {
      _loop.stop();
      if (_finish.status == AnimationStatus.dismissed) _finish.forward();
    } else if (!_loop.isAnimating) {
      _loop.repeat();
    }
  }

  Future<void> _load() async {
    if (_loading || !mounted) return;
    _loading = true;
    final requestId = _requestId;
    try {
      final progress = await ref
          .read(configApplyRequestRepositoryProvider)
          .progress(widget.taskId, requestId);
      // ระหว่างรอผล กดส่งใหม่ไปแล้ว = ผลของคำขอเก่า ไม่ใช้
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _progress = progress;
        _error = null;
      });
      if (_done) {
        _poll?.cancel();
        _tick?.cancel();
        // จบแล้วให้หน้างานและรายการคำขอโหลดใหม่ทันที ไม่ต้องรอรอบ refresh
        if (!_invalidated) {
          _invalidated = true;
          ref.invalidate(taskConfigApplyRequestsProvider(widget.taskId));
          ref.invalidate(taskDetailProvider(widget.taskId));
        }
      }
      _syncMotion();
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      _loading = false;
    }
  }

  /// เปลี่ยนไปติดตามคำขอใหม่ในหน้าเดิม — เริ่มถาม/นับใหม่ และวาดใหม่ตั้งแต่ต้น
  void _follow(String requestId) {
    setState(() {
      _requestId = requestId;
      _progress = null;
      _error = null;
      _invalidated = false;
    });
    _finish.reset();
    _syncMotion();
    _startPolling();
  }

  void _toast(String message) {
    ScaffoldMessenger.maybeOf(context)
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  void _refreshTask() {
    ref.invalidate(taskConfigApplyRequestsProvider(widget.taskId));
    ref.invalidate(taskDetailProvider(widget.taskId));
  }

  /// ส่งใหม่ด้วยของชิ้นเดิม (B 12 พ.ย. 2569): Firmware = ขออนุมัติใหม่ (ยังต้องรอ
  /// Operation ตามหลักแยกหน้าที่) · Config ที่อนุมัติแล้วไม่มีค่าแก้ = ส่งตรงแล้วส่ง
  /// เข้ากล่องทันที · ส่งของเดิมซ้ำไม่ได้ (มีค่าแก้เฉพาะเครื่องซึ่งใช้ได้ครั้งเดียว,
  /// Operation ไม่อนุมัติ, ยกเลิก, หมดอายุ) = ไปหน้าเลือกเหมือนเดิม
  Future<void> _resend(String deviceId, {required bool firmware}) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final repo = ref.read(configApplyRequestRepositoryProvider);
      final requests = await repo.listForTask(widget.taskId);
      final source = requests.where((r) => r.id == _requestId).firstOrNull;
      if (source == null || !_canResendSame(source)) {
        if (mounted) _openApplyForm(deviceId, firmware: firmware);
        return;
      }
      String message;
      ConfigApplyRequest created;
      if (source.kind == FieldApplyKind.firmware) {
        created = await repo.create(
          widget.taskId,
          firmwareId: source.firmwareId,
        );
        message = 'ส่งคำขอใหม่แล้ว — รอ Operation อนุมัติ';
      } else {
        created = await repo.create(
          widget.taskId,
          configId: source.configId,
          direct: true,
        );
        try {
          created = await repo.release(created.id);
          message = 'กำลังส่ง Config เข้ากล่องอีกครั้ง';
        } on ApiException catch (e) {
          message = 'ยังส่งเข้ากล่องไม่ได้: ${e.message}';
        }
      }
      if (!mounted) return;
      _refreshTask();
      _follow(created.id);
      _toast(message);
    } on ApiException catch (e) {
      if (mounted) _toast(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// ช่างกดส่งคำขอที่ Operation อนุมัติแล้วเข้ากล่อง (docs/27) จากหน้านี้
  Future<void> _release() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await ref.read(configApplyRequestRepositoryProvider).release(_requestId);
      if (!mounted) return;
      _refreshTask();
      await _load();
    } on ApiException catch (e) {
      if (mounted) _toast(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _openApplyForm(String deviceId, {required bool firmware}) {
    GoRouter.maybeOf(context)?.go(
      AppRoutes.deviceApply(
        deviceId,
        taskId: widget.taskId,
        firmware: firmware,
      ),
    );
  }

  void _close() {
    final router = GoRouter.maybeOf(context);
    if (router == null) return;
    if (router.canPop()) {
      router.pop();
    } else {
      router.go(AppRoutes.taskDetail(widget.taskId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final progress = _progress;
    final task = ref.watch(taskDetailProvider(widget.taskId)).valueOrNull;
    final outcome = _outcome(progress);
    final steps = _stepsFor(progress, outcome);
    final current = steps.where((s) => s.state == _StepState.now).firstOrNull;
    final isFirmware = progress?.kind == FieldApplyKind.firmware;
    final elapsed = _elapsedSeconds(progress, outcome);
    // เปิดคำขอเก่าจากหน้าประวัติ (มีคำขอใหม่กว่าแล้ว) = ไม่ให้ส่งของเก่าซ้ำ ·
    // ยังโหลดรายการไม่เสร็จ = ถือว่าเป็นตัวล่าสุด (เปิดมาจากการกดส่งเกือบทุกครั้ง)
    final latestId = ref
        .watch(taskConfigApplyRequestsProvider(widget.taskId))
        .valueOrNull
        ?.firstOrNull
        ?.id;
    final isLatest = latestId == null || latestId == _requestId;
    final retry =
        isLatest &&
        (outcome == _Outcome.rolledBack || outcome == _Outcome.failed);
    final deviceId = task?.deviceId;
    final awaitingRelease =
        progress?.status == ConfigApplyRequestStatus.approved &&
        progress?.releasedAt == null;
    final attemptBadge = _badgeAttempt(progress, outcome);
    final attempts = progress?.retry?.attempts ?? const <ConfigApplyAttempt>[];

    return AppV2Theme(
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AppInkHeader(
              title: isFirmware
                  ? 'ส่ง Firmware เข้ากล่อง'
                  : 'ส่ง Config เข้ากล่อง',
              subtitle: deviceId,
              onBack: _close,
            ),
            Expanded(
              child: ListView(
                key: const Key('apply_progress_list'),
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                children: [
                  SizedBox(
                    height: 220,
                    child: Center(
                      child: _ProgressScene(
                        loop: _loop,
                        finish: _finish,
                        value: _percent(steps, outcome),
                        outcome: outcome,
                        stage: current?.key,
                        reducedMotion: _reducedMotion,
                      ),
                    ),
                  ),
                  Semantics(
                    liveRegion: true,
                    child: Column(
                      children: [
                        Text(
                          _headline(progress, current, outcome),
                          key: const Key('apply_progress_headline'),
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: AppTypography.lg,
                            height: AppTypography.lgHeight,
                            fontWeight: FontWeight.w700,
                            color: AppColors.foreground,
                          ),
                        ),
                        // ยังไม่ได้ส่งเข้ากล่อง (รออนุมัติ) = ยังไม่มีเวลาให้นับ
                        if (progress?.releasedAt != null)
                          Text(
                            '${outcome == _Outcome.running ? 'ผ่านไป' : 'ใช้เวลา'} '
                            '${_mmss(elapsed)}',
                            key: const Key('apply_progress_elapsed'),
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontSize: AppTypography.sm,
                              height: AppTypography.smHeight,
                              color: AppColors.mutedForeground,
                              fontFeatures: [FontFeature.tabularFigures()],
                            ),
                          ),
                        if (attemptBadge != null) ...[
                          const SizedBox(height: 8),
                          KeyedSubtree(
                            key: const Key('apply_progress_attempt_badge'),
                            // เริ่มรอบใหม่ = ป้ายเด้งเข้ามาพร้อมเลขรอบใหม่
                            child: AnimatedSwitcher(
                              duration: _reducedMotion
                                  ? Duration.zero
                                  : const Duration(milliseconds: 350),
                              transitionBuilder: (child, animation) =>
                                  FadeTransition(
                                    opacity: animation,
                                    child: ScaleTransition(
                                      scale: Tween(begin: .6, end: 1.0).animate(
                                        CurvedAnimation(
                                          parent: animation,
                                          curve: Curves.easeOutBack,
                                        ),
                                      ),
                                      child: child,
                                    ),
                                  ),
                              child: AppBadge(
                                key: ValueKey(attemptBadge),
                                label:
                                    'รอบ $attemptBadge/'
                                    '${progress!.retry!.maxAttempts}',
                                tone: AppBadgeTone.info,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (_error != null && progress == null) ...[
                    const SizedBox(height: 8),
                    Center(
                      child: TextButton.icon(
                        key: const Key('apply_progress_retry_load'),
                        onPressed: _load,
                        icon: const Icon(Icons.refresh),
                        label: const Text('โหลดความคืบหน้าอีกครั้ง'),
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  if (progress != null) ...[
                    _VersionCard(progress: progress),
                    const SizedBox(height: 10),
                  ],
                  AppCard(
                    key: const Key('apply_progress_steps'),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (final (i, step) in steps.indexed)
                          _StepRow(
                            step: step,
                            last: i == steps.length - 1,
                            reducedMotion: _reducedMotion,
                          ),
                      ],
                    ),
                  ),
                  if (_showHistory(attempts)) ...[
                    const SizedBox(height: 10),
                    _AttemptHistory(
                      // คำขอใหม่ = สร้างการ์ดใหม่ (สถานะพับ/กางเริ่มใหม่)
                      key: ValueKey('history_$_requestId'),
                      attempts: attempts,
                      collapsed: outcome == _Outcome.succeeded,
                    ),
                  ],
                  if (outcome != _Outcome.running && progress != null) ...[
                    const SizedBox(height: 10),
                    _ResultCard(
                      progress: progress,
                      outcome: outcome,
                      elapsed: elapsed,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
        bottomNavigationBar: SafeArea(
          minimum: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: FilledButton(
            key: const Key('apply_progress_bottom'),
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
            ),
            onPressed: _busy
                ? null
                : retry && deviceId != null
                ? () => _resend(deviceId, firmware: isFirmware)
                : awaitingRelease
                ? _release
                : _close,
            child: Text(
              retry && deviceId != null
                  ? 'ส่งใหม่อีกครั้ง'
                  : awaitingRelease
                  ? 'ส่งเข้ากล่อง'
                  : progress?.status == ConfigApplyRequestStatus.pending
                  ? 'กลับไปหน้างาน'
                  : outcome == _Outcome.running
                  ? 'ส่งต่อเบื้องหลัง กลับไปหน้างาน'
                  : 'กลับไปหน้างาน',
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// ข้อมูล -> ขั้นตอน

enum _StepState { done, now, todo, fail }

class _Step {
  const _Step(this.key, this.label, this.state, {this.at, this.progress});
  final ConfigApplyProgressStepKey key;
  final String label;
  final _StepState state;
  final DateTime? at;
  final int? progress;
}

const _firmwareFlow = [
  ConfigApplyProgressStepKey.delivered,
  ConfigApplyProgressStepKey.downloading,
  ConfigApplyProgressStepKey.validating,
  ConfigApplyProgressStepKey.installing,
  ConfigApplyProgressStepKey.rebooting,
];

const _configFlow = [
  ConfigApplyProgressStepKey.delivered,
  ConfigApplyProgressStepKey.installing,
];

const _terminalKeys = {
  ConfigApplyProgressStepKey.succeeded,
  ConfigApplyProgressStepKey.rolledBack,
  ConfigApplyProgressStepKey.failed,
  ConfigApplyProgressStepKey.expired,
};

String _stepLabel(ConfigApplyProgressStepKey key, {required bool firmware}) =>
    switch (key) {
      ConfigApplyProgressStepKey.delivered => 'ส่งถึงกล่อง',
      ConfigApplyProgressStepKey.downloading => 'ดาวน์โหลด',
      ConfigApplyProgressStepKey.validating => 'ตรวจลายเซ็น',
      ConfigApplyProgressStepKey.installing =>
        firmware ? 'ติดตั้ง' : 'กล่องรับค่าใหม่',
      ConfigApplyProgressStepKey.rebooting => 'รีบูตและยืนยันตัวเอง',
      ConfigApplyProgressStepKey.succeeded => 'ยืนยันผล',
      ConfigApplyProgressStepKey.rolledBack => 'กล่องย้อนกลับ',
      ConfigApplyProgressStepKey.failed => 'ส่งไม่สำเร็จ',
      ConfigApplyProgressStepKey.expired => 'หมดเวลา',
    };

bool _hasCentralSteps(ConfigApplyRequestProgress? p) =>
    p?.central?.available == true && p!.central!.steps.isNotEmpty;

/// ผลรวม — จบเมื่อสถานะคำขอจบจริงเท่านั้น: กล่องย้อนกลับ/ล้มในรอบหนึ่งขณะคำขอยัง
/// sending = backend ยังไม่ปิดรอบ (อาจลองรอบใหม่) จึงยังไม่จบ · สำเร็จรู้ได้จาก
/// ขั้นตอนของกล่องก่อน backend ปิดคำขอ (ไม่มีรอบต่อจากความสำเร็จ)
_Outcome _outcome(ConfigApplyRequestProgress? p) {
  if (p == null) return _Outcome.running;
  final last = _lastCentralKey(p);
  if (p.status == ConfigApplyRequestStatus.succeeded ||
      last == ConfigApplyProgressStepKey.succeeded) {
    return _Outcome.succeeded;
  }
  if (p.status.isInFlight) return _Outcome.running;
  if (last == ConfigApplyProgressStepKey.rolledBack) return _Outcome.rolledBack;
  return _Outcome.failed;
}

ConfigApplyProgressStepKey? _lastCentralKey(ConfigApplyRequestProgress? p) =>
    _hasCentralSteps(p) ? p!.central!.steps.last.key : null;

/// รอบนี้กล่องย้อนกลับ/ล้มแล้ว แต่คำขอยังไม่จบ (ช่วงที่ backend กำลังปิดรอบ)
bool _attemptEnded(ConfigApplyRequestProgress? p, _Outcome outcome) {
  final last = _lastCentralKey(p);
  return outcome == _Outcome.running &&
      last != null &&
      _terminalKeys.contains(last) &&
      last != ConfigApplyProgressStepKey.succeeded;
}

/// ส่งของชิ้นเดิมซ้ำได้เลย — ล้มตอนส่ง (ไม่ใช่ถูกปฏิเสธ/ยกเลิก/หมดอายุ) และไม่มี
/// ค่าแก้เฉพาะเครื่อง (Override ใช้ได้ครั้งเดียว ถูกใช้ไปกับคำขอเดิมแล้ว)
bool _canResendSame(ConfigApplyRequest r) =>
    (r.status == ConfigApplyRequestStatus.failed ||
        r.status == ConfigApplyRequestStatus.skippedOffline) &&
    r.override == null &&
    (r.kind == FieldApplyKind.firmware
        ? r.firmwareId != null
        : r.configId != null);

/// กำลังรอส่งรอบใหม่ (docs/31) — backend ให้ `nextRetryAt` เฉพาะช่วงนี้
bool _waitingRetry(ConfigApplyRequestProgress? p, _Outcome outcome) =>
    outcome == _Outcome.running && p?.retry?.nextRetryAt != null;

/// เลขรอบบนป้าย — รอรอบใหม่ = รอบที่กำลังจะส่ง · null = ไม่แสดง (ยังเป็นรอบแรก)
int? _badgeAttempt(ConfigApplyRequestProgress? p, _Outcome outcome) {
  final retry = p?.retry;
  if (retry == null || retry.maxAttempts <= 1) return null;
  final n = _waitingRetry(p, outcome) ? retry.attemptNo + 1 : retry.attemptNo;
  return n > 1 ? n : null;
}

/// ประวัติแสดงเมื่อมีมากกว่า 1 รอบ หรือรอบเดียวที่ไม่สำเร็จ
bool _showHistory(List<ConfigApplyAttempt> attempts) =>
    attempts.length > 1 ||
    attempts.any(
      (a) =>
          a.status == ConfigApplyAttemptStatus.failed ||
          a.status == ConfigApplyAttemptStatus.skipped,
    );

ConfigApplyProgressStepKey _finalKey(_Outcome outcome) => switch (outcome) {
  _Outcome.rolledBack => ConfigApplyProgressStepKey.rolledBack,
  _Outcome.failed => ConfigApplyProgressStepKey.failed,
  _ => ConfigApplyProgressStepKey.succeeded,
};

List<_Step> _stepsFor(ConfigApplyRequestProgress? p, _Outcome outcome) {
  final firmware = p?.kind == FieldApplyKind.firmware;
  final running = outcome == _Outcome.running;
  final finalKey = _finalKey(outcome);
  final finalState = switch (outcome) {
    _Outcome.succeeded => _StepState.done,
    _Outcome.running => _StepState.todo,
    _ => _StepState.fail,
  };

  if (!_hasCentralSteps(p)) {
    // ไม่มีขั้นตอนจริงจากกล่อง — 3 ขั้นตามสถานะคำขอของเรา · รอรอบใหม่ = รอบนี้ยัง
    // ไม่ได้ส่ง · รอบใหม่กำลังส่ง = ยังไม่ถึงกล่อง (docs/31)
    final latest = p?.retry?.attempts.lastOrNull;
    // ยังไม่ได้ส่งเข้ากล่อง (รอ Operation อนุมัติ / รอช่างกดส่ง) = ยังไม่ถึงขั้นไหน
    final waiting =
        _waitingRetry(p, outcome) || (running && p?.releasedAt == null);
    final sending =
        running && latest?.status == ConfigApplyAttemptStatus.sending;
    return [
      _Step(
        ConfigApplyProgressStepKey.delivered,
        'ส่งถึงกล่อง',
        waiting
            ? _StepState.todo
            : sending
            ? _StepState.now
            : _StepState.done,
        at: waiting || sending ? null : (latest?.startedAt ?? p?.releasedAt),
      ),
      _Step(
        ConfigApplyProgressStepKey.installing,
        firmware ? 'กล่องกำลังติดตั้ง' : 'กล่องกำลังรับค่าใหม่',
        !running
            ? _StepState.done
            : waiting || sending
            ? _StepState.todo
            : _StepState.now,
      ),
      _Step(
        finalKey,
        _stepLabel(finalKey, firmware: firmware),
        finalState,
        at: running ? null : p?.completedAt,
      ),
    ];
  }

  final reported = {for (final s in p!.central!.steps) s.key: s};
  final last = p.central!.steps.last.key;
  final flow = firmware ? _firmwareFlow : _configFlow;
  // ขั้นล่าสุดที่กล่องรายงาน — ขั้นก่อนหน้าทั้งหมดถือว่าผ่านแล้ว
  final reached = _terminalKeys.contains(last)
      ? flow.length
      : math.max(0, flow.indexOf(last));
  return [
    for (final (i, key) in flow.indexed)
      _Step(
        key,
        _stepLabel(key, firmware: firmware),
        i < reached || (!running && reported.containsKey(key))
            ? _StepState.done
            : i == reached && running
            ? _StepState.now
            : _StepState.todo,
        at: reported[key]?.at,
        progress: reported[key]?.progress,
      ),
    _Step(
      finalKey,
      _stepLabel(finalKey, firmware: firmware),
      finalState,
      at: reported[finalKey]?.at ?? (running ? null : p.completedAt),
    ),
  ];
}

int _elapsedSeconds(ConfigApplyRequestProgress? p, _Outcome outcome) {
  final start = p?.releasedAt;
  if (start == null) return 0;
  final end = outcome == _Outcome.running
      ? DateTime.now()
      : (p!.completedAt ?? DateTime.now());
  return math.max(0, end.difference(start).inSeconds);
}

/// ความยาววงแหวน 0..1 — จบแล้วเต็มวง · กำลังทำ = ขั้นที่ผ่าน + ครึ่งขั้นปัจจุบัน
/// (ดาวน์โหลดใช้ % จริง)
double _percent(List<_Step> steps, _Outcome outcome) {
  if (outcome != _Outcome.running) return 1;
  final now = steps.indexWhere((s) => s.state == _StepState.now);
  if (now < 0) return .05;
  final within = steps[now].key == ConfigApplyProgressStepKey.downloading
      ? (steps[now].progress ?? 0) / 100
      : .5;
  return ((now + within) / steps.length).clamp(.05, .97);
}

String _headline(
  ConfigApplyRequestProgress? p,
  _Step? current,
  _Outcome outcome,
) {
  if (p == null) return 'กำลังโหลดความคืบหน้า';
  final firmware = p.kind == FieldApplyKind.firmware;
  switch (outcome) {
    case _Outcome.succeeded:
      return firmware ? 'ติดตั้งสำเร็จ' : 'กล่องรับค่าใหม่แล้ว';
    case _Outcome.rolledBack:
      return 'กล่องย้อนกลับเวอร์ชันเดิม';
    case _Outcome.failed:
      return switch (p.status) {
        ConfigApplyRequestStatus.rejected => 'Operation ไม่อนุมัติ',
        ConfigApplyRequestStatus.cancelled => 'ยกเลิกคำขอแล้ว',
        ConfigApplyRequestStatus.expired => 'คำขอหมดอายุ',
        _ => 'ส่งไม่สำเร็จ',
      };
    case _Outcome.running:
      break;
  }
  if (p.status == ConfigApplyRequestStatus.pending) {
    return 'รอ Operation อนุมัติ';
  }
  if (p.status == ConfigApplyRequestStatus.approved && p.releasedAt == null) {
    return 'อนุมัติแล้ว กดส่งเข้ากล่องได้เลย';
  }
  final nextAt = p.retry?.nextRetryAt;
  if (nextAt != null) {
    final left = (nextAt.difference(DateTime.now()).inMilliseconds / 1000)
        .ceil();
    return left > 0 ? 'จะลองใหม่ในอีก ${_mmss(left)}' : 'กำลังเริ่มรอบใหม่';
  }
  if (_attemptEnded(p, outcome)) {
    final retry = p.retry;
    final more = retry != null && retry.attemptNo < retry.maxAttempts;
    if (!more) return 'กำลังสรุปผล';
    return _lastCentralKey(p) == ConfigApplyProgressStepKey.rolledBack
        ? 'กล่องย้อนกลับ กำลังเตรียมลองใหม่'
        : 'รอบนี้ไม่สำเร็จ กำลังเตรียมลองใหม่';
  }
  if (p.central?.deviceOnline == false) return 'รอกล่องออนไลน์';
  return switch (current?.key) {
    ConfigApplyProgressStepKey.downloading =>
      'กำลังดาวน์โหลด ${current?.progress ?? 0}%',
    ConfigApplyProgressStepKey.validating => 'กำลังตรวจลายเซ็น',
    ConfigApplyProgressStepKey.installing =>
      firmware ? 'กล่องกำลังติดตั้ง' : 'กล่องกำลังรับค่าใหม่',
    ConfigApplyProgressStepKey.rebooting => 'กล่องกำลังรีบูต',
    _ => 'กำลังส่งเข้ากล่อง',
  };
}

String _mmss(int seconds) =>
    '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';

String _clock(DateTime at) {
  final t = at.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(t.hour)}:${two(t.minute)}:${two(t.second)}';
}

// ---------------------------------------------------------------------------
// ส่วนประกอบหน้าจอ

class _VersionCard extends StatelessWidget {
  const _VersionCard({required this.progress});
  final ConfigApplyRequestProgress progress;

  @override
  Widget build(BuildContext context) {
    final firmware = progress.kind == FieldApplyKind.firmware;
    final from = progress.fromVersion;
    final to = progress.toVersion ?? '—';
    return AppCard(
      key: const Key('apply_progress_version'),
      child: Row(
        children: [
          Text(
            firmware ? 'Firmware' : 'Config',
            style: const TextStyle(
              fontSize: AppTypography.sm,
              color: AppColors.mutedForeground,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              from == null || from.isEmpty ? to : '$from → $to',
              key: const Key('apply_progress_version_text'),
              style: const TextStyle(
                fontSize: AppTypography.lg,
                height: AppTypography.lgHeight,
                fontWeight: FontWeight.w700,
                color: AppColors.foreground,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          ),
          if (progress.isDowngrade)
            const AppBadge(label: 'ลดเวอร์ชัน', tone: AppBadgeTone.warning),
        ],
      ),
    );
  }
}

class _StepRow extends StatelessWidget {
  const _StepRow({
    required this.step,
    required this.last,
    required this.reducedMotion,
  });
  final _Step step;
  final bool last;
  final bool reducedMotion;

  @override
  Widget build(BuildContext context) {
    final percent =
        step.key == ConfigApplyProgressStepKey.downloading &&
            step.state == _StepState.now &&
            step.progress != null
        ? ' ${step.progress}%'
        : '';
    final emphasis =
        step.state == _StepState.now || step.state == _StepState.fail;
    return IntrinsicHeight(
      child: Row(
        key: Key('apply_progress_step_${step.key.wireName}'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 24,
            child: Column(
              children: [
                const SizedBox(height: 7),
                _StepDot(state: step.state, reducedMotion: reducedMotion),
                if (!last)
                  Expanded(
                    child: Container(
                      width: 2,
                      color: step.state == _StepState.done
                          ? AppColors.primary
                          : AppColors.border,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                '${step.label}$percent',
                style: TextStyle(
                  fontSize: AppTypography.sm,
                  height: AppTypography.smHeight,
                  fontWeight: emphasis ? FontWeight.w600 : FontWeight.w400,
                  color: switch (step.state) {
                    _StepState.todo => AppColors.mutedForeground,
                    _StepState.fail => AppColors.warning,
                    _ => AppColors.foreground,
                  },
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text(
              step.at == null || step.state == _StepState.todo
                  ? ''
                  : _clock(step.at!),
              style: const TextStyle(
                fontSize: AppTypography.xs,
                color: AppColors.mutedForeground,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StepDot extends StatefulWidget {
  const _StepDot({required this.state, required this.reducedMotion});
  final _StepState state;
  final bool reducedMotion;

  @override
  State<_StepDot> createState() => _StepDotState();
}

class _StepDotState extends State<_StepDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _breath = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  );

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(covariant _StepDot oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync();
  }

  void _sync() {
    if (widget.state == _StepState.now && !widget.reducedMotion) {
      if (!_breath.isAnimating) _breath.repeat(reverse: true);
    } else {
      _breath.stop();
    }
  }

  @override
  void dispose() {
    _breath.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final fail = widget.state == _StepState.fail;
    final filled = widget.state == _StepState.done || fail;
    final color = fail ? AppColors.warning : AppColors.primary;
    return Container(
      width: 22,
      height: 22,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: filled ? color : AppColors.card,
        border: Border.all(
          color: widget.state == _StepState.todo ? AppColors.border : color,
          width: 2,
        ),
      ),
      alignment: Alignment.center,
      child: switch (widget.state) {
        _StepState.done => const Icon(
          Icons.check,
          size: 14,
          color: AppColors.primaryForeground,
        ),
        _StepState.fail => const Icon(
          Icons.priority_high,
          size: 14,
          color: AppColors.primaryForeground,
        ),
        _StepState.now => ScaleTransition(
          key: const Key('apply_progress_now_dot'),
          scale: Tween(begin: 1.0, end: .5).animate(_breath),
          child: Container(
            width: 10,
            height: 10,
            decoration: const BoxDecoration(
              color: AppColors.primary,
              shape: BoxShape.circle,
            ),
          ),
        ),
        _StepState.todo => const SizedBox.shrink(),
      },
    );
  }
}

class _ResultCard extends StatelessWidget {
  const _ResultCard({
    required this.progress,
    required this.outcome,
    required this.elapsed,
  });
  final ConfigApplyRequestProgress progress;
  final _Outcome outcome;
  final int elapsed;

  @override
  Widget build(BuildContext context) {
    final firmware = progress.kind == FieldApplyKind.firmware;
    final ok = outcome == _Outcome.succeeded;
    final attempts = progress.retry?.attempts ?? const <ConfigApplyAttempt>[];
    final message =
        progress.central?.errorMessage ??
        attempts.lastOrNull?.detail ??
        attempts.lastOrNull?.errorCode;
    final (title, body) = switch (outcome) {
      _Outcome.succeeded => (
        firmware ? 'ติดตั้งสำเร็จ' : 'กล่องรับค่าใหม่แล้ว',
        firmware
            ? 'กล่องรายงาน Firmware ${progress.toVersion ?? ''} แล้ว '
                  'ใช้เวลา ${_mmss(elapsed)}'
            : 'ใช้เวลา ${_mmss(elapsed)}',
      ),
      _Outcome.rolledBack => (
        'กล่องย้อนกลับเป็น ${progress.fromVersion ?? 'เวอร์ชันเดิม'}',
        '${message ?? 'Firmware ใหม่ใช้งานไม่ได้หลังรีบูต'} · ส่งใหม่ได้',
      ),
      _ => (
        attempts.length > 1
            ? 'ส่ง ${attempts.length} ครั้งไม่สำเร็จ'
            : 'ส่งไม่สำเร็จ',
        message ?? 'กล่องไม่ได้รับคำสั่งนี้ ลองส่งใหม่อีกครั้ง',
      ),
    };
    final color = ok ? AppColors.success : AppColors.warning;
    return Container(
      key: Key(ok ? 'apply_progress_result_ok' : 'apply_progress_result_bad'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: ok ? AppColors.successSubtle : AppColors.warningSubtle,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(fontWeight: FontWeight.w700, color: color),
          ),
          const SizedBox(height: 2),
          Text(
            body,
            style: TextStyle(fontSize: AppTypography.sm, color: color),
          ),
        ],
      ),
    );
  }
}

String _attemptStatusLabel(ConfigApplyAttemptStatus status) => switch (status) {
  ConfigApplyAttemptStatus.sending => 'กำลังส่ง',
  ConfigApplyAttemptStatus.sent => 'ส่งแล้ว รอผล',
  ConfigApplyAttemptStatus.succeeded => 'สำเร็จ',
  ConfigApplyAttemptStatus.failed => 'ไม่สำเร็จ',
  ConfigApplyAttemptStatus.skipped => 'ข้าม (กล่องไม่พร้อม)',
};

/// ประวัติการส่งรายรอบ (docs/31 §3.7) — เวลาเริ่ม + สาเหตุที่ล้ม
/// ประวัติรายรอบ — สำเร็จแล้ว = พับเป็นบรรทัดสรุป (แตะเพื่อดู) ไม่ให้หน้ายาวเกินที่
/// ช่างต้องการ · ยังไม่จบหรือไม่สำเร็จ = กางไว้ เพราะเป็นสิ่งที่ช่างต้องดู
class _AttemptHistory extends StatefulWidget {
  const _AttemptHistory({
    super.key,
    required this.attempts,
    required this.collapsed,
  });
  final List<ConfigApplyAttempt> attempts;
  final bool collapsed;

  @override
  State<_AttemptHistory> createState() => _AttemptHistoryState();
}

class _AttemptHistoryState extends State<_AttemptHistory> {
  late bool _open = !widget.collapsed;

  @override
  void didUpdateWidget(covariant _AttemptHistory old) {
    super.didUpdateWidget(old);
    // เพิ่งจบแบบสำเร็จระหว่างเปิดดู = พับลงเป็นสรุป (ช่างยังแตะกางได้)
    if (widget.collapsed && !old.collapsed) _open = false;
  }

  String get _summary {
    final attempts = widget.attempts;
    final ok = attempts
        .where((a) => a.status == ConfigApplyAttemptStatus.succeeded)
        .lastOrNull;
    return ok == null
        ? 'ส่ง ${attempts.length} รอบ'
        : 'ส่ง ${attempts.length} รอบ สำเร็จรอบที่ ${ok.attemptNo}';
  }

  @override
  Widget build(BuildContext context) {
    return AppCard(
      key: const Key('apply_progress_history'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            button: true,
            expanded: _open,
            child: InkWell(
              key: const Key('apply_progress_history_toggle'),
              onTap: () => setState(() => _open = !_open),
              borderRadius: BorderRadius.circular(AppRadius.md),
              child: Row(
                children: [
                  const Text(
                    'ประวัติการส่ง',
                    style: TextStyle(
                      fontSize: AppTypography.sm,
                      fontWeight: FontWeight.w700,
                      color: AppColors.foreground,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _summary,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: AppTypography.sm,
                        color: AppColors.mutedForeground,
                      ),
                    ),
                  ),
                  Icon(
                    _open ? Icons.expand_less : Icons.expand_more,
                    color: AppColors.mutedForeground,
                  ),
                ],
              ),
            ),
          ),
          if (_open)
            for (final a in widget.attempts) _AttemptRow(attempt: a),
        ],
      ),
    );
  }
}

class _AttemptRow extends StatelessWidget {
  const _AttemptRow({required this.attempt});
  final ConfigApplyAttempt attempt;

  @override
  Widget build(BuildContext context) {
    final bad =
        attempt.status == ConfigApplyAttemptStatus.failed ||
        attempt.status == ConfigApplyAttemptStatus.skipped;
    final reason = attempt.detail ?? attempt.errorCode;
    return Padding(
      key: Key('apply_progress_attempt_${attempt.attemptNo}'),
      padding: const EdgeInsets.only(top: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 52,
            child: Text(
              'รอบ ${attempt.attemptNo}',
              style: const TextStyle(
                fontSize: AppTypography.sm,
                fontWeight: FontWeight.w600,
                color: AppColors.foreground,
              ),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _attemptStatusLabel(attempt.status),
                  style: TextStyle(
                    fontSize: AppTypography.sm,
                    color: switch (attempt.status) {
                      ConfigApplyAttemptStatus.succeeded => AppColors.success,
                      _ when bad => AppColors.warning,
                      _ => AppColors.foreground,
                    },
                  ),
                ),
                if (bad && reason != null)
                  Text(
                    reason,
                    style: const TextStyle(
                      fontSize: AppTypography.xs,
                      color: AppColors.mutedForeground,
                    ),
                  ),
              ],
            ),
          ),
          Text(
            _clock(attempt.startedAt),
            style: const TextStyle(
              fontSize: AppTypography.xs,
              color: AppColors.mutedForeground,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// ภาพกลางจอ

class _ProgressScene extends StatelessWidget {
  const _ProgressScene({
    required this.loop,
    required this.finish,
    required this.value,
    required this.outcome,
    required this.stage,
    required this.reducedMotion,
  });
  final AnimationController loop;
  final AnimationController finish;
  final double value;
  final _Outcome outcome;
  final ConfigApplyProgressStepKey? stage;
  final bool reducedMotion;

  @override
  Widget build(BuildContext context) {
    final running = outcome == _Outcome.running;
    final busy =
        stage == ConfigApplyProgressStepKey.validating ||
        stage == ConfigApplyProgressStepKey.installing;
    final rebooting = stage == ConfigApplyProgressStepKey.rebooting;
    final bad = outcome == _Outcome.rolledBack || outcome == _Outcome.failed;
    return SizedBox(
      key: const Key('apply_progress_scene'),
      width: 184,
      height: 184,
      child: TweenAnimationBuilder<double>(
        tween: Tween(end: value),
        duration: reducedMotion
            ? Duration.zero
            : const Duration(milliseconds: 600),
        curve: Curves.easeOutCubic,
        builder: (context, ring, _) => AnimatedBuilder(
          animation: Listenable.merge([loop, finish]),
          builder: (context, _) => CustomPaint(
            foregroundPainter: _ScenePainter(
              ring: ring,
              phase: 0,
              finish: finish.value,
              outcome: outcome,
              packets: false,
              pulses: false,
              foreground: true,
            ),
            painter: _ScenePainter(
              ring: ring,
              phase: reducedMotion ? 0 : loop.value,
              finish: finish.value,
              outcome: outcome,
              packets:
                  running &&
                  !reducedMotion &&
                  (stage == null ||
                      stage == ConfigApplyProgressStepKey.delivered ||
                      stage == ConfigApplyProgressStepKey.downloading),
              pulses: running && !reducedMotion,
            ),
            child: Center(
              child: Container(
                width: 124,
                height: 124,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: outcome == _Outcome.succeeded
                      ? AppColors.successSubtle
                      : bad
                      ? AppColors.warningSubtle
                      : AppColors.card,
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x1F22261F),
                      blurRadius: 22,
                      offset: Offset(0, 8),
                    ),
                  ],
                ),
                alignment: Alignment.center,
                child: outcome == _Outcome.succeeded
                    // ติ๊กถูกวาดใน _ScenePainter
                    ? const SizedBox(
                        key: Key('apply_progress_icon_ok'),
                        width: 64,
                        height: 64,
                      )
                    : bad
                    ? const Icon(
                        Icons.history_rounded,
                        key: Key('apply_progress_icon_bad'),
                        size: 58,
                        color: AppColors.warning,
                      )
                    : Opacity(
                        // กล่องกระพริบตอนรีบูต
                        opacity: rebooting && !reducedMotion
                            ? .3 +
                                  .7 *
                                      (.5 +
                                          .5 *
                                              math.cos(
                                                loop.value * math.pi * 6,
                                              ))
                            : 1,
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            const Icon(
                              Icons.inventory_2_outlined,
                              key: Key('apply_progress_icon_box'),
                              size: 60,
                              color: AppColors.primary,
                            ),
                            if (busy)
                              Positioned(
                                right: 18,
                                bottom: 20,
                                child: Transform.rotate(
                                  key: const Key('apply_progress_gear'),
                                  angle: reducedMotion
                                      ? 0
                                      : loop.value * math.pi * 2,
                                  child: const DecoratedBox(
                                    decoration: BoxDecoration(
                                      color: AppColors.card,
                                      shape: BoxShape.circle,
                                    ),
                                    child: Icon(
                                      Icons.settings,
                                      size: 26,
                                      color: AppColors.primary,
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ScenePainter extends CustomPainter {
  const _ScenePainter({
    required this.ring,
    required this.phase,
    required this.finish,
    required this.outcome,
    required this.packets,
    required this.pulses,
    this.foreground = false,
  });
  final double ring;
  final double phase;
  final double finish;
  final _Outcome outcome;
  final bool packets;
  final bool pulses;

  /// ชั้นหน้า (`foregroundPainter`) = ติ๊กถูก + พลุ ซึ่งต้องอยู่ "เหนือ" วงกลมกลาง ·
  /// เดิมวาดทุกอย่างเป็น `painter` (ใต้ลูก) วงกลมพื้นทึบจึงบังติ๊กถูกจนมองไม่เห็น
  final bool foreground;

  static const _burstColors = [
    AppColors.primary,
    AppColors.primarySubtle,
    AppColors.success,
    AppColors.notificationBadge,
    AppColors.info,
  ];

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    const radius = 84.0;
    if (foreground) {
      if (outcome == _Outcome.succeeded) _paintSuccess(canvas, c);
      return;
    }

    // วงกระเพื่อม 2 วงสลับจังหวะ
    if (pulses) {
      for (final offset in const [0.0, .5]) {
        final t = (phase + offset) % 1;
        canvas.drawCircle(
          c,
          52 + t * 32,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2
            ..color = AppColors.primarySubtle.withValues(alpha: (1 - t) * .9),
        );
      }
    }

    canvas.drawCircle(
      c,
      radius,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 8
        ..color = AppColors.border,
    );
    canvas.drawArc(
      Rect.fromCircle(center: c, radius: radius),
      -math.pi / 2,
      math.pi * 2 * ring.clamp(0, 1),
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 8
        ..strokeCap = StrokeCap.round
        ..color = switch (outcome) {
          _Outcome.succeeded => AppColors.success,
          _Outcome.running => AppColors.primary,
          _ => AppColors.warning,
        },
    );

    // ข้อมูลไหลลงกล่องตอนส่ง/ดาวน์โหลด
    if (packets) {
      for (final offset in const [0.0, .33, .66]) {
        final t = (phase * 2.2 + offset) % 1;
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromCenter(
              center: Offset(c.dx, c.dy - radius + 6 + t * 30),
              width: 4,
              height: 8,
            ),
            const Radius.circular(2),
          ),
          Paint()
            ..color = AppColors.primary.withValues(
              alpha: math.sin(t * math.pi).clamp(0, 1).toDouble(),
            ),
        );
      }
    }
  }

  void _paintSuccess(Canvas canvas, Offset c) {
    // ติ๊กถูกวาดเส้นตาม finish
    final path = Path()
      ..moveTo(c.dx - 22, c.dy + 1)
      ..lineTo(c.dx - 6, c.dy + 17)
      ..lineTo(c.dx + 25, c.dy - 16);
    final drawn = Path();
    final checkT = Curves.easeOut.transform(((finish - .1) / .7).clamp(0, 1));
    for (final metric in path.computeMetrics()) {
      drawn.addPath(metric.extractPath(0, metric.length * checkT), Offset.zero);
    }
    canvas.drawPath(
      drawn,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 7
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..color = AppColors.success,
    );

    // พลุเล็กๆ ครั้งเดียวตอนสำเร็จ
    if (finish <= 0 || finish >= 1) return;
    final t = Curves.easeOut.transform(finish);
    for (var i = 0; i < 14; i++) {
      final angle = i / 14 * math.pi * 2;
      final dist = (70 + (i % 3) * 14.0) * t;
      canvas.save();
      canvas.translate(
        c.dx + math.cos(angle) * dist,
        c.dy + math.sin(angle) * dist,
      );
      canvas.rotate(t * 2.8);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromCenter(center: Offset.zero, width: 7, height: 7),
          const Radius.circular(2),
        ),
        Paint()
          ..color = _burstColors[i % _burstColors.length].withValues(
            alpha: 1 - t,
          ),
      );
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant _ScenePainter old) =>
      old.ring != ring ||
      old.phase != phase ||
      old.finish != finish ||
      old.outcome != outcome ||
      old.packets != packets ||
      old.pulses != pulses ||
      old.foreground != foreground;
}
