import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/config_simulator/simulator_page.dart';

/// Uses the real `MockSimulatorRepository` (the only implementation in Phase 1)
/// via the unmodified provider — so this also covers the page ↔ provider
/// wiring. `MockSimulatorRepository.simulate` has a fixed 600ms delay.
Future<void> _pump(WidgetTester tester) {
  return tester.pumpWidget(
    const ProviderScope(child: MaterialApp(home: SimulatorPage())),
  );
}

Finder get _runButton => find.byType(FilledButton);
Finder get _configField => find.byType(TextField).first;

void main() {
  testWidgets('render — default text ใน 2 ช่อง + ปุ่มรัน, ยังไม่มีผล', (
    tester,
  ) async {
    await _pump(tester);

    expect(find.text('demo-config-1'), findsOneWidget);
    expect(find.text('GT06N'), findsOneWidget);
    expect(
      find.widgetWithText(FilledButton, 'รันทดสอบ (mock)'),
      findsOneWidget,
    );
    expect(find.byType(Card), findsNothing);
  });

  testWidgets('กดรัน — loading state ระหว่างรอ แล้วแสดงผลเมื่อเสร็จ', (
    tester,
  ) async {
    await _pump(tester);

    await tester.tap(_runButton);
    await tester.pump(); // _run() setState running = true

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(tester.widget<FilledButton>(_runButton).onPressed, isNull);
    expect(find.byType(Card), findsNothing);

    await tester.pump(const Duration(milliseconds: 700)); // mock resolves
    await tester.pump(); // setState with result

    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(tester.widget<FilledButton>(_runButton).onPressed, isNotNull);
    expect(find.byType(Card), findsOneWidget);
  });

  testWidgets('input default ครบ -> ผลลัพธ์ "ผ่าน" + ข้อความ MOCK/ค่าที่ส่ง', (
    tester,
  ) async {
    await _pump(tester);

    await tester.tap(_runButton);
    await tester.pumpAndSettle();

    expect(find.text('ผ่าน'), findsOneWidget);
    expect(find.textContaining('MOCK'), findsWidgets);
    expect(find.text('• configId = demo-config-1'), findsOneWidget);
    expect(find.text('• deviceModel = GT06N'), findsOneWidget);
    expect(find.textContaining('ผ่านการตรวจ'), findsOneWidget);
  });

  testWidgets(
    'ล้าง Config ID แล้วกดรัน -> ผลลัพธ์ "ไม่ผ่าน" + แจ้งให้ระบุครบ',
    (tester) async {
      await _pump(tester);

      await tester.enterText(_configField, '');
      await tester.pump();

      await tester.tap(_runButton);
      await tester.pumpAndSettle();

      expect(find.text('ไม่ผ่าน'), findsOneWidget);
      expect(find.text('ผ่าน'), findsNothing);
      expect(find.textContaining('ต้องระบุ'), findsOneWidget);
    },
  );
}
