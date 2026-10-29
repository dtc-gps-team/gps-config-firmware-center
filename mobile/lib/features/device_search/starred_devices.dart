import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/auth/auth_controller.dart';

/// อุปกรณ์ที่ติดดาวไว้ในหน้าค้นหาอุปกรณ์ — เก็บในเครื่อง (SharedPreferences) แยกตาม
/// username: ไม่ต้องค้นหาใหม่ทุกรอบ, logout แล้วยังอยู่, และคนที่ใช้มือถือเครื่อง
/// เดียวกันไม่เห็นดาวของกันและกัน · ไม่ใช่ข้อมูลบน server (ไม่ตามไปเครื่องอื่น)
abstract class StarredDeviceStore {
  Future<List<String>> load(String user);
  Future<void> save(String user, List<String> deviceIds);
}

class PrefsStarredDeviceStore implements StarredDeviceStore {
  static String _key(String user) => 'starred_device_ids:$user';

  @override
  Future<List<String>> load(String user) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getStringList(_key(user)) ?? const [];
  }

  @override
  Future<void> save(String user, List<String> deviceIds) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_key(user), deviceIds);
  }
}

final starredDeviceStoreProvider = Provider<StarredDeviceStore>(
  (ref) => PrefsStarredDeviceStore(),
);

/// เลขเครื่องที่ติดดาวของผู้ใช้ที่ login อยู่ · โหลดไม่ได้ (ไม่มี plugin ฯลฯ) = ว่าง
/// ไม่ให้หน้าค้นหาพัง
class StarredDevices extends Notifier<Set<String>> {
  String? get _user => ref.read(authControllerProvider).username;

  @override
  Set<String> build() {
    final user = ref.watch(authControllerProvider.select((s) => s.username));
    if (user != null) _load(user);
    return const {};
  }

  Future<void> _load(String user) async {
    try {
      final ids = await ref.read(starredDeviceStoreProvider).load(user);
      if (_user == user) state = {...ids, ...state};
    } catch (e) {
      debugPrint('load starred devices failed: $e');
    }
  }

  /// ติดดาว / เอาดาวออก — เปลี่ยนบนจอทันที แล้วค่อยบันทึก
  Future<void> toggle(String deviceId) async {
    final next = {...state};
    if (!next.remove(deviceId)) next.add(deviceId);
    state = next;
    final user = _user;
    if (user == null) return;
    try {
      await ref.read(starredDeviceStoreProvider).save(user, next.toList());
    } catch (e) {
      debugPrint('save starred devices failed: $e');
    }
  }
}

final starredDevicesProvider = NotifierProvider<StarredDevices, Set<String>>(
  StarredDevices.new,
);
