import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/push_notification/push_message_handler.dart';

void main() {
  group('resolvePushDeepLink', () {
    test(
      'task_assigned + valid taskId (JSON string payload) -> task detail',
      () {
        final path = resolvePushDeepLink({
          'type': 'task_assigned',
          'payload': jsonEncode({'taskId': 'task-123'}),
        });
        expect(path, AppRoutes.taskDetail('task-123'));
        expect(path, '/tasks/task-123');
      },
    );

    test('task_assigned + taskId in an already-decoded map -> task detail', () {
      final path = resolvePushDeepLink({
        'type': 'task_assigned',
        'payload': {'taskId': 'task-9'},
      });
      expect(path, AppRoutes.taskDetail('task-9'));
    });

    test('task_assigned + taskId with surrounding whitespace -> trimmed', () {
      final path = resolvePushDeepLink({
        'type': 'task_assigned',
        'payload': jsonEncode({'taskId': '  task-7  '}),
      });
      expect(path, AppRoutes.taskDetail('task-7'));
    });

    test('task_assigned but payload is not valid JSON -> notifications', () {
      final path = resolvePushDeepLink({
        'type': 'task_assigned',
        'payload': 'not-json{',
      });
      expect(path, AppRoutes.notifications);
    });

    test('task_assigned but payload has no taskId -> notifications', () {
      final path = resolvePushDeepLink({
        'type': 'task_assigned',
        'payload': jsonEncode({'somethingElse': 'x'}),
      });
      expect(path, AppRoutes.notifications);
    });

    test('task_assigned but taskId is empty / whitespace -> notifications', () {
      expect(
        resolvePushDeepLink({
          'type': 'task_assigned',
          'payload': jsonEncode({'taskId': ''}),
        }),
        AppRoutes.notifications,
      );
      expect(
        resolvePushDeepLink({
          'type': 'task_assigned',
          'payload': jsonEncode({'taskId': '   '}),
        }),
        AppRoutes.notifications,
      );
    });

    test('task_assigned but taskId is not a string -> notifications', () {
      final path = resolvePushDeepLink({
        'type': 'task_assigned',
        'payload': jsonEncode({'taskId': 42}),
      });
      expect(path, AppRoutes.notifications);
    });

    test('task_assigned with payload missing entirely -> notifications', () {
      final path = resolvePushDeepLink({'type': 'task_assigned'});
      expect(path, AppRoutes.notifications);
    });

    test('a known-but-not-yet-deep-linked type -> notifications', () {
      final path = resolvePushDeepLink({
        'type': 'config_approved',
        'payload': jsonEncode({'configId': 'cfg-1'}),
      });
      expect(path, AppRoutes.notifications);
    });

    test('an unrecognised type string -> notifications, no throw', () {
      final path = resolvePushDeepLink({
        'type': 'something_new_from_the_future',
        'payload': jsonEncode({'taskId': 'task-1'}),
      });
      expect(path, AppRoutes.notifications);
    });

    test('empty data map -> notifications, no throw', () {
      expect(resolvePushDeepLink(const {}), AppRoutes.notifications);
    });

    test('type present but not a string -> notifications, no throw', () {
      expect(
        resolvePushDeepLink({'type': 123, 'payload': '{}'}),
        AppRoutes.notifications,
      );
    });
  });

  group('resolvePushDeepLink — incident_report_*', () {
    for (final type in [
      'incident_report_pending',
      'incident_report_resolved',
      'incident_report_dismissed',
      'incident_report_promoted',
    ]) {
      test('$type + incidentId -> incident detail', () {
        expect(
          resolvePushDeepLink({
            'type': type,
            'payload': jsonEncode({'incidentId': 'inc-1', 'deviceId': 'D1'}),
          }),
          AppRoutes.incidentDetail('inc-1'),
        );
      });
    }

    test('incidentId is trimmed and accepted from a decoded map', () {
      expect(
        resolvePushDeepLink({
          'type': 'incident_report_resolved',
          'payload': {'incidentId': ' inc-2 '},
        }),
        '/incidents/inc-2',
      );
    });

    test('missing / empty / non-string incidentId, bad or no payload -> '
        'notifications', () {
      for (final payload in <Object?>[
        jsonEncode({'deviceId': 'D1'}),
        jsonEncode({'incidentId': ''}),
        jsonEncode({'incidentId': 5}),
        'not-json{',
        null,
      ]) {
        expect(
          resolvePushDeepLink({
            'type': 'incident_report_pending',
            'payload': payload,
          }),
          AppRoutes.notifications,
        );
      }
    });

    test('a task payload under an incident type does not deep-link', () {
      expect(
        resolvePushDeepLink({
          'type': 'incident_report_pending',
          'payload': jsonEncode({'taskId': 't1'}),
        }),
        AppRoutes.notifications,
      );
    });
  });

  group('resolvePushBody', () {
    test('uses payload title (incident_report_pending)', () {
      expect(
        resolvePushBody({
          'type': 'incident_report_pending',
          'payload': jsonEncode({'incidentId': 'i', 'title': 'สายไฟขาด'}),
        }),
        'สายไฟขาด',
      );
    });

    test('uses reviewNote when there is no title (decision)', () {
      expect(
        resolvePushBody({
          'type': 'incident_report_resolved',
          'payload': jsonEncode({'incidentId': 'i', 'reviewNote': 'แก้แล้ว'}),
        }),
        'แก้แล้ว',
      );
    });

    test('title wins over reviewNote', () {
      expect(
        resolvePushBody({
          'payload': {'title': 'T', 'reviewNote': 'R'},
        }),
        'T',
      );
    });

    test('blank / missing / malformed -> default text, never throws', () {
      const fallback = 'แตะเพื่อดูรายละเอียด';
      expect(resolvePushBody({}), fallback);
      expect(resolvePushBody({'payload': 'not-json{'}), fallback);
      expect(
        resolvePushBody({
          'payload': jsonEncode({'title': '  '}),
        }),
        fallback,
      );
      expect(
        resolvePushBody({
          'payload': jsonEncode({'title': 3}),
        }),
        fallback,
      );
      expect(
        resolvePushBody({
          'type': 'task_assigned',
          'payload': jsonEncode({'taskId': 't1'}),
        }),
        fallback,
      );
    });
  });

  group('pending push route (tap before the session is ready)', () {
    late ProviderContainer container;
    late GoRouter router;

    setUp(() {
      router = GoRouter(
        routes: [
          GoRoute(path: '/', builder: (_, _) => const SizedBox()),
          GoRoute(path: '/incidents/:id', builder: (_, _) => const SizedBox()),
        ],
      );
      container = ProviderContainer(
        overrides: [
          authControllerProvider.overrideWith(
            () => _MutableAuth(const AuthState(status: AuthStatus.unknown)),
          ),
          routerProvider.overrideWithValue(router),
        ],
      );
      addTearDown(container.dispose);
      addTearDown(router.dispose);
    });

    Future<void> pumpApp(WidgetTester tester) =>
        tester.pumpWidget(MaterialApp.router(routerConfig: router));

    String location() => router.routeInformationProvider.value.uri.toString();

    _MutableAuth auth() =>
        container.read(authControllerProvider.notifier) as _MutableAuth;

    test('not authenticated -> path is parked, router untouched', () {
      container.read(pushMessageHandlerProvider).openPath('/incidents/i1');

      expect(container.read(pendingPushRouteProvider), '/incidents/i1');
      expect(location(), '/');
    });

    testWidgets('parked path opens once authenticated, then is cleared', (
      tester,
    ) async {
      await pumpApp(tester);
      container.read(pushMessageHandlerProvider).openPath('/incidents/i1');

      auth().set(const AuthState(status: AuthStatus.authenticated));
      await tester.pump(); // post-frame navigation
      await tester.pump();

      expect(container.read(pendingPushRouteProvider), isNull);
      expect(location(), '/incidents/i1');
    });

    test('becoming unauthenticated keeps the parked path', () {
      container.read(pushMessageHandlerProvider).openPath('/incidents/i1');
      auth().set(const AuthState(status: AuthStatus.unauthenticated));

      expect(container.read(pendingPushRouteProvider), '/incidents/i1');
    });

    testWidgets('already authenticated -> opens immediately, nothing parked', (
      tester,
    ) async {
      await pumpApp(tester);
      container.read(pushMessageHandlerProvider); // attach auth listener
      auth().set(const AuthState(status: AuthStatus.authenticated));

      container.read(pushMessageHandlerProvider).openPath('/incidents/i2');
      await tester.pump();
      await tester.pump();

      expect(container.read(pendingPushRouteProvider), isNull);
      expect(location(), '/incidents/i2');
    });
  });
}

class _MutableAuth extends AuthController {
  _MutableAuth(this._initial);

  final AuthState _initial;

  @override
  AuthState build() => _initial;

  void set(AuthState next) => state = next;
}
