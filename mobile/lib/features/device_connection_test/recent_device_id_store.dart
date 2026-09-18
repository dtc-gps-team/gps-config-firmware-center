import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/config/app_config.dart';

/// Remembers the last few `deviceId`s a "ทดสอบสัญญาณ" run was attempted on
/// (whether the result was `passed` or not — the point is "a real device the
/// user tests against repeatedly", so a failing signal test still counts).
/// Newest first, capped at [maxEntries], deduped by moving an existing entry
/// to the front instead of storing it twice.
abstract class RecentDeviceIdStore {
  Future<List<String>> read();
  Future<void> add(String deviceId);
}

class SharedPreferencesRecentDeviceIdStore implements RecentDeviceIdStore {
  static const _key = 'device_connection_test_recent_ids';
  static const maxEntries = 5;

  @override
  Future<List<String>> read() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getStringList(_key) ?? const [];
  }

  @override
  Future<void> add(String deviceId) async {
    final prefs = await SharedPreferences.getInstance();
    final current = List<String>.of(prefs.getStringList(_key) ?? const []);
    current.remove(deviceId);
    current.insert(0, deviceId);
    await prefs.setStringList(
      _key,
      current.length > maxEntries ? current.sublist(0, maxEntries) : current,
    );
  }
}

/// In-memory fake for tests and `API_MOCK_MODE` — same storage pattern as
/// `TokenStore`/`SessionProfileStore` in `core/auth/token_store.dart`, kept
/// off the real plugin channel so widget tests don't need to mock it.
class InMemoryRecentDeviceIdStore implements RecentDeviceIdStore {
  InMemoryRecentDeviceIdStore([List<String>? initial])
    : _ids = List.of(initial ?? const []);

  final List<String> _ids;

  @override
  Future<List<String>> read() async => List.unmodifiable(_ids);

  @override
  Future<void> add(String deviceId) async {
    _ids.remove(deviceId);
    _ids.insert(0, deviceId);
    if (_ids.length > SharedPreferencesRecentDeviceIdStore.maxEntries) {
      _ids.removeRange(
        SharedPreferencesRecentDeviceIdStore.maxEntries,
        _ids.length,
      );
    }
  }
}

final recentDeviceIdStoreProvider = Provider<RecentDeviceIdStore>((ref) {
  return AppConfig.apiMockMode
      ? InMemoryRecentDeviceIdStore()
      : SharedPreferencesRecentDeviceIdStore();
});

/// The list the UI renders as chips. `autoDispose` + `ref.invalidate(...)`
/// after a successful test-connection call is how the chip row picks up a
/// newly-added id (same refresh pattern as `taskListProvider` elsewhere).
final recentDeviceIdsProvider = FutureProvider.autoDispose<List<String>>((ref) {
  return ref.watch(recentDeviceIdStoreProvider).read();
});
