import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/realtime/live_refresh.dart';
import 'package:mobile/core/realtime/realtime_controller.dart';
import 'package:mobile/core/sync/sync_providers.dart';

void main() {
  group('RealtimeController', () {
    testWidgets(
      'polls active registrations and stops on pause, logout, dispose',
      (tester) async {
        final controller = RealtimeController(mockMode: false)..start();
        controller.setAuthenticated(true);
        var calls = 0;
        final registration = controller.register(
          interval: const Duration(seconds: 5),
          refresh: () => calls++,
        );
        addTearDown(() {
          registration.dispose();
          controller.dispose();
        });

        await tester.pump(const Duration(seconds: 5));
        expect(calls, 1);

        controller.didChangeAppLifecycleState(AppLifecycleState.paused);
        await tester.pump(const Duration(seconds: 10));
        expect(calls, 1);

        controller.didChangeAppLifecycleState(AppLifecycleState.resumed);
        expect(calls, 1, reason: 'resume waits for the sync trigger');
        controller.refreshActive();
        expect(calls, 2);
        await tester.pump(const Duration(seconds: 5));
        expect(calls, 3);

        controller.setAuthenticated(false);
        await tester.pump(const Duration(seconds: 10));
        expect(calls, 3);
      },
    );

    testWidgets('mock mode never polls or refreshes on resume', (tester) async {
      final controller = RealtimeController(mockMode: true)..start();
      controller.setAuthenticated(true);
      var calls = 0;
      final registration = controller.register(
        interval: const Duration(seconds: 1),
        refresh: () => calls++,
      );
      addTearDown(() {
        registration.dispose();
        controller.dispose();
      });

      controller.didChangeAppLifecycleState(AppLifecycleState.resumed);
      await tester.pump(const Duration(seconds: 10));
      expect(calls, 0);
    });

    testWidgets('inactive page registrations do not poll', (tester) async {
      final controller = RealtimeController(mockMode: false)..start();
      controller.setAuthenticated(true);
      var calls = 0;
      final registration = controller.register(
        interval: const Duration(seconds: 1),
        refresh: () => calls++,
        active: false,
      );
      addTearDown(() {
        registration.dispose();
        controller.dispose();
      });

      await tester.pump(const Duration(seconds: 10));
      expect(calls, 0);
      registration.setActive(true);
      expect(calls, 1, reason: 'returning to a page refreshes immediately');
      await tester.pump(const Duration(seconds: 1));
      expect(calls, 2);
      registration.dispose();
      controller.dispose();
    });

    testWidgets('LiveRefresh follows selected tab and visible route', (
      tester,
    ) async {
      final controller = RealtimeController(mockMode: false)..start();
      controller.setAuthenticated(true);
      final container = ProviderContainer(
        overrides: [
          realtimeControllerProvider.overrideWith((ref) => controller),
        ],
      );
      var calls = 0;
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            navigatorObservers: [mobileRouteObserver],
            home: LiveRefresh(
              interval: const Duration(seconds: 1),
              tabIndex: 2,
              onRefresh: () async => calls++,
              child: const Scaffold(body: Text('active page')),
            ),
          ),
        ),
      );

      await tester.pump(const Duration(seconds: 2));
      expect(calls, 0, reason: 'an offstage tab must not poll');

      container.read(activeAppTabIndexProvider.notifier).state = 2;
      await tester.pump();
      expect(calls, 1, reason: 'selecting the tab refreshes immediately');
      await tester.pump(const Duration(seconds: 1));
      expect(calls, 2);

      final navigator = Navigator.of(tester.element(find.text('active page')));
      navigator.push<void>(
        MaterialPageRoute<void>(builder: (_) => const Scaffold()),
      );
      await tester.pumpAndSettle();
      final pausedCalls = calls;
      await tester.pump(const Duration(seconds: 3));
      expect(calls, pausedCalls, reason: 'a covered route must not poll');

      navigator.pop();
      await tester.pumpAndSettle();
      expect(
        calls,
        pausedCalls + 1,
        reason: 'return refreshes the visible page',
      );

      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
      controller.dispose();
    });

    testWidgets('does not overlap a refresh already in flight', (tester) async {
      final controller = RealtimeController(mockMode: false)..start();
      controller.setAuthenticated(true);
      final first = Completer<void>();
      var calls = 0;
      final registration = controller.register(
        interval: const Duration(seconds: 1),
        refresh: () {
          calls++;
          return first.future;
        },
      );
      addTearDown(() {
        registration.dispose();
        controller.dispose();
      });

      await tester.pump(const Duration(seconds: 3));
      expect(calls, 1);
      first.complete();
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      expect(calls, 2);
      registration.dispose();
      controller.dispose();
    });
  });
}
