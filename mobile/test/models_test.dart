import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';

void main() {
  _deviceStatusTests();

  group('UserRole', () {
    test('has exactly the 6 roles from openapi.yaml — no FieldTechnician', () {
      expect(UserRole.values.map((r) => r.wireName).toList(), [
        'Operation',
        'ST',
        'OT',
        'Auditor',
        'Admin',
        'SuperAdmin',
      ]);
    });

    test('fromWire maps known values', () {
      expect(UserRole.fromWire('Admin'), UserRole.admin);
      expect(UserRole.fromWire('SuperAdmin'), UserRole.superAdmin);
    });

    test('fromWire rejects FieldTechnician and other unknown values', () {
      expect(() => UserRole.fromWire('FieldTechnician'), throwsArgumentError);
      expect(() => UserRole.fromWire('sw'), throwsArgumentError);
      // SW ถูกแยกเป็น ConfigEngineer/FirmwareEngineer/QAEngineer แล้ว (Web-only,
      // docs/13_Role_Redesign_Proposal.md §3.1, PR #178) — wire value 'SW'
      // (ตัวพิมพ์ใหญ่ ที่เคย valid) ต้องถูก reject เหมือนกันตอนนี้
      expect(() => UserRole.fromWire('SW'), throwsArgumentError);
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

  group('DeviceSimulateConfigResult.fromJson', () {
    test('parses all 3 sub-checks', () {
      final result = DeviceSimulateConfigResult.fromJson({
        'passed': true,
        'configCheck': {
          'passed': true,
          'details': ['ทุก field ผ่าน'],
        },
        'compatibilityCheck': {
          'passed': true,
          'details': ['GT06N/TCP ตรงกับอุปกรณ์'],
        },
        'connectionCheck': {
          'passed': true,
          'signalStrength': -65,
          'details': ['ออนไลน์'],
          'testedAt': '2026-09-08T10:00:00.000Z',
        },
      });
      expect(result.passed, isTrue);
      expect(result.configCheck.details, ['ทุก field ผ่าน']);
      expect(result.compatibilityCheck.passed, isTrue);
      expect(result.connectionCheck.signalStrength, -65);
    });

    test('defaults every sub-check to failed/empty on a bare object', () {
      final result = DeviceSimulateConfigResult.fromJson(const {});
      expect(result.passed, isFalse);
      expect(result.configCheck.passed, isFalse);
      expect(result.compatibilityCheck.passed, isFalse);
      expect(result.compatibilityCheck.details, isEmpty);
      expect(result.connectionCheck.passed, isFalse);
    });
  });

  group('DeviceConfigDraft.fromJson', () {
    test('parses status enum and fields map', () {
      final draft = DeviceConfigDraft.fromJson({
        'id': 'cfg-1',
        'name': 'GT06N · ตั้งค่ามาตรฐาน',
        'deviceModel': 'GT06N',
        'protocol': 'TCP',
        'status': 'testing',
        'fields': {'APN1': 'internet'},
      });
      expect(draft.name, 'GT06N · ตั้งค่ามาตรฐาน');
      expect(draft.status, ConfigStatus.testing);
      expect(draft.fields, {'APN1': 'internet'});
    });

    test('name absent -> null (tolerates older responses)', () {
      final draft = DeviceConfigDraft.fromJson({
        'id': 'cfg-1',
        'deviceModel': 'GT06N',
        'protocol': 'TCP',
      });
      expect(draft.name, isNull);
    });

    test(
      'hasDeviceOverride: true (issue #223 — GET/POST /devices/{deviceId}/config[-override])',
      () {
        final draft = DeviceConfigDraft.fromJson({
          'id': 'cfg-1',
          'deviceModel': 'GT06N',
          'protocol': 'TCP',
          'hasDeviceOverride': true,
        });
        expect(draft.hasDeviceOverride, isTrue);
      },
    );

    test(
      'hasDeviceOverride ไม่มีใน response (เช่น listConfigs) -> default false',
      () {
        final draft = DeviceConfigDraft.fromJson({
          'id': 'cfg-1',
          'deviceModel': 'GT06N',
          'protocol': 'TCP',
        });
        expect(draft.hasDeviceOverride, isFalse);
      },
    );

    test(
      'pendingOverride parse ครบ (มติ 2026-09-24, PR #225 — GET /devices/{deviceId}/config)',
      () {
        final draft = DeviceConfigDraft.fromJson({
          'id': 'cfg-1',
          'deviceModel': 'GT06N',
          'protocol': 'TCP',
          'hasDeviceOverride': false,
          'pendingOverride': {
            'id': 'ov-1',
            'deviceId': 'DEV-0117',
            'configId': 'cfg-1',
            'versionNumber': 1,
            'fields': {'APN': 'new-apn'},
            'reason': 'ลูกค้าขอเปลี่ยนค่าหน้างาน',
            'status': 'pending',
            'overriddenBy': 'st-1',
            'overriddenAt': '2026-09-24T00:00:00.000Z',
          },
        });
        expect(draft.pendingOverride, isNotNull);
        expect(draft.pendingOverride!.status, 'pending');
        expect(draft.pendingOverride!.isPending, isTrue);
        expect(draft.pendingOverride!.fields['APN'], 'new-apn');
      },
    );

    test('pendingOverride ไม่มีใน response -> null', () {
      final draft = DeviceConfigDraft.fromJson({
        'id': 'cfg-1',
        'deviceModel': 'GT06N',
        'protocol': 'TCP',
      });
      expect(draft.pendingOverride, isNull);
    });
  });

  group('DeviceLifecycleStatus', () {
    test('wire names match openapi.yaml / Prisma DeviceLifecycleStatus', () {
      expect(DeviceLifecycleStatus.values.map((s) => s.wireName).toList(), [
        'registered',
        'installed',
        'decommissioned',
      ]);
    });

    test('fromWire maps known values and rejects unknown', () {
      expect(
        DeviceLifecycleStatus.fromWire('installed'),
        DeviceLifecycleStatus.installed,
      );
      expect(
        () => DeviceLifecycleStatus.fromWire('retired'),
        throwsArgumentError,
      );
    });
  });

  group('DeviceStatus / DeviceCentral (issue #386)', () {
    test('DeviceStatus อ่าน online/lastSeenAt · ไม่มี field -> false/null', () {
      final s = DeviceStatus.fromJson({
        'deviceId': 'BOX-0001',
        'configStatus': 'up_to_date',
        'firmwareStatus': 'unknown',
        'online': true,
        'lastSeenAt': '2026-10-26T10:07:10.638Z',
      });
      expect(s.online, isTrue);
      expect(s.lastSeenAt, DateTime.utc(2026, 10, 26, 10, 7, 10, 638));

      final old = DeviceStatus.fromJson({'deviceId': 'X'});
      expect(old.online, isFalse);
      expect(old.lastSeenAt, isNull);
    });

    test('DeviceCentral อ่าน device · device null / unreachable', () {
      final c = DeviceCentral.fromJson({
        'mode': 'real',
        'reachable': true,
        'error': null,
        'fetchedAt': '2026-10-26T10:07:14.120Z',
        'device': {
          'deviceId': 'BOX-0001',
          'online': true,
          'lastSeenAt': '2026-10-26T10:07:10.638Z',
          'reportedFirmwareVersion': '1.2.0',
          'reportedConfigVersion': 12,
          'registered': true,
        },
      });
      expect(c.reachable, isTrue);
      expect(c.device!.online, isTrue);
      expect(c.device!.reportedFirmwareVersion, '1.2.0');
      expect(c.device!.reportedConfigVersion, 12);

      final none = DeviceCentral.fromJson({'reachable': false, 'device': null});
      expect(none.reachable, isFalse);
      expect(none.device, isNull);
    });
  });

  group('Device.fromJson', () {
    test('parses all fields incl. nullable installedAt', () {
      final device = Device.fromJson({
        'id': 'uuid-1',
        'deviceId': 'DEV-0117',
        'simNumber': '0812345678',
        'deviceModel': 'GT06N',
        'protocol': 'TCP',
        'status': 'installed',
        'registeredAt': '2026-06-01T00:00:00.000Z',
        'installedAt': '2026-06-03T00:00:00.000Z',
      });
      expect(device.id, 'uuid-1');
      expect(device.deviceId, 'DEV-0117');
      expect(device.simNumber, '0812345678');
      expect(device.status, DeviceLifecycleStatus.installed);
      expect(device.installedAt, isNotNull);
    });

    test('installedAt null -> null (not-yet-installed device)', () {
      final device = Device.fromJson({
        'id': 'uuid-2',
        'deviceId': 'DEV-0092',
        'simNumber': '0899999999',
        'deviceModel': 'GT06L',
        'protocol': 'TCP',
        'status': 'registered',
        'registeredAt': '2026-08-20T00:00:00.000Z',
        'installedAt': null,
      });
      expect(device.installedAt, isNull);
      expect(device.status, DeviceLifecycleStatus.registered);
    });

    test('parses imei/serialNumber/blackboxId + nested customer', () {
      final device = Device.fromJson({
        'id': 'uuid-4',
        'deviceId': 'DEV-0101',
        'simNumber': '0812345678',
        'deviceModel': 'GT06N',
        'protocol': 'TCP',
        'status': 'installed',
        'registeredAt': '2026-06-01T00:00:00.000Z',
        'imei': '860000000000101',
        'serialNumber': 'SNGT06N000101',
        'blackboxId': '7100000101',
        'customer': {'id': 'c1', 'companyName': 'ขนส่งสมมติ จำกัด'},
      });
      expect(device.imei, '860000000000101');
      expect(device.serialNumber, 'SNGT06N000101');
      expect(device.blackboxId, '7100000101');
      expect(device.customer?.companyName, 'ขนส่งสมมติ จำกัด');
    });

    test('identity fields + customer null or missing -> null (no throw)', () {
      final device = Device.fromJson({
        'id': 'uuid-5',
        'deviceId': 'DEV-0001',
        'simNumber': '0810000001',
        'deviceModel': 'GT06N',
        'protocol': 'TCP',
        'status': 'installed',
        'registeredAt': '2026-06-01T00:00:00.000Z',
        'imei': null,
        'customer': null,
      });
      expect(device.imei, isNull);
      expect(device.serialNumber, isNull);
      expect(device.blackboxId, isNull);
      expect(device.customer, isNull);
    });

    test('unknown status -> throws (contract drift is loud)', () {
      expect(
        () => Device.fromJson({
          'id': 'uuid-3',
          'deviceId': 'DEV-3',
          'simNumber': '0800000000',
          'deviceModel': 'X',
          'protocol': 'TCP',
          'status': 'exploded',
          'registeredAt': '2026-06-01T00:00:00.000Z',
        }),
        throwsArgumentError,
      );
    });
  });

  group('IncidentSeverity / IncidentStatus', () {
    test(
      'severity wire names match openapi.yaml / Prisma IncidentSeverity',
      () {
        expect(IncidentSeverity.values.map((s) => s.wireName).toList(), [
          'critical',
          'high',
          'medium',
          'low',
        ]);
      },
    );

    test('status wire names match openapi.yaml / Prisma IncidentStatus', () {
      expect(IncidentStatus.values.map((s) => s.wireName).toList(), [
        'open',
        'investigating',
        'rolled_back',
        'resolved',
        'dismissed',
      ]);
    });

    test('fromWire maps known values and rejects unknown', () {
      expect(IncidentSeverity.fromWire('critical'), IncidentSeverity.critical);
      expect(IncidentStatus.fromWire('rolled_back'), IncidentStatus.rolledBack);
      expect(() => IncidentSeverity.fromWire('urgent'), throwsArgumentError);
      expect(() => IncidentStatus.fromWire('closed'), throwsArgumentError);
    });
  });

  group('Incident.fromJson', () {
    Map<String, dynamic> base() => {
      'id': 'inc-1',
      'title': 'เขียน Config ไม่สำเร็จ',
      'severity': 'high',
      'status': 'open',
      'source': 'config-sync-writer',
      'metadata': {'attempts': 3},
      'createdAt': '2026-09-09T14:30:00.000Z',
      'updatedAt': '2026-09-09T14:30:00.000Z',
    };

    test('parses all fields', () {
      final incident = Incident.fromJson({
        ...base(),
        'description': 'retry 3 ครั้งแล้วยังพัง',
        'relatedConfigId': 'cfg-1',
      });
      expect(incident.id, 'inc-1');
      expect(incident.severity, IncidentSeverity.high);
      expect(incident.status, IncidentStatus.open);
      expect(incident.description, 'retry 3 ครั้งแล้วยังพัง');
      expect(incident.relatedConfigId, 'cfg-1');
      expect(incident.source, 'config-sync-writer');
      expect(incident.metadata, {'attempts': 3});
    });

    test('nullable fields absent -> null', () {
      final incident = Incident.fromJson(base());
      expect(incident.description, isNull);
      expect(incident.relatedConfigId, isNull);
      expect(incident.relatedFirmwareId, isNull);
    });

    test('unknown severity/status -> throws (contract drift is loud)', () {
      expect(
        () => Incident.fromJson({...base(), 'severity': 'boom'}),
        throwsArgumentError,
      );
      expect(
        () => Incident.fromJson({...base(), 'status': 'boom'}),
        throwsArgumentError,
      );
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
    test('docs/28: source/completedAt/autoClosed', () {
      final task = Task.fromJson({
        'id': 't1',
        'title': 'BOX-0001 — 26 ต.ค. 2569',
        'assignedTo': 'u1',
        'status': 'completed',
        'createdAt': '2026-10-26T03:00:00.000Z',
        'updatedAt': '2026-10-27T03:00:00.000Z',
        'source': 'technician',
        'completedAt': '2026-10-27T03:00:00.000Z',
        'autoClosed': true,
      });
      expect(task.source, TaskSource.technician);
      expect(task.completedAt, DateTime.utc(2026, 10, 27, 3));
      expect(task.autoClosed, isTrue);
    });

    test(
      'docs/28: ไม่มี source (backend เก่า) หรือค่าไม่รู้จัก -> operation ไม่ throw',
      () {
        Map<String, dynamic> json(Object? source) => {
          'id': 't1',
          'title': 'x',
          'assignedTo': 'u1',
          'status': 'pending',
          'createdAt': '2026-10-26T03:00:00.000Z',
          'updatedAt': '2026-10-26T03:00:00.000Z',
          'source': ?source,
        };
        expect(Task.fromJson(json(null)).source, TaskSource.operation);
        expect(Task.fromJson(json('campaign')).source, TaskSource.operation);
        expect(Task.fromJson(json(null)).autoClosed, isFalse);
      },
    );

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

  group('Firmware / DeviceFirmwareOverride (issue #256)', () {
    Map<String, dynamic> fwJson({
      String upload = 'stored',
      String approval = 'approved',
      List<String> models = const ['GT06N'],
    }) => {
      'id': 'fw-1',
      'version': '2.1.0',
      'deviceModelCompatibility': models,
      'uploadStatus': upload,
      'approvalStatus': approval,
      'originalFilename': 'fw.bin',
    };

    test('Firmware.fromJson + isInstallableOn ตรงเงื่อนไข 409 ของ backend', () {
      final ok = Firmware.fromJson(fwJson());
      expect(ok.version, '2.1.0');
      expect(ok.isInstallableOn('GT06N'), isTrue);
      expect(ok.isInstallableOn('TK103'), isFalse); // ไม่รองรับรุ่น
      expect(
        Firmware.fromJson(fwJson(upload: 'failed')).isInstallableOn('GT06N'),
        isFalse,
      );
      expect(
        Firmware.fromJson(
          fwJson(approval: 'pending_review'),
        ).isInstallableOn('GT06N'),
        isFalse,
      );
    });

    test('DeviceFirmwareOverride.fromJson — optional fields เป็น null ได้', () {
      final o = DeviceFirmwareOverride.fromJson({
        'id': 'fo-1',
        'deviceId': 'DEV-1',
        'firmwareId': 'fw-1',
        'versionNumber': 2,
        'reason': 'r',
        'status': 'approved',
        'overriddenBy': 'u1',
        'overriddenAt': '2026-10-06T00:00:00.000Z',
        'decidedBy': 'op-1',
        'decidedAt': '2026-10-06T01:00:00.000Z',
        'rejectReason': null,
        'consumedAt': null,
      });
      expect(o.isPending, isFalse);
      expect(o.decidedBy, 'op-1');
      expect(o.consumedAt, isNull);
    });
  });

  group('Incident field report (design issue #236)', () {
    Map<String, dynamic> base() => {
      'id': 'inc-1',
      'title': 't',
      'severity': 'medium',
      'status': 'open',
      'createdAt': '2026-10-06T00:00:00.000Z',
      'updatedAt': '2026-10-06T00:00:00.000Z',
    };

    test(
      'incident อัตโนมัติเดิม (ไม่มี field ใหม่) -> field report fields เป็น null',
      () {
        final i = Incident.fromJson(base());
        expect(i.isFieldReport, isFalse);
        expect(i.reportedBy, isNull);
        expect(i.deviceId, isNull);
        expect(i.reviewedBy, isNull);
        expect(i.reviewedAt, isNull);
        expect(i.reviewNote, isNull);
      },
    );

    test(
      'field report ที่ Operation ตัดสินใจแล้ว -> parse ครบ + dismissed',
      () {
        final i = Incident.fromJson({
          ...base(),
          'source': 'field-report',
          'status': 'dismissed',
          'reportedBy': 'st-1',
          'deviceId': 'DEV-0001',
          'reviewedBy': 'op-1',
          'reviewedAt': '2026-10-06T03:00:00.000Z',
          'reviewNote': 'ซ้ำกับรายการเดิม',
        });
        expect(i.isFieldReport, isTrue);
        expect(i.status, IncidentStatus.dismissed);
        expect(i.reportedBy, 'st-1');
        expect(i.deviceId, 'DEV-0001');
        expect(i.reviewedBy, 'op-1');
        expect(i.reviewedAt, DateTime.utc(2026, 10, 6, 3));
        expect(i.reviewNote, 'ซ้ำกับรายการเดิม');
      },
    );

    test(
      'promote -> investigating (ไม่มี promotedCampaignId — ไม่มี column ฝั่ง backend)',
      () {
        final i = Incident.fromJson({
          ...base(),
          'source': 'field-report',
          'status': 'investigating',
          'reviewNote': 'ต้องแก้ด้วย Campaign',
          // backend ไม่ส่ง field นี้ — ถ้ามีมาก็ต้องไม่ทำให้ parse พัง
          'promotedCampaignId': 'camp-1',
        });
        expect(i.status, IncidentStatus.investigating);
        expect(i.reviewNote, 'ต้องแก้ด้วย Campaign');
      },
    );

    test('IncidentStatus.fromWire รู้จัก dismissed', () {
      expect(IncidentStatus.fromWire('dismissed'), IncidentStatus.dismissed);
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
        'config_deletion_pending',
        'config_deletion_grace',
        'config_override_pending',
        'config_override_approved',
        'config_override_rejected',
        'firmware_override_pending',
        'firmware_override_approved',
        'firmware_override_rejected',
        'incident_report_pending',
        'incident_report_resolved',
        'incident_report_dismissed',
        'incident_report_promoted',
        'config_apply_pending',
        'config_apply_approved',
        'config_apply_rejected',
        'config_apply_succeeded',
        'config_apply_failed',
        'config_apply_expired',
      ]);
    });

    // issue #256 — Per-device Firmware Override (PR #257): ต้อง parse ได้จริง
    // ไม่ให้ `_wrapListLenient` ข้ามเงียบๆ
    // issue #236 (PR #267) — Field Incident Report: ชื่อตาม backend จริง
    test(
      'fromWire maps incident_report_* ใหม่ทั้ง 4 ค่า และไม่ชน incident_alert',
      () {
        expect(
          NotificationType.fromWire('incident_report_pending'),
          NotificationType.incidentReportPending,
        );
        expect(
          NotificationType.fromWire('incident_report_resolved'),
          NotificationType.incidentReportResolved,
        );
        expect(
          NotificationType.fromWire('incident_report_dismissed'),
          NotificationType.incidentReportDismissed,
        );
        expect(
          NotificationType.fromWire('incident_report_promoted'),
          NotificationType.incidentReportPromoted,
        );
        expect(
          NotificationType.fromWire('incident_alert'),
          NotificationType.incidentAlert,
        );
        // ชื่อที่เคยเสนอไว้ก่อนหน้า (ไม่ได้ใช้จริง) ต้องยังไม่รู้จัก
        expect(
          () => NotificationType.fromWire('incident_resolved'),
          throwsArgumentError,
        );
      },
    );

    test(
      'AppNotification.fromJson parse incident_report_* ได้ (deviceId null ได้)',
      () {
        final n = AppNotification.fromJson({
          'id': 'n1',
          'userId': 'u1',
          'type': 'incident_report_resolved',
          'payload': {
            'incidentId': 'i1',
            'deviceId': null,
            'reviewNote': 'แก้แล้ว',
          },
          'read': false,
          'createdAt': '2026-10-06T00:00:00.000Z',
        });
        expect(n.type, NotificationType.incidentReportResolved);
      },
    );

    test('fromWire maps firmware_override_* ใหม่ทั้ง 3 ค่า', () {
      expect(
        NotificationType.fromWire('firmware_override_pending'),
        NotificationType.firmwareOverridePending,
      );
      expect(
        NotificationType.fromWire('firmware_override_approved'),
        NotificationType.firmwareOverrideApproved,
      );
      expect(
        NotificationType.fromWire('firmware_override_rejected'),
        NotificationType.firmwareOverrideRejected,
      );
    });

    test(
      'AppNotification.fromJson parse firmware_override_* ได้ ไม่ throw',
      () {
        final n = AppNotification.fromJson({
          'id': 'n1',
          'userId': 'u1',
          'type': 'firmware_override_rejected',
          'payload': {
            'overrideId': 'o1',
            'deviceId': 'DEV-1',
            'firmwareId': 'fw-1',
            'rejectReason': 'ไม่เหมาะ',
          },
          'read': false,
          'createdAt': '2026-10-06T00:00:00.000Z',
        });
        expect(n.type, NotificationType.firmwareOverrideRejected);
      },
    );

    test('fromWire maps known values and rejects unknown', () {
      expect(
        NotificationType.fromWire('firmware_ready'),
        NotificationType.firmwareReady,
      );
      expect(() => NotificationType.fromWire('nope'), throwsArgumentError);
    });

    // issue #226 — Per-device Config Override (issue #223)
    test('fromWire maps config_override_* ใหม่ทั้ง 3 ค่า', () {
      expect(
        NotificationType.fromWire('config_override_pending'),
        NotificationType.configOverridePending,
      );
      expect(
        NotificationType.fromWire('config_override_approved'),
        NotificationType.configOverrideApproved,
      );
      expect(
        NotificationType.fromWire('config_override_rejected'),
        NotificationType.configOverrideRejected,
      );
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

    test(
      'createdAt หาย -> throw ArgumentError (ไม่ fallback เป็น DateTime.now() '
      'เงียบๆ — issue #82 ข้อ 2, backend เรียง createdAt desc มาแล้ว ค่าปลอม '
      'จะทำให้ลำดับรายการเพี้ยน)',
      () {
        expect(
          () => AppNotification.fromJson({
            'id': 'noti-4',
            'userId': 'u1',
            'type': 'task_assigned',
            'payload': const {},
            'read': false,
          }),
          throwsArgumentError,
        );
      },
    );

    test(
      'createdAt parse ไม่ได้ (ไม่ใช่ ISO date string) -> throw ArgumentError',
      () {
        expect(
          () => AppNotification.fromJson({
            'id': 'noti-5',
            'userId': 'u1',
            'type': 'task_assigned',
            'payload': const {},
            'read': false,
            'createdAt': 'not-a-date',
          }),
          throwsArgumentError,
        );
      },
    );

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

  group('ConfigFieldDefinition.fromJson (issue #211 Phase 2)', () {
    test('parses ครบทุก field รวม supportedModels', () {
      final def = ConfigFieldDefinition.fromJson({
        'id': 'def-1',
        'fieldName': 'APN',
        'dataType': 'string',
        'allowedValues': <String>[],
        'required': true,
        'unknownSpec': false,
        'description': 'จุดเข้าถึงเครือข่าย',
        'unit': null,
        'stOverridable': true,
        'category': 'Network',
        'sensitive': false,
        'restartRequired': true,
        'defaultValue': 'internet',
        'supportedModels': [
          {'deviceModel': 'GT06N', 'protocol': 'TCP'},
          {'deviceModel': 'GT06L', 'protocol': 'TCP'},
        ],
        'createdAt': '2026-09-01T00:00:00.000Z',
        'updatedAt': '2026-09-01T00:00:00.000Z',
      });

      expect(def.id, 'def-1');
      expect(def.fieldName, 'APN');
      expect(def.dataType, 'string');
      expect(def.required, isTrue);
      expect(def.stOverridable, isTrue);
      expect(def.sensitive, isFalse);
      expect(def.category, 'Network');
      expect(def.defaultValue, 'internet');
      expect(def.supportedModels, hasLength(2));
      expect(def.supportedModels.first.deviceModel, 'GT06N');
      expect(def.supportedModels.first.protocol, 'TCP');
    });

    test(
      'stOverridable/sensitive หายจาก response -> default false (field เก่าที่ '
      'ยังไม่มีค่านี้)',
      () {
        final def = ConfigFieldDefinition.fromJson({
          'id': 'def-2',
          'fieldName': 'REPORT_INTERVAL_MOVING',
          'dataType': 'integer',
          'required': false,
          'supportedModels': <Map<String, dynamic>>[],
        });

        expect(def.stOverridable, isFalse);
        expect(def.sensitive, isFalse);
        expect(def.allowedValues, isEmpty);
        expect(def.supportedModels, isEmpty);
      },
    );

    test('allowedValues -> list ของ string', () {
      final def = ConfigFieldDefinition.fromJson({
        'id': 'def-3',
        'fieldName': 'PROTOCOL_MODE',
        'dataType': 'string',
        'allowedValues': ['TCP', 'UDP'],
        'required': false,
        'supportedModels': <Map<String, dynamic>>[],
      });

      expect(def.allowedValues, ['TCP', 'UDP']);
    });
  });
}

void _deviceStatusTests() {
  group('DeviceStatus.fromJson', () {
    test(
      'parses every enum value (spec: up_to_date/pending/failed/unknown)',
      () {
        const wire = {
          'up_to_date': DevicePayloadStatus.upToDate,
          'pending': DevicePayloadStatus.pending,
          'failed': DevicePayloadStatus.failed,
          'unknown': DevicePayloadStatus.unknown,
        };
        for (final entry in wire.entries) {
          final status = DeviceStatus.fromJson({
            'deviceId': 'DEV-1',
            'configStatus': entry.key,
            'firmwareStatus': entry.key,
            'lastCheckInMessage': 'msg',
          });
          expect(status.configStatus, entry.value, reason: entry.key);
          expect(status.firmwareStatus, entry.value, reason: entry.key);
          expect(status.lastCheckInMessage, 'msg');
        }
      },
    );

    test('unrecognised / missing value falls back to unknown', () {
      expect(
        DevicePayloadStatus.fromWire('weird'),
        DevicePayloadStatus.unknown,
      );
      // pending_update is Firmware.deviceUpdateStatus's value, not this enum's
      expect(
        DevicePayloadStatus.fromWire('pending_update'),
        DevicePayloadStatus.unknown,
      );
      expect(DevicePayloadStatus.fromWire(null), DevicePayloadStatus.unknown);
    });

    test('lastCheckInMessage null stays null', () {
      final status = DeviceStatus.fromJson({
        'deviceId': 'DEV-1',
        'configStatus': 'unknown',
        'firmwareStatus': 'unknown',
        'lastCheckInMessage': null,
      });
      expect(status.lastCheckInMessage, isNull);
    });

    // issue #256 - pendingFirmwareOverride (PR #257, openapi v3.45)
    test('pendingFirmwareOverride: null / ไม่มี field -> null', () {
      final base = {
        'deviceId': 'DEV-1',
        'configStatus': 'unknown',
        'firmwareStatus': 'unknown',
      };
      expect(
        DeviceStatus.fromJson({
          ...base,
          'pendingFirmwareOverride': null,
        }).pendingFirmwareOverride,
        isNull,
      );
      expect(DeviceStatus.fromJson(base).pendingFirmwareOverride, isNull);
    });

    test('pendingFirmwareOverride: มีแถว pending -> parse เป็น model', () {
      final status = DeviceStatus.fromJson({
        'deviceId': 'DEV-1',
        'configStatus': 'unknown',
        'firmwareStatus': 'unknown',
        'pendingFirmwareOverride': {
          'id': 'fo-1',
          'deviceId': 'DEV-1',
          'firmwareId': 'fw-1',
          'versionNumber': 1,
          'reason': 'ลูกค้าขอ',
          'status': 'pending',
          'overriddenBy': 'st-1',
          'overriddenAt': '2026-10-06T00:00:00.000Z',
          'decidedBy': null,
          'decidedAt': null,
          'rejectReason': null,
          'consumedAt': null,
        },
      });
      expect(status.pendingFirmwareOverride?.isPending, isTrue);
      expect(status.pendingFirmwareOverride?.reason, 'ลูกค้าขอ');
    });
  });

  // docs/25 — คำขอส่ง Config เข้าเครื่อง
  group('ConfigApplyRequestStatus', () {
    test('wire names match openapi.yaml / Prisma ConfigApplyRequestStatus', () {
      expect(ConfigApplyRequestStatus.values.map((s) => s.wireName).toList(), [
        'pending',
        'approved',
        'sending',
        'succeeded',
        'failed',
        'skipped_offline',
        'rejected',
        'cancelled',
        'expired',
      ]);
    });

    test('ขอใหม่ได้เฉพาะคำขอที่จบแบบไม่สำเร็จ (docs/25 §3.3)', () {
      expect(
        ConfigApplyRequestStatus.values
            .where((s) => s.allowsNewRequest)
            .map((s) => s.wireName),
        ['failed', 'skipped_offline', 'rejected', 'cancelled', 'expired'],
      );
    });

    test('fromJson parses dates + optional fields', () {
      final request = ConfigApplyRequest.fromJson({
        'id': 'car-1',
        'taskId': 't1',
        'deviceId': 'BOX-0001',
        'configId': 'cfg-1',
        'status': 'rejected',
        'requestedAt': '2026-10-22T03:00:00.000Z',
        'expiresAt': '2026-10-23T03:00:00.000Z',
        'decidedAt': '2026-10-22T04:00:00.000Z',
        'completedAt': null,
        'rejectReason': 'APN ผิด',
      });
      expect(request.status, ConfigApplyRequestStatus.rejected);
      expect(request.decidedAt, DateTime.utc(2026, 10, 22, 4));
      expect(request.completedAt, isNull);
      expect(request.rejectReason, 'APN ผิด');
      expect(
        () => ConfigApplyRequestStatus.fromWire('teleported'),
        throwsArgumentError,
      );
    });
  });

  group('DeviceApplyOptions.fromJson (docs/28 §5.2)', () {
    test('แปลง configs ครบ', () {
      final options = DeviceApplyOptions.fromJson({
        'deviceId': 'BOX-0001',
        'deviceInstalled': true,
        'configs': [
          {
            'id': 'cfg-1',
            'name': 'มาตรฐาน',
            'status': 'approved',
            'latestVersion': 12,
            'suggested': true,
          },
        ],
      });
      expect(options.deviceId, 'BOX-0001');
      expect(options.deviceInstalled, isTrue);
      expect(options.configs.single.id, 'cfg-1');
      expect(options.configs.single.latestVersion, 12);
      expect(options.configs.single.suggested, isTrue);
    });
  });

  group('คำขอส่งเข้ากล่อง Firmware (docs/27 B3, v3.62)', () {
    Map<String, dynamic> base() => {
      'id': 'car-1',
      'taskId': 't1',
      'deviceId': 'BOX-0001',
      'status': 'approved',
      'requestedAt': '2026-10-27T03:00:00.000Z',
      'expiresAt': '2026-10-28T03:00:00.000Z',
    };

    test(
      'อ่าน kind/firmware/fromFirmwareVersion/isDowngrade · configId null ได้',
      () {
        final r = ConfigApplyRequest.fromJson({
          ...base(),
          'kind': 'firmware',
          'configId': null,
          'firmwareId': 'fw-1',
          'firmware': {'id': 'fw-1', 'version': '1.0.0'},
          'fromFirmwareVersion': '1.2.0',
          'isDowngrade': true,
        });

        expect(r.kind, FieldApplyKind.firmware);
        expect(r.configId, isNull);
        expect(r.firmwareId, 'fw-1');
        expect(r.firmwareVersion, '1.0.0');
        expect(r.fromFirmwareVersion, '1.2.0');
        expect(r.isDowngrade, isTrue);
      },
    );

    test(
      'backend ก่อน v3.62 (ไม่มี kind) / ค่า kind ไม่รู้จัก -> config ไม่ throw',
      () {
        final old = ConfigApplyRequest.fromJson({
          ...base(),
          'configId': 'cfg-1',
        });
        expect(old.kind, FieldApplyKind.config);
        expect(old.configId, 'cfg-1');
        expect(old.isDowngrade, isFalse);
        expect(FieldApplyKind.fromWire('something-new'), FieldApplyKind.config);
      },
    );

    test(
      'DeviceApplyOptions อ่านรายการ Firmware · backend เก่าไม่ส่ง = ว่าง',
      () {
        final options = DeviceApplyOptions.fromJson({
          'deviceId': 'BOX-0001',
          'deviceInstalled': true,
          'configs': <dynamic>[],
          'currentFirmwareVersion': '1.2.0',
          'firmwares': [
            {
              'id': 'fw-1',
              'version': '1.0.0',
              'isCurrent': false,
              'isDowngrade': true,
            },
          ],
        });
        expect(options.currentFirmwareVersion, '1.2.0');
        expect(options.firmwares.single.isDowngrade, isTrue);

        final old = DeviceApplyOptions.fromJson({
          'deviceId': 'BOX-0001',
          'deviceInstalled': true,
          'configs': <dynamic>[],
        });
        expect(old.firmwares, isEmpty);
        expect(old.currentFirmwareVersion, isNull);
      },
    );
  });

  test(
    'DeviceApplyOptions.openRequest (v3.66) · backend เก่าไม่ส่ง = null',
    () {
      final options = DeviceApplyOptions.fromJson({
        'deviceId': 'BOX-0001',
        'deviceInstalled': true,
        'configs': <dynamic>[],
        'openRequest': {
          'kind': 'firmware',
          'status': 'approved',
          'configName': null,
          'firmwareVersion': '1.0.0',
          'taskId': 't1',
        },
      });
      final open = options.openRequest!;
      expect(open.kind, FieldApplyKind.firmware);
      expect(open.status, ConfigApplyRequestStatus.approved);
      expect(open.firmwareVersion, '1.0.0');
      expect(open.taskId, 't1');

      final old = DeviceApplyOptions.fromJson({
        'deviceId': 'BOX-0001',
        'deviceInstalled': true,
        'configs': <dynamic>[],
      });
      expect(old.openRequest, isNull);
    },
  );

  test(
    'Task.assignee (v3.67 TaskDetail) · endpoint อื่น / backend เก่า = null',
    () {
      final base = {
        'id': 't1',
        'title': 'งาน',
        'assignedTo': 'u1',
        'status': 'pending',
        'createdAt': '2026-10-27T00:00:00.000Z',
        'updatedAt': '2026-10-27T00:00:00.000Z',
      };
      final withName = Task.fromJson({
        ...base,
        'assignee': {'username': 'st.test', 'fullName': 'ช่าง ทดสอบ'},
      });
      expect(withName.assignee!.label, 'ช่าง ทดสอบ (st.test)');
      expect(
        const TaskAssignee(username: 'st.test', fullName: '').label,
        'st.test',
      );
      expect(Task.fromJson({...base, 'assignee': null}).assignee, isNull);
      expect(Task.fromJson(base).assignee, isNull);
    },
  );
}
