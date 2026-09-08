import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
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
}
