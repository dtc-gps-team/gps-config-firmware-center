import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/realtime/live_refresh.dart';
import 'package:mobile/core/realtime/realtime_controller.dart';
import 'package:mobile/core/sync/sync_providers.dart';

class _UnauthorizedAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async => ResponseBody.fromString(
    '{"message":"Unauthorized"}',
    401,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );

  @override
  void close({bool force = false}) {}
}

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

    testWidgets('a root route pauses a tab page and return refreshes it', (
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
      final router = GoRouter(
        initialLocation: '/home',
        observers: [mobileRouteObserver],
        routes: [
          StatefulShellRoute.indexedStack(
            builder: (context, state, shell) => shell,
            branches: [
              StatefulShellBranch(
                routes: [
                  GoRoute(
                    path: '/home',
                    builder: (context, state) => LiveRefresh(
                      interval: const Duration(seconds: 1),
                      onRefresh: () async => calls++,
                      child: const Scaffold(body: Text('home')),
                    ),
                  ),
                ],
              ),
            ],
          ),
          GoRoute(
            path: '/detail',
            builder: (context, state) => const Scaffold(body: Text('detail')),
          ),
        ],
      );
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 2));
      expect(calls, greaterThan(0));

      unawaited(router.push<void>('/detail'));
      await tester.pumpAndSettle();
      final coveredCalls = calls;
      await tester.pump(const Duration(seconds: 5));
      expect(calls, coveredCalls, reason: 'a covered branch must stop polling');

      router.pop();
      await tester.pumpAndSettle();
      expect(calls, coveredCalls + 1, reason: 'return refreshes once');

      await tester.pumpWidget(const SizedBox.shrink());
      router.dispose();
      container.dispose();
      controller.dispose();
    });

    testWidgets('an unselected go_router tab does not poll', (tester) async {
      final controller = RealtimeController(mockMode: false)..start();
      controller.setAuthenticated(true);
      final container = ProviderContainer(
        overrides: [
          realtimeControllerProvider.overrideWith((ref) => controller),
        ],
      );
      var homeCalls = 0;
      var deviceCalls = 0;
      final router = GoRouter(
        initialLocation: '/home',
        routes: [
          StatefulShellRoute.indexedStack(
            builder: (context, state, shell) => Scaffold(
              body: shell,
              bottomNavigationBar: Row(
                children: [
                  TextButton(
                    key: const Key('go_home'),
                    onPressed: () => shell.goBranch(0),
                    child: const Text('Home'),
                  ),
                  TextButton(
                    key: const Key('go_device'),
                    onPressed: () => shell.goBranch(1),
                    child: const Text('Device'),
                  ),
                ],
              ),
            ),
            branches: [
              StatefulShellBranch(
                routes: [
                  GoRoute(
                    path: '/home',
                    builder: (context, state) => LiveRefresh(
                      interval: const Duration(seconds: 1),
                      onRefresh: () async => homeCalls++,
                      child: const Scaffold(body: Text('home-tab')),
                    ),
                  ),
                ],
              ),
              StatefulShellBranch(
                routes: [
                  GoRoute(
                    path: '/device',
                    builder: (context, state) => LiveRefresh(
                      interval: const Duration(seconds: 1),
                      onRefresh: () async => deviceCalls++,
                      child: const Scaffold(body: Text('device-tab')),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      );
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 3));
      expect(homeCalls, greaterThan(0));
      expect(deviceCalls, 0);

      await tester.tap(find.byKey(const Key('go_device')));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 1));
      final pausedHomeCalls = homeCalls;
      expect(deviceCalls, greaterThan(0));
      await tester.pump(const Duration(seconds: 3));
      expect(homeCalls, pausedHomeCalls);

      await tester.pumpWidget(const SizedBox.shrink());
      router.dispose();
      container.dispose();
      controller.dispose();
    });

    testWidgets(
      'poll failure keeps content and scroll position without UI errors',
      (tester) async {
        final controller = RealtimeController(mockMode: false)..start();
        controller.setAuthenticated(true);
        final container = ProviderContainer(
          overrides: [
            realtimeControllerProvider.overrideWith((ref) => controller),
          ],
        );
        final scrollController = ScrollController();
        var calls = 0;
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp(
              home: LiveRefresh(
                interval: const Duration(seconds: 1),
                onRefresh: () async {
                  calls++;
                  throw StateError('temporary refresh failure');
                },
                child: Scaffold(
                  appBar: AppBar(title: const Text('retained content')),
                  body: ListView(
                    controller: scrollController,
                    children: [for (var i = 0; i < 40; i++) Text('row $i')],
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pump();
        await tester.drag(find.byType(ListView), const Offset(0, -300));
        await tester.pumpAndSettle();
        final offset = scrollController.offset;
        await tester.pump(const Duration(seconds: 1));
        await tester.pump();

        expect(calls, 1, reason: 'real polling is enabled in this test');
        expect(find.text('retained content'), findsOneWidget);
        expect(find.byType(CircularProgressIndicator), findsNothing);
        expect(find.byType(SnackBar), findsNothing);
        expect(scrollController.offset, offset);

        await tester.pumpWidget(const SizedBox.shrink());
        scrollController.dispose();
        container.dispose();
        controller.dispose();
      },
    );

    testWidgets('changing an active task timer replaces the old timer', (
      tester,
    ) async {
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
      registration.update(interval: const Duration(seconds: 15));
      await tester.pump(const Duration(seconds: 14));
      expect(calls, 1, reason: 'the previous five-second timer is cancelled');
      await tester.pump(const Duration(seconds: 1));
      expect(calls, 2, reason: 'one replacement fifteen-second timer runs');
      registration.dispose();
      controller.dispose();
    });

    testWidgets('a refresh 401 logs out and stops subsequent timer ticks', (
      tester,
    ) async {
      final controller = RealtimeController(mockMode: false)..start();
      controller.setAuthenticated(true);
      var unauthorizedCalls = 0;
      var refreshCalls = 0;
      final dio = Dio(BaseOptions(baseUrl: 'http://unit.test'))
        ..httpClientAdapter = _UnauthorizedAdapter();
      final client = ApiClient(dio: dio)..setAuthToken('test-session');
      client.onUnauthorized = () {
        unauthorizedCalls++;
        controller.setAuthenticated(false);
      };
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            realtimeControllerProvider.overrideWith((ref) => controller),
          ],
          child: MaterialApp(
            home: LiveRefresh(
              interval: const Duration(seconds: 1),
              onRefresh: () async {
                refreshCalls++;
                await client.listTasks();
              },
              child: const Scaffold(body: Text('signed-in page')),
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      await tester.pump();
      await tester.pump(const Duration(seconds: 5));

      expect(unauthorizedCalls, 1);
      expect(refreshCalls, 1, reason: 'logout cancels the periodic timer');
      expect(find.text('signed-in page'), findsOneWidget);

      await tester.pumpWidget(const SizedBox.shrink());
      dio.close(force: true);
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
