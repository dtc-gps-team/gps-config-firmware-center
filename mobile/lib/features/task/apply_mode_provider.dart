import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';

/// ระบบส่งเข้ากล่องผ่าน Server กลางไหม (`GET /central/status` `applyMode ==
/// central`, docs/27 §5.6) — `true` = ปุ่ม "ยืนยันติดตั้ง Firmware" และ "Firmware
/// Override" แบบเดิมไม่ได้ส่งอะไรเข้ากล่องจริง ให้ใช้คำขอส่งเข้ากล่องแทน (B3)
///
/// โหลดไม่ได้/backend เก่า = `false` (แสดงปุ่มเดิมต่อ — ไม่ซ่อนจากข้อมูลที่ไม่รู้) ·
/// `API_MOCK_MODE` ไม่มี Server กลาง = `false`
final centralApplyModeProvider = FutureProvider.autoDispose<bool>((ref) async {
  if (AppConfig.apiMockMode) return false;
  try {
    final mode = await ref.watch(apiClientProvider).getApplyMode();
    return mode == 'central';
  } catch (_) {
    return false;
  }
});
