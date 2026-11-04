import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/models.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_card.dart';
import 'config_apply_request_repository.dart';
import 'task_repository.dart';

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

class _ConfigApplyProgressPageState
    extends ConsumerState<ConfigApplyProgressPage>
    with SingleTickerProviderStateMixin {
  late final AnimationController _motion;
  Timer? _elapsedTimer;
  Timer? _pollTimer;
  ConfigApplyRequestProgress? _progress;
  Object? _error;
  int _elapsed = 0;
  bool _loading = false;
  bool _invalidated = false;
  bool _reducedMotion = false;

  bool get _terminal {
    final progress = _progress;
    if (progress == null) return false;
    if (!progress.status.isInFlight) return true;
    return const {
      'SUCCESS',
      'FAILED',
      'ROLLED_BACK',
      'EXPIRED',
    }.contains(progress.central?.status?.toUpperCase());
  }

  @override
  void initState() {
    super.initState();
    _motion = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    );
    unawaited(_load());
    _elapsedTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _elapsed++);
    });
    _pollTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      if (!_terminal) unawaited(_load());
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final disabled = MediaQuery.disableAnimationsOf(context);
    if (_reducedMotion == disabled) return;
    _reducedMotion = disabled;
    if (disabled) {
      _motion.stop();
    } else if (!_terminal) {
      _motion.repeat();
    }
  }

  Future<void> _load() async {
    if (_loading || !mounted) return;
    _loading = true;
    try {
      final progress = await ref
          .read(configApplyRequestRepositoryProvider)
          .progress(widget.taskId, widget.requestId);
      if (!mounted) return;
      setState(() {
        _progress = progress;
        _error = null;
        _elapsed = _elapsedFrom(progress.releasedAt);
      });
      if (_terminal) {
        _pollTimer?.cancel();
        _motion.stop();
        if (!_invalidated) {
          _invalidated = true;
          ref.invalidate(taskConfigApplyRequestsProvider(widget.taskId));
        }
      } else if (!_reducedMotion && !_motion.isAnimating) {
        _motion.repeat();
      }
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      _loading = false;
    }
  }

  int _elapsedFrom(DateTime? releasedAt) {
    if (releasedAt == null) return _elapsed;
    final seconds = DateTime.now().difference(releasedAt).inSeconds;
    return math.max(0, seconds);
  }

  @override
  void dispose() {
    _elapsedTimer?.cancel();
    _pollTimer?.cancel();
    _motion.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final task = ref.watch(taskDetailProvider(widget.taskId)).valueOrNull;
    final progress = _progress;
    final central = progress?.central;
    final steps = _stepsFor(progress);
    final current = _currentStep(steps);
    final failed =
        progress?.status == ConfigApplyRequestStatus.failed ||
        progress?.status == ConfigApplyRequestStatus.skippedOffline ||
        current == ConfigApplyProgressStepKey.rolledBack ||
        current == ConfigApplyProgressStepKey.failed ||
        current == ConfigApplyProgressStepKey.expired;
    final succeeded =
        progress?.status == ConfigApplyRequestStatus.succeeded ||
        current == ConfigApplyProgressStepKey.succeeded;
    final percent = central?.available == true
        ? (central!.progressPercent ?? _percentFor(current))
        : _percentFor(current);
    final title = _titleFor(current, progress?.status);
    final versionFrom = progress?.fromVersion ?? '—';
    final versionTo = progress?.toVersion ?? '—';

    return Scaffold(
      appBar: AppBar(title: const Text('ความคืบหน้าการส่งเข้ากล่อง')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
          children: [
            SizedBox(
              height: 210,
              child: Center(
                child: AnimatedBuilder(
                  animation: _motion,
                  builder: (context, _) => CustomPaint(
                    size: const Size(184, 184),
                    painter: _ProgressScenePainter(
                      value: percent / 100,
                      phase: _reducedMotion ? 0 : _motion.value,
                      failed: failed,
                      succeeded: succeeded,
                      active: !_terminal,
                    ),
                    child: SizedBox(
                      width: 184,
                      height: 184,
                      child: Center(
                        child: succeeded
                            ? const Icon(Icons.check_rounded, size: 68)
                            : RotationTransition(
                                turns:
                                    _reducedMotion ||
                                        current !=
                                            ConfigApplyProgressStepKey
                                                .installing
                                    ? const AlwaysStoppedAnimation(0)
                                    : _motion,
                                child: Icon(
                                  failed
                                      ? Icons.warning_amber_rounded
                                      : current ==
                                                ConfigApplyProgressStepKey
                                                    .validating ||
                                            current ==
                                                ConfigApplyProgressStepKey
                                                    .installing
                                      ? Icons.settings_rounded
                                      : Icons.inventory_2_outlined,
                                  size: 62,
                                ),
                              ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              _formatElapsed(_elapsed),
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              ).textTheme.headlineSmall?.copyWith(fontFeatures: const []),
            ),
            if (current == ConfigApplyProgressStepKey.downloading)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text('ดาวน์โหลด $percent%', textAlign: TextAlign.center),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: TextButton.icon(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh),
                  label: const Text('โหลดความคืบหน้าอีกครั้ง'),
                ),
              ),
            const SizedBox(height: 18),
            AppCard(
              child: Row(
                children: [
                  Expanded(
                    child: _VersionColumn(label: 'ก่อนส่ง', value: versionFrom),
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 12),
                    child: Icon(Icons.arrow_forward_rounded),
                  ),
                  Expanded(
                    child: _VersionColumn(label: 'ส่งเป็น', value: versionTo),
                  ),
                  if (progress?.isDowngrade == true)
                    const Padding(
                      padding: EdgeInsets.only(left: 8),
                      child: Chip(label: Text('ลดเวอร์ชัน')),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'ขั้นตอน',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 8),
                  for (final (index, step) in steps.indexed)
                    _ProgressStepRow(
                      step: step,
                      current: step.key == current,
                      done:
                          step.key != current &&
                          index < _stepIndex(steps, current),
                    ),
                ],
              ),
            ),
            if (failed || succeeded) ...[
              const SizedBox(height: 12),
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      succeeded
                          ? 'กล่องติดตั้งสำเร็จ'
                          : 'กล่องย้อนกลับหรือส่งไม่สำเร็จ',
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    if (!succeeded && (central?.errorMessage ?? '').isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(central!.errorMessage!),
                      ),
                    if (!succeeded && (progress?.toVersion ?? '').isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text('กล่องย้อนกลับเป็น $versionFrom'),
                      ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.all(16),
        child: FilledButton(
          onPressed: () {
            if (failed && task?.deviceId != null) {
              context.go(
                AppRoutes.deviceApply(
                  task!.deviceId!,
                  taskId: widget.taskId,
                  firmware: progress?.kind == FieldApplyKind.firmware,
                ),
              );
            } else {
              context.go(AppRoutes.taskDetail(widget.taskId));
            }
          },
          child: Text(
            failed && task?.deviceId != null
                ? 'ส่งใหม่อีกครั้ง'
                : _terminal
                ? 'กลับไปหน้างาน'
                : 'ส่งต่อเบื้องหลัง กลับไปหน้างาน',
          ),
        ),
      ),
    );
  }

  List<ConfigApplyProgressStep> _stepsFor(
    ConfigApplyRequestProgress? progress,
  ) {
    final central = progress?.central;
    if (central != null && central.available && central.steps.isNotEmpty) {
      return central.steps;
    }
    final status = progress?.status;
    final succeeded = status == ConfigApplyRequestStatus.succeeded;
    final failed =
        status == ConfigApplyRequestStatus.failed ||
        status == ConfigApplyRequestStatus.skippedOffline ||
        status == ConfigApplyRequestStatus.expired;
    final keys = [
      ConfigApplyProgressStepKey.delivered,
      ConfigApplyProgressStepKey.installing,
      succeeded
          ? ConfigApplyProgressStepKey.succeeded
          : failed
          ? ConfigApplyProgressStepKey.failed
          : ConfigApplyProgressStepKey.rebooting,
    ];
    return [
      for (var i = 0; i < keys.length; i++)
        ConfigApplyProgressStep(
          key: keys[i],
          at: i == 0
              ? progress?.releasedAt
              : i == 2
              ? progress?.completedAt
              : null,
        ),
    ];
  }

  ConfigApplyProgressStepKey _currentStep(List<ConfigApplyProgressStep> steps) {
    if (_progress?.status == ConfigApplyRequestStatus.succeeded) {
      return ConfigApplyProgressStepKey.succeeded;
    }
    if (_progress?.status == ConfigApplyRequestStatus.failed ||
        _progress?.status == ConfigApplyRequestStatus.skippedOffline) {
      return ConfigApplyProgressStepKey.failed;
    }
    final central = _progress?.central;
    if (central?.available == true && central!.steps.isNotEmpty) {
      return central.steps.last.key;
    }
    return steps.length > 1 ? steps[1].key : steps.first.key;
  }

  int _stepIndex(
    List<ConfigApplyProgressStep> steps,
    ConfigApplyProgressStepKey key,
  ) => steps
      .indexWhere((step) => step.key == key)
      .clamp(0, steps.length - 1)
      .toInt();

  int _percentFor(ConfigApplyProgressStepKey key) => switch (key) {
    ConfigApplyProgressStepKey.delivered => 12,
    ConfigApplyProgressStepKey.downloading => 35,
    ConfigApplyProgressStepKey.validating => 55,
    ConfigApplyProgressStepKey.installing => 75,
    ConfigApplyProgressStepKey.rebooting => 90,
    ConfigApplyProgressStepKey.succeeded => 100,
    _ => 0,
  };

  String _titleFor(
    ConfigApplyProgressStepKey key,
    ConfigApplyRequestStatus? status,
  ) {
    if (status == null) return 'กำลังโหลดความคืบหน้า';
    return switch (key) {
      ConfigApplyProgressStepKey.delivered => 'ส่งถึงกล่องแล้ว',
      ConfigApplyProgressStepKey.downloading => 'กล่องกำลังดาวน์โหลด',
      ConfigApplyProgressStepKey.validating => 'กำลังตรวจสอบข้อมูล',
      ConfigApplyProgressStepKey.installing => 'กล่องกำลังติดตั้ง',
      ConfigApplyProgressStepKey.rebooting => 'กล่องกำลังรีบูต',
      ConfigApplyProgressStepKey.succeeded => 'ติดตั้งสำเร็จ',
      ConfigApplyProgressStepKey.rolledBack => 'กล่องย้อนกลับเป็นเวอร์ชันเดิม',
      ConfigApplyProgressStepKey.failed => 'ส่งไม่สำเร็จ',
      ConfigApplyProgressStepKey.expired => 'คำขอหมดอายุ',
    };
  }

  String _formatElapsed(int value) =>
      '${value ~/ 60}:${(value % 60).toString().padLeft(2, '0')}';
}

class _VersionColumn extends StatelessWidget {
  const _VersionColumn({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: Theme.of(context).textTheme.labelSmall),
      Text(value, style: Theme.of(context).textTheme.titleMedium),
    ],
  );
}

class _ProgressStepRow extends StatelessWidget {
  const _ProgressStepRow({
    required this.step,
    required this.current,
    required this.done,
  });
  final ConfigApplyProgressStep step;
  final bool current;
  final bool done;
  @override
  Widget build(BuildContext context) {
    final label = switch (step.key) {
      ConfigApplyProgressStepKey.delivered => 'ส่งถึงกล่อง',
      ConfigApplyProgressStepKey.downloading => 'ดาวน์โหลด',
      ConfigApplyProgressStepKey.validating => 'ตรวจสอบลายเซ็น',
      ConfigApplyProgressStepKey.installing => 'ติดตั้ง',
      ConfigApplyProgressStepKey.rebooting => 'รีบูต',
      ConfigApplyProgressStepKey.succeeded => 'ยืนยันผลสำเร็จ',
      ConfigApplyProgressStepKey.rolledBack => 'ย้อนกลับ',
      ConfigApplyProgressStepKey.failed => 'ล้มเหลว',
      ConfigApplyProgressStepKey.expired => 'หมดอายุ',
    };
    final time = step.at == null ? '' : _clock(step.at!);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(
            done
                ? Icons.check_circle
                : current
                ? Icons.radio_button_checked
                : Icons.radio_button_unchecked,
            size: 20,
            color: done || current
                ? AppColors.primary
                : AppColors.mutedForeground,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '$label${step.key == ConfigApplyProgressStepKey.downloading && step.progress != null ? ' ${step.progress}%' : ''}',
            ),
          ),
          Text(time, style: Theme.of(context).textTheme.labelSmall),
        ],
      ),
    );
  }

  String _clock(DateTime at) =>
      '${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}:${at.second.toString().padLeft(2, '0')}';
}

