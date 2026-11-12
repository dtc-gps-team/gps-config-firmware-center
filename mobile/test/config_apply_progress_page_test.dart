import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/task/config_apply_progress_page.dart';
import 'package:mobile/features/task/config_apply_request_repository.dart';
import 'package:mobile/features/task/task_repository.dart';

import 'support/fake_config_apply_request_repository.dart';

final _released = DateTime.now().toUtc().subtract(const Duration(seconds: 20));

ConfigApplyProgressStep _s(
  ConfigApplyProgressStepKey key, {
  int seconds = 0,
  int? progress,
}) => ConfigApplyProgressStep(
  key: key,
  at: _released.add(Duration(seconds: seconds)),
  progress: progress,
);

ConfigApplyRequestProgress _progress({
  FieldApplyKind kind = FieldApplyKind.firmware,
  ConfigApplyRequestStatus status = ConfigApplyRequestStatus.sending,
  List<ConfigApplyProgressStep>? steps,
  bool central = true,
  bool available = true,
  String? errorMessage,
  DateTime? completedAt,
  bool isDowngrade = true,
  ConfigApplyRetry? retry,
}) => ConfigApplyRequestProgress(
  requestId: 'car-1',
  kind: kind,
  status: status,
  // backend คืน fromVersion เฉพาะ Firmware · Config เป็น null (รีวิว A #437)
  fromVersion: kind == FieldApplyKind.firmware ? '1.1.0' : null,
  toVersion: kind == FieldApplyKind.firmware ? '1.0.0' : 'Config ใหม่',
  isDowngrade: isDowngrade,
  releasedAt: _released,
  completedAt: completedAt,
  central: central
      ? CentralApplyProgress(
          available: available,
          commandId: 'CMD-1',
          steps: steps ?? const [],
          errorMessage: errorMessage,
          deviceOnline: true,
        )
      : null,
  retry: retry,
);

ConfigApplyAttempt _attempt(
  int no,
  ConfigApplyAttemptStatus status, {
  String? errorCode,
  String? detail,
  int startSeconds = 0,
  int? endSeconds,
}) => ConfigApplyAttempt(
  attemptNo: no,
  status: status,
  errorCode: errorCode,
  detail: detail,
  startedAt: _released.add(Duration(seconds: startSeconds)),
  finishedAt: endSeconds == null
      ? null
      : _released.add(Duration(seconds: endSeconds)),
);

Future<FakeConfigApplyRequestRepository> _pump(
  WidgetTester tester,
  ConfigApplyRequestProgress Function() next, {
  bool disableAnimations = false,
}) async {
  // สูงพอให้ ListView สร้างการ์ดผลลัพธ์ท้ายหน้าด้วย
  tester.view.physicalSize = const Size(1080, 4200);
  tester.view.devicePixelRatio = 2.625;
  addTearDown(tester.view.reset);
  final repo = FakeConfigApplyRequestRepository(
    requests: [
      fakeApplyRequest(
        kind: FieldApplyKind.firmware,
        status: ConfigApplyRequestStatus.sending,
        releasedAt: _released,
      ),
    ],
    progressOverride: (_) => next(),
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        configApplyRequestRepositoryProvider.overrideWithValue(repo),
        taskDetailProvider.overrideWith(
          (ref, id) async => Task(
            id: id,
            title: 'BOX-0001 — 4 พ.ย. 2569',
            assignedTo: 'u1',
            status: TaskStatus.inProgress,
            createdAt: DateTime(2026, 11, 4, 9, 56),
            updatedAt: DateTime(2026, 11, 4, 10, 53),
            deviceId: 'BOX-0001',
          ),
        ),
      ],
      // MaterialApp สร้าง MediaQuery ของตัวเอง จึงตั้งค่าลดอนิเมชั่นใน builder
      child: MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(disableAnimations: disableAnimations),
          child: child!,
        ),
        home: const ConfigApplyProgressPage(taskId: 't1', requestId: 'car-1'),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
  return repo;
}

Future<void> _unmount(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
}

Finder _step(ConfigApplyProgressStepKey key) =>
    find.byKey(Key('apply_progress_step_${key.wireName}'));

