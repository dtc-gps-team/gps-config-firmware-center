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
}
