import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';
import 'package:mobile/features/incident/incident_repository.dart';
import 'package:mobile/features/notification/notification_repository.dart';
import 'package:mobile/features/task/task_repository.dart';

/// ยืนยันว่า Mobile mock data (`API_MOCK_MODE`) แต่ละ entity มีจำนวน record
/// สมจริง (5-8 ตามมติ) และ id ที่อ้างอิงข้าม entity (Task/Incident/
/// Notification -> Device, Notification -> Task/Incident) มีอยู่จริงเสมอ
/// ไม่ orphan — กันปัญหาเดิมที่ Task mock เคยอ้าง deviceId แบบ "DVC-xxxx" ที่
/// ไม่มีอยู่จริงใน Device mock เลย
void main() {
  group('Mobile mock data — จำนวน record อยู่ในช่วง 5-8', () {
    test('Task', () async {
      final tasks = await MockTaskRepository().listTasks();
      expect(tasks.length, inInclusiveRange(5, 8));
    });

    test('Device', () async {
      final devices = await MockDeviceSearchRepository().listDevices();
      expect(devices.length, inInclusiveRange(5, 8));
    });

    test('Notification', () async {
      final items = await MockNotificationRepository().list();
      expect(items.length, inInclusiveRange(5, 8));
    });

    test('Incident', () async {
      final incidents = await MockIncidentRepository().listIncidents();
      expect(incidents.length, inInclusiveRange(5, 8));
    });
  });

  group('Mobile mock data — ไม่มี orphan reference ข้าม entity', () {
    test('Task.deviceId ทุกตัวตรงกับ Device ที่มีอยู่จริง', () async {
      final tasks = await MockTaskRepository().listTasks();
      final deviceIds = (await MockDeviceSearchRepository().listDevices())
          .map((d) => d.deviceId)
          .toSet();

      for (final task in tasks) {
        final deviceId = task.deviceId;
        if (deviceId == null) continue;
        expect(
          deviceIds.contains(deviceId),
          isTrue,
          reason:
              'Task ${task.id} อ้าง deviceId "$deviceId" ที่ไม่มีอยู่จริงใน '
              'Device mock',
        );
      }
    });

    test('Incident.deviceId ทุกตัวตรงกับ Device ที่มีอยู่จริง', () async {
      final incidents = await MockIncidentRepository().listIncidents();
      final deviceIds = (await MockDeviceSearchRepository().listDevices())
          .map((d) => d.deviceId)
          .toSet();

      for (final incident in incidents) {
        final deviceId = incident.deviceId;
        if (deviceId == null) continue;
        expect(
          deviceIds.contains(deviceId),
          isTrue,
          reason:
              'Incident ${incident.id} อ้าง deviceId "$deviceId" ที่ไม่มีอยู่'
              'จริงใน Device mock',
        );
      }
    });

    test(
      'Notification payload.deviceId ทุกตัวตรงกับ Device ที่มีอยู่จริง',
      () async {
        final items = await MockNotificationRepository().list();
        final deviceIds = (await MockDeviceSearchRepository().listDevices())
            .map((d) => d.deviceId)
            .toSet();

        for (final n in items) {
          final deviceId = n.payload['deviceId'];
          if (deviceId is! String) continue;
          expect(
            deviceIds.contains(deviceId),
            isTrue,
            reason:
                'Notification ${n.id} (${n.type}) อ้าง payload.deviceId '
                '"$deviceId" ที่ไม่มีอยู่จริงใน Device mock',
          );
        }
      },
    );

    test(
      'Notification payload.taskId ทุกตัวตรงกับ Task ที่มีอยู่จริง',
      () async {
        final items = await MockNotificationRepository().list();
        final taskIds = (await MockTaskRepository().listTasks())
            .map((t) => t.id)
            .toSet();

        for (final n in items) {
          final taskId = n.payload['taskId'];
          if (taskId is! String) continue;
          expect(
            taskIds.contains(taskId),
            isTrue,
            reason:
                'Notification ${n.id} (${n.type}) อ้าง payload.taskId '
                '"$taskId" ที่ไม่มีอยู่จริงใน Task mock',
          );
        }
      },
    );

    test(
      'Notification payload.incidentId ทุกตัวตรงกับ Incident ที่มีอยู่จริง',
      () async {
        final items = await MockNotificationRepository().list();
        final incidentIds = (await MockIncidentRepository().listIncidents())
            .map((i) => i.id)
            .toSet();

        for (final n in items) {
          final incidentId = n.payload['incidentId'];
          if (incidentId is! String) continue;
          expect(
            incidentIds.contains(incidentId),
            isTrue,
            reason:
                'Notification ${n.id} (${n.type}) อ้าง payload.incidentId '
                '"$incidentId" ที่ไม่มีอยู่จริงใน Incident mock',
          );
        }
      },
    );
  });

  group('Mobile mock data — ความหลากหลายที่ต้องมีตามมติ', () {
    test('Task.assignedTo ไม่ว่างทุกรายการ', () async {
      final tasks = await MockTaskRepository().listTasks();
      expect(tasks.every((t) => t.assignedTo.isNotEmpty), isTrue);
    });

    test('Task มี configId อย่างน้อย 1 รายการ', () async {
      final tasks = await MockTaskRepository().listTasks();
      expect(tasks.any((t) => t.configId != null), isTrue);
    });

    test('Task มี dueDate อย่างน้อย 1 รายการ', () async {
      final tasks = await MockTaskRepository().listTasks();
      expect(tasks.any((t) => t.dueDate != null), isTrue);
    });

    test(
      'Device มีทั้งที่ identity field ครบและว่าง (null-safe ของ #306)',
      () async {
        final devices = await MockDeviceSearchRepository().listDevices();
        expect(
          devices.any((d) => d.imei != null && d.customer != null),
          isTrue,
        );
        expect(
          devices.any((d) => d.imei == null && d.customer == null),
          isTrue,
        );
      },
    );

    test(
      'Incident มีทั้งที่ถูก review แล้วและยังไม่ถูก review (conditional card ของ #306)',
      () async {
        final incidents = await MockIncidentRepository().listIncidents();
        expect(incidents.any((i) => i.reviewedBy != null), isTrue);
        expect(
          incidents.any(
            (i) =>
                i.reviewedBy == null &&
                i.reviewedAt == null &&
                (i.reviewNote == null || i.reviewNote!.isEmpty),
          ),
          isTrue,
        );
      },
    );

    test(
      'Notification ไม่มี mock ของ type ที่ backend ไม่มี producer จริง',
      () async {
        final items = await MockNotificationRepository().list();
        final noProducerTypes = {
          'config_approved',
          'config_rejected',
          'firmware_ready',
        };
        expect(
          items.any((n) => noProducerTypes.contains(n.type.wireName)),
          isFalse,
        );
      },
    );
  });
}
