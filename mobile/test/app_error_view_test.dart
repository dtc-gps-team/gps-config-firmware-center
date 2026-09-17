import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/widgets/app_error_view.dart';

Future<void> _pump(WidgetTester tester, Widget child) {
  return tester.pumpWidget(MaterialApp(home: Scaffold(body: child)));
}

void main() {
  testWidgets('default (standard) layout shows icon, message and a '
      'FilledButton retry', (tester) async {
    var retried = false;
    await _pump(
      tester,
      AppErrorView(
        message: 'โหลดไม่สำเร็จ',
        onRetry: () => retried = true,
        messageKey: const Key('msg'),
        retryKey: const Key('retry'),
      ),
    );

    expect(find.byIcon(Icons.error_outline), findsOneWidget);
    expect(find.text('โหลดไม่สำเร็จ'), findsOneWidget);
    expect(find.byKey(const Key('msg')), findsOneWidget);
    expect(find.byType(FilledButton), findsOneWidget);
    expect(find.byType(TextButton), findsNothing);

    await tester.tap(find.byKey(const Key('retry')));
    expect(retried, isTrue);
  });

  testWidgets('compact layout shows a TextButton (not FilledButton) retry', (
    tester,
  ) async {
    var retried = false;
    await _pump(
      tester,
      AppErrorView(
        message: 'เซิร์ฟเวอร์ล่ม',
        onRetry: () => retried = true,
        retryKey: const Key('retry_compact'),
        compact: true,
      ),
    );

    expect(find.text('เซิร์ฟเวอร์ล่ม'), findsOneWidget);
    expect(find.byType(TextButton), findsOneWidget);
    expect(find.byType(FilledButton), findsNothing);

    await tester.tap(find.byKey(const Key('retry_compact')));
    expect(retried, isTrue);
  });

  testWidgets('messageKey and retryKey are optional', (tester) async {
    await _pump(tester, AppErrorView(message: 'error', onRetry: () {}));

    expect(find.text('error'), findsOneWidget);
    expect(find.byType(FilledButton), findsOneWidget);
  });
}