void main() {
  testWidgets(
    'ดาวน์โหลดอยู่ -> หัวข้อบอก % ขั้นก่อนหน้าผ่านแล้ว ขั้นหลังยังไม่ถึง',
    (tester) async {
      await _pump(
        tester,
        () => _progress(
          steps: [
            _s(ConfigApplyProgressStepKey.delivered),
            _s(
              ConfigApplyProgressStepKey.downloading,
              seconds: 2,
              progress: 40,
            ),
          ],
        ),
      );

      expect(find.text('กำลังดาวน์โหลด 40%'), findsOneWidget);
      expect(
        find.descendant(
          of: _step(ConfigApplyProgressStepKey.downloading),
          matching: find.text('ดาวน์โหลด 40%'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: _step(ConfigApplyProgressStepKey.downloading),
          matching: find.byKey(const Key('apply_progress_now_dot')),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: _step(ConfigApplyProgressStepKey.delivered),
          matching: find.byIcon(Icons.check),
        ),
        findsOneWidget,
      );
      // ยังไม่ถึง = ไม่มีเวลา
      expect(_step(ConfigApplyProgressStepKey.rebooting), findsOneWidget);
      expect(find.textContaining('ผ่านไป 0:2'), findsOneWidget);
      expect(find.text('1.1.0 → 1.0.0'), findsOneWidget);
      expect(find.text('ลดเวอร์ชัน'), findsOneWidget);
      expect(find.text('ส่งต่อเบื้องหลัง กลับไปหน้างาน'), findsOneWidget);
      await _unmount(tester);
    },
  );

  testWidgets('สำเร็จ -> ติ๊กถูกวาดชั้นหน้า ไม่ถูกวงกลมกลางบัง', (
    tester,
  ) async {
    await _pump(
      tester,
      () => _progress(
        status: ConfigApplyRequestStatus.succeeded,
        central: false,
        completedAt: _released.add(const Duration(seconds: 30)),
      ),
    );
    await tester.pump(const Duration(seconds: 1));
    final paints = tester.widgetList<CustomPaint>(
      find.descendant(
        of: find.byKey(const Key('apply_progress_scene')),
        matching: find.byType(CustomPaint),
      ),
    );
    expect(paints.where((p) => p.foregroundPainter != null), isNotEmpty);
    await _unmount(tester);
  });

  testWidgets('เวลาของแต่ละขั้นเป็นเวลาเครื่อง ไม่ใช่ UTC', (tester) async {
    final at = DateTime.utc(2026, 11, 4, 3, 53, 25);
    await _pump(
      tester,
      () => _progress(
        steps: [
          ConfigApplyProgressStep(
            key: ConfigApplyProgressStepKey.delivered,
            at: at,
          ),
        ],
      ),
    );
    final local = at.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    expect(
      find.text('${two(local.hour)}:${two(local.minute)}:${two(local.second)}'),
      findsOneWidget,
    );
    await _unmount(tester);
  });

  testWidgets('ถามซ้ำทุก 2 วินาที แล้วหยุดถามและหยุดนับเมื่อสำเร็จ', (
    tester,
  ) async {
    var done = false;
    final repo = await _pump(
      tester,
      () => done
          ? _progress(
              status: ConfigApplyRequestStatus.succeeded,
              completedAt: _released.add(const Duration(seconds: 39)),
              steps: [
                _s(ConfigApplyProgressStepKey.delivered),
                _s(ConfigApplyProgressStepKey.downloading, progress: 100),
                _s(ConfigApplyProgressStepKey.validating, seconds: 9),
                _s(ConfigApplyProgressStepKey.installing, seconds: 10),
                _s(ConfigApplyProgressStepKey.rebooting, seconds: 11),
                _s(ConfigApplyProgressStepKey.succeeded, seconds: 39),
              ],
            )
          : _progress(
              steps: [
                _s(ConfigApplyProgressStepKey.delivered),
                _s(ConfigApplyProgressStepKey.installing, seconds: 10),
              ],
            ),
    );
    expect(repo.progressCalls, 1);
    expect(find.text('กล่องกำลังติดตั้ง'), findsWidgets);
    expect(find.byKey(const Key('apply_progress_gear')), findsOneWidget);

    await tester.pump(progressPollInterval);
    expect(repo.progressCalls, 2);

    done = true;
    await tester.pump(progressPollInterval);
    await tester.pump(const Duration(seconds: 1));
    expect(repo.progressCalls, 3);
    expect(find.text('ติดตั้งสำเร็จ'), findsWidgets);
    expect(find.text('ใช้เวลา 0:39'), findsOneWidget);
    expect(find.byKey(const Key('apply_progress_result_ok')), findsOneWidget);
    expect(find.text('กลับไปหน้างาน'), findsOneWidget);

    // จบแล้ว ไม่ถามซ้ำ และเวลาไม่เดินต่อ
    await tester.pump(const Duration(seconds: 10));
    expect(repo.progressCalls, 3);
    expect(find.text('ใช้เวลา 0:39'), findsOneWidget);
    await _unmount(tester);
  });

  testWidgets(
    'กล่องย้อนกลับ -> ขั้นรีบูตผ่านแล้ว ผลเป็นสีเหลือง บอกเวอร์ชันที่กลับไป',
    (tester) async {
      await _pump(
        tester,
        () => _progress(
          status: ConfigApplyRequestStatus.failed,
          completedAt: _released.add(const Duration(seconds: 18)),
          errorMessage: 'firmware ใหม่ต่อ Server ไม่ได้หลังรีบูต',
          steps: [
            _s(ConfigApplyProgressStepKey.delivered),
            _s(ConfigApplyProgressStepKey.downloading, progress: 100),
            _s(ConfigApplyProgressStepKey.validating, seconds: 8),
            _s(ConfigApplyProgressStepKey.installing, seconds: 8),
            _s(ConfigApplyProgressStepKey.rebooting, seconds: 8),
            _s(ConfigApplyProgressStepKey.rolledBack, seconds: 18),
          ],
        ),
      );

      expect(find.text('กล่องย้อนกลับเวอร์ชันเดิม'), findsOneWidget);
      expect(find.text('กล่องย้อนกลับเป็น 1.1.0'), findsOneWidget);
      expect(
        find.textContaining('firmware ใหม่ต่อ Server ไม่ได้หลังรีบูต'),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('apply_progress_result_bad')),
        findsOneWidget,
      );
      expect(find.byKey(const Key('apply_progress_icon_bad')), findsOneWidget);
      expect(
        find.descendant(
          of: _step(ConfigApplyProgressStepKey.rebooting),
          matching: find.byIcon(Icons.check),
        ),
        findsOneWidget,
      );
      expect(find.text('ส่งใหม่อีกครั้ง'), findsOneWidget);
      await _unmount(tester);
    },
  );

  testWidgets(
    'Config ส่งไม่สำเร็จ (ไม่ใช่ย้อนกลับ) -> ไม่บอกว่ากล่องย้อนกลับ',
    (tester) async {
      await _pump(
        tester,
        () => _progress(
          kind: FieldApplyKind.config,
          isDowngrade: false,
          central: false,
          status: ConfigApplyRequestStatus.failed,
          completedAt: _released.add(const Duration(seconds: 5)),
        ),
      );

      expect(find.text('ส่งไม่สำเร็จ'), findsWidgets);
      expect(find.textContaining('ย้อนกลับ'), findsNothing);
      expect(find.text('Config ใหม่'), findsOneWidget);
      await _unmount(tester);
    },
  );

  testWidgets('ไม่มีขั้นตอนจากกล่อง -> 3 ขั้นตามสถานะคำขอ', (tester) async {
    await _pump(tester, () => _progress(central: false));

    expect(_step(ConfigApplyProgressStepKey.delivered), findsOneWidget);
    expect(_step(ConfigApplyProgressStepKey.installing), findsOneWidget);
    expect(_step(ConfigApplyProgressStepKey.succeeded), findsOneWidget);
    expect(_step(ConfigApplyProgressStepKey.downloading), findsNothing);
    expect(
      find.descendant(
        of: _step(ConfigApplyProgressStepKey.installing),
        matching: find.byKey(const Key('apply_progress_now_dot')),
      ),
      findsOneWidget,
    );
    await _unmount(tester);
  });

  testWidgets('Server กลางล่ม (available: false) -> ใช้ 3 ขั้นเหมือนกัน', (
    tester,
  ) async {
    await _pump(tester, () => _progress(available: false));
    expect(_step(ConfigApplyProgressStepKey.downloading), findsNothing);
    expect(_step(ConfigApplyProgressStepKey.installing), findsOneWidget);
    await _unmount(tester);
  });

  testWidgets('ลดอนิเมชั่น -> ไม่มีอนิเมชั่นวน แต่ข้อมูลครบ', (tester) async {
    await _pump(
      tester,
      disableAnimations: true,
      () => _progress(
        steps: [
          _s(ConfigApplyProgressStepKey.delivered),
          _s(ConfigApplyProgressStepKey.installing, seconds: 5),
        ],
      ),
    );
    // อนิเมชั่นครั้งเดียวตอนเปิดหน้าจบในเสี้ยววินาที หลังจากนั้นต้องไม่มีอะไรวนอยู่
    await tester.pump(const Duration(milliseconds: 700));
    expect(tester.hasRunningAnimations, isFalse);

    // เฟืองไม่หมุน และจุดขั้นปัจจุบันไม่กระพริบ แม้ผ่านไปหลายรอบการถาม
    Matrix4 gear() => tester
        .widget<Transform>(find.byKey(const Key('apply_progress_gear')))
        .transform;
    double dot() => tester
        .widget<ScaleTransition>(
          find.byKey(const Key('apply_progress_now_dot')),
        )
        .scale
        .value;
    final gearBefore = gear();
    await tester.pump(const Duration(milliseconds: 1300));
    await tester.pump(const Duration(milliseconds: 900));
    expect(gear(), gearBefore);
    expect(dot(), 1.0);
    // ข้อมูลยังครบ: หัวข้อ ตัวนับ และขั้นปัจจุบัน
    expect(find.text('กล่องกำลังติดตั้ง'), findsWidgets);
    expect(find.byKey(const Key('apply_progress_elapsed')), findsOneWidget);
    await _unmount(tester);
  });

  group('ลองส่งใหม่อัตโนมัติ (docs/31 §3.7)', () {
    testWidgets('รอรอบใหม่ -> นับถอยหลัง + ป้ายรอบถัดไป + ประวัติรอบที่ล้ม', (
      tester,
    ) async {
      final nextAt = DateTime.now().toUtc().add(const Duration(seconds: 45));
      await _pump(
        tester,
        () => _progress(
          kind: FieldApplyKind.config,
          central: false,
          retry: ConfigApplyRetry(
            attemptNo: 1,
            maxAttempts: 3,
            nextRetryAt: nextAt,
            attempts: [
              _attempt(
                1,
                ConfigApplyAttemptStatus.failed,
                errorCode: 'DEVICE_OFFLINE',
                detail: 'กล่องออฟไลน์',
                endSeconds: 10,
              ),
            ],
          ),
        ),
      );

      final headline = tester
          .widget<Text>(find.byKey(const Key('apply_progress_headline')))
          .data!;
      expect(headline, startsWith('จะลองใหม่ในอีก 0:4'));
      expect(find.text('รอบ 2/3'), findsOneWidget);
      // ยังไม่ส่งถึงกล่องในรอบนี้ -> ไม่ขึ้นว่าส่งถึงแล้ว
      expect(
        find.descendant(
          of: _step(ConfigApplyProgressStepKey.delivered),
          matching: find.byIcon(Icons.check),
        ),
        findsNothing,
      );
      final history = find.byKey(const Key('apply_progress_history'));
      expect(history, findsOneWidget);
      expect(
        find.descendant(of: history, matching: find.text('ประวัติการส่ง')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const Key('apply_progress_attempt_1')),
          matching: find.textContaining('กล่องออฟไลน์'),
        ),
        findsOneWidget,
      );
      await _unmount(tester);
    });

    testWidgets('ถึงเวลาแล้วแต่ยังไม่เริ่ม -> กำลังเริ่มรอบใหม่', (
      tester,
    ) async {
      await _pump(
        tester,
        () => _progress(
          kind: FieldApplyKind.config,
          central: false,
          retry: ConfigApplyRetry(
            attemptNo: 1,
            maxAttempts: 3,
            nextRetryAt: DateTime.now().toUtc().subtract(
              const Duration(seconds: 1),
            ),
            attempts: [
              _attempt(1, ConfigApplyAttemptStatus.failed, endSeconds: 5),
            ],
          ),
        ),
      );
      expect(find.text('กำลังเริ่มรอบใหม่'), findsOneWidget);
      await _unmount(tester);
    });

    testWidgets('รอบที่ 2 กำลังส่ง -> ป้าย รอบ 2/3 + ขั้นตอนตามจริง', (
      tester,
    ) async {
      await _pump(
        tester,
        () => _progress(
          steps: [
            _s(ConfigApplyProgressStepKey.delivered, seconds: 40),
            _s(
              ConfigApplyProgressStepKey.downloading,
              seconds: 42,
              progress: 10,
            ),
          ],
          retry: ConfigApplyRetry(
            attemptNo: 2,
            maxAttempts: 3,
            attempts: [
              _attempt(
                1,
                ConfigApplyAttemptStatus.failed,
                detail: 'ติดต่อ Server กลางไม่ได้',
                endSeconds: 5,
              ),
              _attempt(2, ConfigApplyAttemptStatus.sent, startSeconds: 38),
            ],
          ),
        ),
      );
      expect(find.text('กำลังดาวน์โหลด 10%'), findsOneWidget);
      expect(find.text('รอบ 2/3'), findsOneWidget);
      expect(find.byKey(const Key('apply_progress_attempt_1')), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const Key('apply_progress_attempt_2')),
          matching: find.text('ส่งแล้ว รอผล'),
        ),
        findsOneWidget,
      );
      await _unmount(tester);
    });

    testWidgets('สำเร็จตั้งแต่รอบแรก -> ไม่มีป้ายรอบและไม่มีประวัติ', (
      tester,
    ) async {
      await _pump(
        tester,
        () => _progress(
          kind: FieldApplyKind.config,
          status: ConfigApplyRequestStatus.succeeded,
          completedAt: _released.add(const Duration(seconds: 12)),
          steps: [
            _s(ConfigApplyProgressStepKey.delivered),
            _s(ConfigApplyProgressStepKey.installing, seconds: 5),
            _s(ConfigApplyProgressStepKey.succeeded, seconds: 12),
          ],
          retry: ConfigApplyRetry(
            attemptNo: 1,
            maxAttempts: 3,
            attempts: [
              _attempt(1, ConfigApplyAttemptStatus.succeeded, endSeconds: 12),
            ],
          ),
        ),
      );
      expect(
        find.byKey(const Key('apply_progress_attempt_badge')),
        findsNothing,
      );
      expect(find.byKey(const Key('apply_progress_history')), findsNothing);
      await _unmount(tester);
    });

    testWidgets('ล้มครบทุกรอบ -> การ์ดบอกจำนวนครั้ง + ประวัติครบ', (
      tester,
    ) async {
      await _pump(
        tester,
        () => _progress(
          kind: FieldApplyKind.config,
          status: ConfigApplyRequestStatus.failed,
          central: false,
          completedAt: _released.add(const Duration(seconds: 120)),
          retry: ConfigApplyRetry(
            attemptNo: 3,
            maxAttempts: 3,
            attempts: [
              for (final n in [1, 2, 3])
                _attempt(
                  n,
                  ConfigApplyAttemptStatus.failed,
                  detail: 'กล่องออฟไลน์',
                  startSeconds: (n - 1) * 40,
                  endSeconds: (n - 1) * 40 + 5,
                ),
            ],
          ),
        ),
      );
      final result = find.byKey(const Key('apply_progress_result_bad'));
      expect(result, findsOneWidget);
      expect(
        find.descendant(
          of: result,
          matching: find.text('ส่ง 3 ครั้งไม่สำเร็จ'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(of: result, matching: find.text('กล่องออฟไลน์')),
        findsOneWidget,
      );
      for (final n in [1, 2, 3]) {
        expect(find.byKey(Key('apply_progress_attempt_$n')), findsOneWidget);
      }
      // ปุ่มให้ส่งใหม่เองยังอยู่
      expect(find.text('ส่งใหม่อีกครั้ง'), findsOneWidget);
      await _unmount(tester);
    });

    testWidgets('รอบใหม่เริ่มแล้ว -> เลิกนับถอยหลัง กลับไปแสดงการส่ง', (
      tester,
    ) async {
      var attemptNo = 1;
      ConfigApplyRequestProgress next() => _progress(
        kind: FieldApplyKind.config,
        central: false,
        retry: ConfigApplyRetry(
          attemptNo: attemptNo,
          maxAttempts: 3,
          attempts: [
            _attempt(1, ConfigApplyAttemptStatus.failed, endSeconds: 5),
            if (attemptNo == 2)
              _attempt(2, ConfigApplyAttemptStatus.sending, startSeconds: 40),
          ],
          nextRetryAt: attemptNo == 1
              ? DateTime.now().toUtc().add(const Duration(seconds: 30))
              : null,
        ),
      );
      await _pump(tester, next);
      expect(find.textContaining('จะลองใหม่ในอีก'), findsOneWidget);
      attemptNo = 2;
      await tester.pump(progressPollInterval);
      await tester.pump();
      expect(find.textContaining('จะลองใหม่ในอีก'), findsNothing);
      expect(find.text('กำลังส่งเข้ากล่อง'), findsOneWidget);
      expect(find.text('รอบ 2/3'), findsOneWidget);
      await _unmount(tester);
    });
  });

  testWidgets('ออกจากหน้าแล้ว หยุดถามความคืบหน้า', (tester) async {
    final repo = await _pump(
      tester,
      () => _progress(steps: [_s(ConfigApplyProgressStepKey.delivered)]),
    );
    await _unmount(tester);
    final calls = repo.progressCalls;
    await tester.pump(const Duration(seconds: 10));
    expect(repo.progressCalls, calls);
  });

  testWidgets('โหลดไม่ได้ตั้งแต่แรก -> ปุ่มโหลดอีกครั้ง', (tester) async {
    final failing = FakeConfigApplyRequestRepository(
      requests: [fakeApplyRequest(status: ConfigApplyRequestStatus.sending)],
      progressError: Exception('offline'),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          configApplyRequestRepositoryProvider.overrideWithValue(failing),
          taskDetailProvider.overrideWith(
            (ref, id) async => Task(
              id: id,
              title: 't',
              assignedTo: 'u1',
              status: TaskStatus.inProgress,
              createdAt: DateTime(2026, 11, 4),
              updatedAt: DateTime(2026, 11, 4),
            ),
          ),
        ],
        child: const MaterialApp(
          home: ConfigApplyProgressPage(taskId: 't1', requestId: 'car-1'),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('apply_progress_retry_load')), findsOneWidget);
    await _unmount(tester);
  });

  // กล่องรายงานว่าย้อนกลับก่อน backend เห็นผลและตั้งรอบใหม่ราว 1–4 วินาที ช่วงนั้น
  // ขั้นตอนจากกล่องจบที่ "ย้อนกลับ" แต่คำขอยัง sending — เดิมหน้านี้ถือว่าจบแล้ว
  // เลิกถาม และขึ้นปุ่มส่งใหม่ ทั้งที่ระบบยังลองรอบ 2/3 เอง (ทดสอบ BOX-0001 12 พ.ย.)
  group('ช่วงระหว่างรอบ: กล่องย้อนกลับแต่คำขอยังไม่จบ', () {
    List<ConfigApplyProgressStep> rolledBackSteps() => [
      _s(ConfigApplyProgressStepKey.delivered),
      _s(ConfigApplyProgressStepKey.downloading, progress: 100),
      _s(ConfigApplyProgressStepKey.validating, seconds: 9),
      _s(ConfigApplyProgressStepKey.installing, seconds: 9),
      _s(ConfigApplyProgressStepKey.rebooting, seconds: 9),
      _s(ConfigApplyProgressStepKey.rolledBack, seconds: 18),
    ];

    testWidgets(
      'ยังมีรอบเหลือ -> ไม่จบ ไม่มีปุ่มส่งใหม่ ถามต่อ แล้วเดินไปรอบ 2 จนสำเร็จ',
      (tester) async {
        var phase = 0;
        ConfigApplyRequestProgress next() => switch (phase) {
          // กล่องเพิ่งย้อนกลับ backend ยังไม่ปิดรอบที่ 1
          0 => _progress(
            steps: rolledBackSteps(),
            retry: ConfigApplyRetry(
              attemptNo: 1,
              maxAttempts: 3,
              attempts: [_attempt(1, ConfigApplyAttemptStatus.sending)],
            ),
          ),
          // backend ปิดรอบ 1 แล้ว ตั้งเวลารอบใหม่ (ไม่มีคำสั่งกลางระหว่างรอ)
          1 => _progress(
            central: false,
            retry: ConfigApplyRetry(
              attemptNo: 1,
              maxAttempts: 3,
              nextRetryAt: DateTime.now().toUtc().add(
                const Duration(seconds: 20),
              ),
              attempts: [
                _attempt(
                  1,
                  ConfigApplyAttemptStatus.failed,
                  errorCode: 'NEW_FIRMWARE_FAILED_HEALTH_CHECK',
                  endSeconds: 20,
                ),
              ],
            ),
          ),
          _ => _progress(
            status: ConfigApplyRequestStatus.succeeded,
            completedAt: _released.add(const Duration(seconds: 96)),
            steps: [
              _s(ConfigApplyProgressStepKey.delivered, seconds: 80),
              _s(ConfigApplyProgressStepKey.succeeded, seconds: 96),
            ],
            retry: ConfigApplyRetry(
              attemptNo: 2,
              maxAttempts: 3,
              attempts: [
                _attempt(1, ConfigApplyAttemptStatus.failed, endSeconds: 20),
                _attempt(
                  2,
                  ConfigApplyAttemptStatus.succeeded,
                  startSeconds: 40,
                  endSeconds: 96,
                ),
              ],
            ),
          ),
        };
        final repo = await _pump(tester, next);

        expect(find.text('กล่องย้อนกลับ กำลังเตรียมลองใหม่'), findsOneWidget);
        expect(find.text('ส่งใหม่อีกครั้ง'), findsNothing);
        expect(
          find.byKey(const Key('apply_progress_result_bad')),
          findsNothing,
        );
        expect(find.text('ส่งต่อเบื้องหลัง กลับไปหน้างาน'), findsOneWidget);

        // ยังถามต่อ
        phase = 1;
        await tester.pump(progressPollInterval);
        await tester.pump();
        expect(repo.progressCalls, 2);
        expect(
          tester
              .widget<Text>(find.byKey(const Key('apply_progress_headline')))
              .data,
          startsWith('จะลองใหม่ในอีก'),
        );
        expect(find.text('รอบ 2/3'), findsOneWidget);

        phase = 2;
        await tester.pump(progressPollInterval);
        await tester.pump(const Duration(seconds: 1));
        expect(find.text('ติดตั้งสำเร็จ'), findsWidgets);
        expect(find.text('ส่งใหม่อีกครั้ง'), findsNothing);
        await _unmount(tester);
      },
    );

    testWidgets(
      'รอบสุดท้ายย้อนกลับ -> กำลังสรุปผล จนคำขอจบจริงจึงขึ้นผลและปุ่มส่งใหม่',
      (tester) async {
        var closed = false;
        final retry = ConfigApplyRetry(
          attemptNo: 3,
          maxAttempts: 3,
          attempts: [
            _attempt(1, ConfigApplyAttemptStatus.failed, endSeconds: 20),
            _attempt(2, ConfigApplyAttemptStatus.failed, endSeconds: 60),
            _attempt(3, ConfigApplyAttemptStatus.sending, startSeconds: 80),
          ],
        );
        await _pump(
          tester,
          () => _progress(
            status: closed
                ? ConfigApplyRequestStatus.failed
                : ConfigApplyRequestStatus.sending,
            completedAt: closed
                ? _released.add(const Duration(seconds: 100))
                : null,
            steps: rolledBackSteps(),
            retry: retry,
          ),
        );
        expect(find.text('กำลังสรุปผล'), findsOneWidget);
        expect(find.text('ส่งใหม่อีกครั้ง'), findsNothing);

        closed = true;
        await tester.pump(progressPollInterval);
        await tester.pump(const Duration(seconds: 1));
        expect(find.text('กล่องย้อนกลับเวอร์ชันเดิม'), findsOneWidget);
        expect(find.text('ส่งใหม่อีกครั้ง'), findsOneWidget);
        await _unmount(tester);
      },
    );
  });

  // ล้มจริงแล้ว ปุ่มส่งใหม่ยื่นคำขอใหม่ด้วยของชิ้นเดิมทันที แล้วติดตามต่อในหน้านี้
  // ไม่พาไปหน้าเลือกใหม่ · ยกเว้นที่ส่งของเดิมซ้ำไม่ได้ (Override ใช้ได้ครั้งเดียว,
  // Operation ไม่อนุมัติ ฯลฯ) ยังไปหน้าเลือกเหมือนเดิม
  group('ปุ่มส่งใหม่อีกครั้ง', () {
    ConfigApplyRequestProgress fromRequest(ConfigApplyRequest r) =>
        ConfigApplyRequestProgress(
          requestId: r.id,
          kind: r.kind,
          status: r.status,
          fromVersion: r.fromFirmwareVersion,
          toVersion: r.firmwareVersion,
          isDowngrade: r.isDowngrade,
          releasedAt: r.releasedAt,
          completedAt: r.completedAt,
        );

    Future<FakeConfigApplyRequestRepository> pumpFailed(
      WidgetTester tester,
      ConfigApplyRequest source, {
      List<ConfigApplyRequest> newer = const [],
    }) async {
      tester.view.physicalSize = const Size(1080, 4200);
      tester.view.devicePixelRatio = 2.625;
      addTearDown(tester.view.reset);
      final repo = FakeConfigApplyRequestRepository(
        requests: [...newer, source],
        progressOverride: (r) => r.id == source.id
            ? _progress(
                kind: source.kind,
                status: source.status,
                central: false,
                completedAt: _released.add(const Duration(seconds: 30)),
              )
            : fromRequest(r),
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            configApplyRequestRepositoryProvider.overrideWithValue(repo),
            taskDetailProvider.overrideWith(
              (ref, id) async => Task(
                id: id,
                title: 'BOX-0001',
                assignedTo: 'u1',
                status: TaskStatus.inProgress,
                createdAt: DateTime(2026, 11, 12),
                updatedAt: DateTime(2026, 11, 12),
                deviceId: 'BOX-0001',
              ),
            ),
          ],
          child: MaterialApp(
            home: ConfigApplyProgressPage(taskId: 't1', requestId: source.id),
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
      return repo;
    }

    Future<void> tapBottom(WidgetTester tester) async {
      await tester.tap(find.byKey(const Key('apply_progress_bottom')));
      await tester.pump();
      await tester.pump();
    }

    testWidgets(
      'Firmware -> ขออนุมัติใหม่ด้วยรุ่นเดิม รอ Operation แล้วกดส่งเข้ากล่องในหน้านี้',
      (tester) async {
        final repo = await pumpFailed(
          tester,
          fakeApplyRequest(
            kind: FieldApplyKind.firmware,
            firmwareVersion: '1.2.9',
            status: ConfigApplyRequestStatus.failed,
            releasedAt: _released,
          ),
        );
        expect(find.text('ส่งใหม่อีกครั้ง'), findsOneWidget);

        await tapBottom(tester);
        expect(repo.createCalls, 1);
        expect(repo.lastCreateFirmwareId, 'fw-1.2.9');
        expect(repo.lastCreateConfigId, isNull);
        expect(repo.lastCreateDirect, isFalse);
        expect(repo.releaseCalls, 0);
        expect(find.text('รอ Operation อนุมัติ'), findsOneWidget);
        expect(find.text('ส่งใหม่อีกครั้ง'), findsNothing);
        // ยังไม่ได้ส่ง = ขั้น "ส่งถึงกล่อง" ยังไม่ติ๊ก และไม่นับเวลา
        expect(
          find.descendant(
            of: _step(ConfigApplyProgressStepKey.delivered),
            matching: find.byIcon(Icons.check),
          ),
          findsNothing,
        );
        expect(find.byKey(const Key('apply_progress_elapsed')), findsNothing);

        // Operation อนุมัติ -> ปุ่มส่งเข้ากล่อง
        repo.requests[0] = fakeApplyRequest(
          id: 'car-new-1',
          kind: FieldApplyKind.firmware,
          firmwareVersion: '1.2.9',
          status: ConfigApplyRequestStatus.approved,
        );
        await tester.pump(progressPollInterval);
        await tester.pump();
        expect(find.text('อนุมัติแล้ว กดส่งเข้ากล่องได้เลย'), findsOneWidget);
        expect(find.text('ส่งเข้ากล่อง'), findsOneWidget);

        await tapBottom(tester);
        expect(repo.releaseCalls, 1);
        expect(repo.lastReleaseId, 'car-new-1');
        expect(find.text('กล่องกำลังติดตั้ง'), findsWidgets);
        await _unmount(tester);
      },
    );

    testWidgets(
      'Config ไม่มีค่าแก้ -> ส่งตรงด้วย Config เดิมแล้วส่งเข้ากล่องทันที',
      (tester) async {
        final repo = await pumpFailed(
          tester,
          fakeApplyRequest(
            configId: 'cfg-7',
            status: ConfigApplyRequestStatus.failed,
            releasedAt: _released,
          ),
        );
        await tapBottom(tester);
        expect(repo.lastCreateConfigId, 'cfg-7');
        expect(repo.lastCreateDirect, isTrue);
        expect(repo.releaseCalls, 1);
        expect(repo.lastReleaseId, 'car-new-1');
        expect(find.text('กล่องกำลังรับค่าใหม่'), findsWidgets);
        expect(find.text('ส่งใหม่อีกครั้ง'), findsNothing);
        await _unmount(tester);
      },
    );

    testWidgets('Config ที่มีค่าแก้เฉพาะเครื่อง -> ไม่ยื่นคำขอเอง', (
      tester,
    ) async {
      final repo = await pumpFailed(
        tester,
        fakeApplyRequest(
          status: ConfigApplyRequestStatus.failed,
          releasedAt: _released,
          override: const ApplyRequestOverride(
            id: 'ovr-1',
            fields: {'speed_limit': 80},
            reason: 'ลูกค้าขอ',
          ),
        ),
      );
      await tapBottom(tester);
      expect(repo.createCalls, 0);
      await _unmount(tester);
    });

    testWidgets('Operation ไม่อนุมัติ -> หัวข้อบอกชัด และไม่ยื่นคำขอเดิมซ้ำ', (
      tester,
    ) async {
      final repo = await pumpFailed(
        tester,
        fakeApplyRequest(
          kind: FieldApplyKind.firmware,
          firmwareVersion: '1.2.9',
          status: ConfigApplyRequestStatus.rejected,
        ),
      );
      expect(find.text('Operation ไม่อนุมัติ'), findsWidgets);
      await tapBottom(tester);
      expect(repo.createCalls, 0);
      await _unmount(tester);
    });

    testWidgets('เปิดคำขอเก่าจากประวัติ (มีคำขอใหม่กว่า) -> ไม่มีปุ่มส่งใหม่', (
      tester,
    ) async {
      final repo = await pumpFailed(
        tester,
        fakeApplyRequest(
          kind: FieldApplyKind.firmware,
          firmwareVersion: '1.2.9',
          status: ConfigApplyRequestStatus.failed,
          releasedAt: _released,
        ),
        newer: [
          fakeApplyRequest(
            id: 'car-9',
            kind: FieldApplyKind.firmware,
            firmwareVersion: '1.2.9',
            status: ConfigApplyRequestStatus.succeeded,
          ),
        ],
      );
      expect(find.text('ส่งใหม่อีกครั้ง'), findsNothing);
      expect(find.text('กลับไปหน้างาน'), findsOneWidget);
      await tapBottom(tester);
      expect(repo.createCalls, 0);
      await _unmount(tester);
    });
  });

  group('ประวัติรายรอบพับได้', () {
    ConfigApplyRetry threeRounds({required bool succeeded}) => ConfigApplyRetry(
      attemptNo: 3,
      maxAttempts: 3,
      attempts: [
        _attempt(1, ConfigApplyAttemptStatus.failed, endSeconds: 20),
        _attempt(2, ConfigApplyAttemptStatus.failed, endSeconds: 60),
        _attempt(
          3,
          succeeded
              ? ConfigApplyAttemptStatus.succeeded
              : ConfigApplyAttemptStatus.failed,
          startSeconds: 80,
          endSeconds: 96,
        ),
      ],
    );

    testWidgets('สำเร็จหลายรอบ -> พับเป็นบรรทัดสรุป แตะแล้วกาง', (
      tester,
    ) async {
      await _pump(
        tester,
        () => _progress(
          status: ConfigApplyRequestStatus.succeeded,
          central: false,
          completedAt: _released.add(const Duration(seconds: 96)),
          retry: threeRounds(succeeded: true),
        ),
      );
      final toggle = find.byKey(const Key('apply_progress_history_toggle'));
      expect(
        find.descendant(
          of: toggle,
          matching: find.text('ส่ง 3 รอบ สำเร็จรอบที่ 3'),
        ),
        findsOneWidget,
      );
      expect(find.byKey(const Key('apply_progress_attempt_1')), findsNothing);

      await tester.tap(toggle);
      await tester.pumpAndSettle();
      for (final n in [1, 2, 3]) {
        expect(find.byKey(Key('apply_progress_attempt_$n')), findsOneWidget);
      }
      await _unmount(tester);
    });

    testWidgets('ล้มครบทุกรอบ -> กางไว้ตั้งแต่แรก', (tester) async {
      await _pump(
        tester,
        () => _progress(
          status: ConfigApplyRequestStatus.failed,
          central: false,
          completedAt: _released.add(const Duration(seconds: 96)),
          retry: threeRounds(succeeded: false),
        ),
      );
      for (final n in [1, 2, 3]) {
        expect(find.byKey(Key('apply_progress_attempt_$n')), findsOneWidget);
      }
      await _unmount(tester);
    });
  });
}
