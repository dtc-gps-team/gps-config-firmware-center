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
}
