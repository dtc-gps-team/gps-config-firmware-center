import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/features/auth/login_page.dart';
import 'package:mobile/features/config_override/config_override_page.dart';
import 'package:mobile/features/config_override/config_override_repository.dart';
import 'package:mobile/features/config_simulator/config_repository.dart';
import 'package:mobile/features/config_simulator/simulator_page.dart';
import 'package:mobile/features/config_simulator/simulator_repository.dart';
import 'package:mobile/features/device_connection_test/device_connection_test_page.dart';
import 'package:mobile/features/device_connection_test/recent_device_id_store.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';
import 'package:mobile/features/device_search/device_status_repository.dart';
import 'package:mobile/features/firmware_install/confirm_firmware_install_page.dart';
import 'package:mobile/features/firmware_override/firmware_override_page.dart';
import 'package:mobile/features/firmware_override/firmware_override_repository.dart';
import 'package:mobile/features/incident/field_report_page.dart';
import 'package:mobile/features/incident/incident_repository.dart';
import 'package:mobile/features/task/task_repository.dart';

// UX audit #12 — ปุ่มหลักใน 6 หน้านี้ไม่ได้ใส่ style เอง เดิมจึงได้สีฟ้าจาก
// seed color และทรงแคปซูลของ Material ต่างจากปุ่มหลักหน้าอื่น (กรมท่า มุม 12)
// ปุ่มหลักของหน้า login คือแบบที่ตั้งใจไว้ตั้งแต่แรก ใช้เป็นตัวเทียบ

class _Auth extends AuthController {
  _Auth(this._state);
  final AuthState _state;

  @override
  AuthState build() => _state;
}

const _st = AuthState(
  status: AuthStatus.authenticated,
  role: UserRole.st,
  username: 'st.test',
);

List<Override> _overrides(AuthState auth) => [
  authControllerProvider.overrideWith(() => _Auth(auth)),
  tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
  sessionProfileStoreProvider.overrideWithValue(InMemorySessionProfileStore()),
  configOverrideRepositoryProvider.overrideWithValue(
    MockConfigOverrideRepository(),
  ),
  configRepositoryProvider.overrideWithValue(MockConfigRepository()),
  simulatorRepositoryProvider.overrideWithValue(MockSimulatorRepository()),
  deviceSearchRepositoryProvider.overrideWithValue(
    MockDeviceSearchRepository(),
  ),
  deviceStatusRepositoryProvider.overrideWithValue(
    MockDeviceStatusRepository(),
  ),
  firmwareOverrideRepositoryProvider.overrideWithValue(
    MockFirmwareOverrideRepository(),
  ),
  incidentRepositoryProvider.overrideWithValue(MockIncidentRepository()),
  taskRepositoryProvider.overrideWithValue(MockTaskRepository()),
  recentDeviceIdStoreProvider.overrideWithValue(InMemoryRecentDeviceIdStore()),
];

Future<void> _pump(
  WidgetTester tester,
  Widget page, {
  AuthState auth = _st,
}) async {
  // กว้าง 600: เทสนี้ดูแค่ style ของปุ่ม ไม่ใช่ layout ตอนจอแคบ (แถวช่องที่
  // override ไม่ได้ในหน้า Config Override ล้นด้วยฟอนต์ทดสอบที่จอแคบ — แก้ใน
  // #334 ข้อ #8 แยกต่างหาก)
  tester.view.physicalSize = const Size(600 * 3, 4000 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: _overrides(auth),
      child: MaterialApp(theme: AppTheme.light(), home: page),
    ),
  );
  // mock repository หน่วงเวลาด้วย Future.delayed — รอให้โหลดเสร็จ
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 200));
  }
}

/// style ที่มีผลจริงของปุ่ม: style ที่ใส่ที่ปุ่ม ทับค่าจาก FilledButtonTheme
ButtonStyle _effectiveStyle(WidgetTester tester, Finder button) {
  final widget = tester.widget<FilledButton>(button);
  final themeStyle = FilledButtonTheme.of(tester.element(button)).style;
  return (widget.style ?? const ButtonStyle()).merge(themeStyle);
}

class _Look {
  _Look(ButtonStyle s)
    : background = s.backgroundColor?.resolve(const {}),
      foreground = s.foregroundColor?.resolve(const {}),
      shape = s.shape?.resolve(const {});

  final Color? background;
  final Color? foreground;
  final OutlinedBorder? shape;

  @override
  String toString() => 'bg=$background fg=$foreground shape=$shape';
}

void main() {
  setUpAll(() {
    PackageInfo.setMockInitialValues(
      appName: 'mobile',
      packageName: 'com.example.mobile',
      version: '1.0.0',
      buildNumber: '1',
      buildSignature: '',
    );
  });

  testWidgets('ปุ่มหลักหน้า login (ตัวเทียบ): กรมท่า ตัวอักษรขาว มุม 12', (
    tester,
  ) async {
    await _pump(
      tester,
      const LoginPage(),
      auth: const AuthState(status: AuthStatus.unauthenticated),
    );
    final login = _Look(
      _effectiveStyle(tester, find.byKey(const Key('login_submit'))),
    );
    expect(login.background, AppTheme.navy);
    expect(login.foreground, Colors.white);
    expect(
      login.shape,
      RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    );
  });

  final pages = <String, Widget>{
    'Config Override': const ConfigOverridePage(deviceId: 'DEV-0117'),
    'ทดสอบการตั้งค่า (Simulator)': const SimulatorPage(),
    'ทดสอบสัญญาณ': const DeviceConnectionTestPage(),
    'ขอ Firmware Override': const FirmwareOverridePage(deviceId: 'DEV-0117'),
    'แจ้งปัญหา': const FieldReportPage(),
    'ยืนยันติดตั้ง Firmware': const ConfirmFirmwareInstallPage(
      deviceId: 'DEV-0117',
    ),
  };

  pages.forEach((name, page) {
    testWidgets('UX audit #12: ปุ่มหลักหน้า "$name" สี/ทรงเหมือนหน้า login', (
      tester,
    ) async {
      await _pump(tester, page);

      final button = find.byType(FilledButton);
      expect(button, findsOneWidget, reason: name);
      final look = _Look(_effectiveStyle(tester, button));
      expect(look.background, AppTheme.navy, reason: '$name: $look');
      expect(look.foreground, Colors.white, reason: '$name: $look');
      expect(
        look.shape,
        RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        reason: '$name: $look',
      );
      // สูงอย่างน้อย 48dp (กดด้วยนิ้วหน้างาน)
      expect(tester.getSize(button).height, greaterThanOrEqualTo(48));
    });
  });
}
