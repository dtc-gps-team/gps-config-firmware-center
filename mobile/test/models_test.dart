import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';

void main() {
  group('UserRole', () {
    test('has exactly the 6 roles from openapi.yaml — no FieldTechnician', () {
      expect(UserRole.values.map((r) => r.wireName).toList(), [
        'SW',
        'Operation',
        'ST',
        'OT',
        'Auditor',
        'Admin',
      ]);
    });

    test('fromWire maps known values', () {
      expect(UserRole.fromWire('SW'), UserRole.sw);
      expect(UserRole.fromWire('Admin'), UserRole.admin);
    });

    test('fromWire rejects FieldTechnician and other unknown values', () {
      expect(() => UserRole.fromWire('FieldTechnician'), throwsArgumentError);
      expect(() => UserRole.fromWire('sw'), throwsArgumentError);
    });
  });

  group('LoginResponse.fromJson', () {
    test('parses token and role', () {
      final result = LoginResponse.fromJson({
        'accessToken': 'abc',
        'role': 'Operation',
      });
      expect(result.accessToken, 'abc');
      expect(result.role, UserRole.operation);
    });

    test('tolerates a missing role', () {
      final result = LoginResponse.fromJson({'accessToken': 'abc'});
      expect(result.role, isNull);
    });
  });

  group('SimulationResult.fromJson', () {
    test('parses passed and details', () {
      final result = SimulationResult.fromJson({
        'passed': true,
        'details': ['ok', 'done'],
      });
      expect(result.passed, isTrue);
      expect(result.details, ['ok', 'done']);
    });

    test('defaults to failed with no details', () {
      final result = SimulationResult.fromJson(const {});
      expect(result.passed, isFalse);
      expect(result.details, isEmpty);
    });
  });

  group('DeviceConnectionTestResult.fromJson', () {
    test('parses all fields', () {
      final result = DeviceConnectionTestResult.fromJson({
        'passed': true,
        'signalStrength': -65,
        'details': ['เชื่อมต่อสำเร็จ', 'RSSI -65 dBm'],
        'testedAt': '2026-09-02T10:00:00.000Z',
      });
      expect(result.passed, isTrue);
      expect(result.signalStrength, -65);
      expect(result.details, ['เชื่อมต่อสำเร็จ', 'RSSI -65 dBm']);
      expect(result.testedAt, DateTime.utc(2026, 9, 2, 10));
    });

    test('tolerates signalStrength arriving as a double', () {
      final result = DeviceConnectionTestResult.fromJson({
        'passed': false,
        'signalStrength': -70.0,
        'details': <dynamic>[],
        'testedAt': '2026-09-02T10:00:00Z',
      });
      expect(result.signalStrength, -70);
    });

    test('defaults on missing fields', () {
      final result = DeviceConnectionTestResult.fromJson(const {});
      expect(result.passed, isFalse);
      expect(result.signalStrength, 0);
      expect(result.details, isEmpty);
      expect(result.testedAt, isA<DateTime>());
    });
  });

  group('DeviceConfigDraft.fromJson', () {
    test('parses status enum and fields map', () {
      final draft = DeviceConfigDraft.fromJson({
        'id': 'cfg-1',
        'deviceModel': 'GT06N',
        'protocol': 'TCP',
        'status': 'testing',
        'fields': {'APN1': 'internet'},
      });
      expect(draft.status, ConfigStatus.testing);
      expect(draft.fields, {'APN1': 'internet'});
    });
  });

  group('TaskStatus', () {
    test('wire names match openapi.yaml / Prisma enum', () {
      expect(TaskStatus.values.map((s) => s.wireName).toList(), [
        'pending',
        'in_progress',
        'completed',
        'cancelled',
      ]);
    });

    test('fromWire maps known values and rejects unknown', () {
      expect(TaskStatus.fromWire('in_progress'), TaskStatus.inProgress);
      expect(() => TaskStatus.fromWire('done'), throwsArgumentError);
    });
  });

  group('Task.fromJson', () {
    test('parses a full payload', () {
      final task = Task.fromJson({
        'id': 'task-1',
        'title': 'ติดตั้งกล่อง',
        'description': 'รายละเอียด',
        'assignedTo': 'user-9',
        'deviceId': 'DVC-1',
        'configId': 'cfg-7',
        'status': 'in_progress',
        'dueDate': '2026-09-10T00:00:00.000Z',
        'createdAt': '2026-09-01T08:00:00.000Z',
        'updatedAt': '2026-09-02T09:30:00.000Z',
      });

      expect(task.id, 'task-1');
      expect(task.title, 'ติดตั้งกล่อง');
      expect(task.description, 'รายละเอียด');
      expect(task.assignedTo, 'user-9');
      expect(task.deviceId, 'DVC-1');
      expect(task.configId, 'cfg-7');
      expect(task.status, TaskStatus.inProgress);
      expect(task.dueDate, DateTime.utc(2026, 9, 10));
      expect(task.createdAt, DateTime.utc(2026, 9, 1, 8));
      expect(task.updatedAt, DateTime.utc(2026, 9, 2, 9, 30));
    });

    test('tolerates null nullable fields', () {
      final task = Task.fromJson({
        'id': 'task-2',
        'title': 'งาน',
        'assignedTo': 'user-1',
        'status': 'pending',
        'description': null,
        'deviceId': null,
        'dueDate': null,
        'createdAt': '2026-09-01T00:00:00Z',
        'updatedAt': '2026-09-01T00:00:00Z',
      });

      expect(task.description, isNull);
      expect(task.deviceId, isNull);
      expect(task.configId, isNull);
      expect(task.dueDate, isNull);
      expect(task.status, TaskStatus.pending);
    });
  });

  group('NotificationType', () {
    test('wire names match openapi.yaml / Prisma enum', () {
      expect(NotificationType.values.map((t) => t.wireName).toList(), [
        'task_assigned',
        'config_approved',
        'config_rejected',
        'firmware_ready',
        'incident_alert',
      ]);
    });

    test('fromWire maps known values and rejects unknown', () {
      expect(
        NotificationType.fromWire('firmware_ready'),
        NotificationType.firmwareReady,
      );
      expect(() => NotificationType.fromWire('nope'), throwsArgumentError);
    });
  });

  group('AppNotification.fromJson', () {
    test('parses a full payload', () {
      final n = AppNotification.fromJson({
        'id': 'noti-1',
        'userId': 'user-9',
        'type': 'task_assigned',
        'payload': {'taskId': 't1'},
        'read': false,
        'sentAt': '2026-09-04T08:31:00.000Z',
        'createdAt': '2026-09-04T08:30:00.000Z',
      });

      expect(n.id, 'noti-1');
      expect(n.userId, 'user-9');
      expect(n.type, NotificationType.taskAssigned);
      expect(n.payload, {'taskId': 't1'});
      expect(n.read, isFalse);
      expect(n.sentAt, DateTime.utc(2026, 9, 4, 8, 31));
      expect(n.createdAt, DateTime.utc(2026, 9, 4, 8, 30));
    });

    test('tolerates null sentAt and missing payload', () {
      final n = AppNotification.fromJson({
        'id': 'noti-2',
        'userId': 'u1',
        'type': 'incident_alert',
        'payload': null,
        'read': true,
        'sentAt': null,
        'createdAt': '2026-09-04T00:00:00Z',
      });

      expect(n.sentAt, isNull);
      expect(n.payload, isEmpty);
      expect(n.read, isTrue);
    });

    test('copyWith(read:) flips read only', () {
      final n = AppNotification.fromJson({
        'id': 'noti-3',
        'userId': 'u1',
        'type': 'config_approved',
        'payload': const {},
        'read': false,
        'createdAt': '2026-09-04T00:00:00Z',
      });

      final updated = n.copyWith(read: true);
      expect(updated.read, isTrue);
      expect(updated.id, n.id);
      expect(updated.type, n.type);
      expect(updated.createdAt, n.createdAt);
    });
  });
}