class _ProgressScenePainter extends CustomPainter {
  const _ProgressScenePainter({
    required this.value,
    required this.phase,
    required this.failed,
    required this.succeeded,
    required this.active,
  });
  final double value;
  final double phase;
  final bool failed;
  final bool succeeded;
  final bool active;
  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    const radius = 78.0;
    final track = Paint()
      ..color = AppColors.border
      ..style = PaintingStyle.stroke
      ..strokeWidth = 8;
    final progressColor = failed
        ? AppColors.warning
        : succeeded
        ? AppColors.success
        : AppColors.primary;
    canvas.drawCircle(center, radius, track);
    final arc = Paint()
      ..color = progressColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 8
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2,
      math.pi * 2 * value.clamp(0, 1),
      false,
      arc,
    );
    if (active && !failed && !succeeded) {
      final pulseRadius = 49 + phase * 17;
      final pulse = Paint()
        ..color = AppColors.primary.withValues(alpha: (1 - phase) * .22)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2;
      canvas.drawCircle(center, pulseRadius, pulse);
    }
    if (succeeded) {
      final check = Paint()
        ..color = progressColor
        ..style = PaintingStyle.stroke
        ..strokeWidth = 6
        ..strokeCap = StrokeCap.round;
      final path = Path()
        ..moveTo(center.dx - 21, center.dy)
        ..lineTo(center.dx - 5, center.dy + 16)
        ..lineTo(center.dx + 27, center.dy - 20);
      canvas.drawPath(path, check);
      final confetti = Paint()..color = AppColors.primary;
      for (var i = 0; i < 8; i++) {
        final angle = i * math.pi / 4;
        canvas.drawCircle(
          center + Offset(math.cos(angle), math.sin(angle)) * 66,
          3,
          confetti,
        );
      }
    } else if (!failed && active && phase < .7) {
      final packet = Paint()..color = AppColors.primary;
      final y = center.dy - 62 + phase / .7 * 25;
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(center.dx - 2, y, 5, 8),
          const Radius.circular(2),
        ),
        packet,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _ProgressScenePainter old) =>
      old.value != value ||
      old.phase != phase ||
      old.failed != failed ||
      old.succeeded != succeeded ||
      old.active != active;
}
