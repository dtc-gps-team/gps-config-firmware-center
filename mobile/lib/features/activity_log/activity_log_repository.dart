import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import 'activity_log_entry.dart';

/// Rolling retention for the on-device activity log (`docs/10` §4 — mobile):
/// **14 days OR 300 entries, whichever comes first.** Checked + trimmed on
/// every write (no background job).
const activityLogMaxAge = Duration(days: 14);
const activityLogMaxEntries = 300;

/// Thin persistence seam over the raw JSON blob, mirroring the
/// `TokenStore` / `SessionProfileStore` shape in `core/auth/` — lets tests
/// swap in an in-memory (or throwing) implementation without the plugin.
abstract class ActivityLogStore {
  Future<String?> read();
  Future<void> write(String value);
  Future<void> delete();
}

/// Production store — `shared_preferences` (not `flutter_secure_storage`: this
/// isn't sensitive data, and a plain JSON list is enough at ≤300 entries).
class SharedPrefsActivityLogStore implements ActivityLogStore {
  static const _key = 'activity_log_v1';

  Future<SharedPreferences> get _prefs => SharedPreferences.getInstance();

  @override
  Future<String?> read() async => (await _prefs).getString(_key);

  @override
  Future<void> write(String value) async {
    await (await _prefs).setString(_key, value);
  }

  @override
  Future<void> delete() async {
    await (await _prefs).remove(_key);
  }
}

/// In-memory store for tests / `API_MOCK_MODE`.
class InMemoryActivityLogStore implements ActivityLogStore {
  InMemoryActivityLogStore([this._raw]);

  String? _raw;

  @override
  Future<String?> read() async => _raw;

  @override
  Future<void> write(String value) async => _raw = value;

  @override
  Future<void> delete() async => _raw = null;
}

/// Records + reads local read-level activity. **No method ever throws** — this
/// feature must not be able to break anything else in the app (`docs/10` §2):
/// `record` / `clear` become no-ops on failure, `list` returns `[]`.
abstract class ActivityLogRepository {
  Future<void> record({required String path, required String title});
  Future<List<ActivityLogEntry>> list({int limit});
  Future<void> clear();
}

class DefaultActivityLogRepository implements ActivityLogRepository {
  DefaultActivityLogRepository(
    this._store, {
    this.now = DateTime.now,
    this.uuid = const Uuid(),
  });

  final ActivityLogStore _store;

  /// injectable so retention pruning is testable without waiting real time
  final DateTime Function() now;
  final Uuid uuid;

  @override
  Future<void> record({required String path, required String title}) async {
    try {
      final entries = await _readAll();
      entries.add(
        ActivityLogEntry(
          id: uuid.v4(),
          type: ActivityLogType.navigation,
          at: now().toUtc(),
          detail: {'path': path, 'title': title},
        ),
      );
      await _store.write(
        jsonEncode(_prune(entries).map((e) => e.toJson()).toList()),
      );
    } catch (_) {
      // never propagate — activity log must not break navigation
    }
  }

  @override
  Future<List<ActivityLogEntry>> list({int limit = 10}) async {
    try {
      final entries = await _readAll()
        ..sort((a, b) => b.at.compareTo(a.at)); // newest first
      return entries.take(limit).toList(growable: false);
    } catch (_) {
      return const [];
    }
  }

  @override
  Future<void> clear() async {
    try {
      await _store.delete();
    } catch (_) {
      // no-op
    }
  }

  Future<List<ActivityLogEntry>> _readAll() async {
    final raw = await _store.read();
    if (raw == null || raw.isEmpty) return [];
    final decoded = jsonDecode(raw);
    if (decoded is! List) return [];
    final entries = <ActivityLogEntry>[];
    for (final item in decoded) {
      try {
        entries.add(
          ActivityLogEntry.fromJson((item as Map).cast<String, dynamic>()),
        );
      } catch (_) {
        // drop a malformed / unknown-type entry, keep the rest
      }
    }
    return entries;
  }

  /// Drop entries older than [activityLogMaxAge]; if still over
  /// [activityLogMaxEntries], keep only the most recent. Order preserved.
  List<ActivityLogEntry> _prune(List<ActivityLogEntry> entries) {
    final cutoff = now().toUtc().subtract(activityLogMaxAge);
    var kept = entries.where((e) => e.at.isAfter(cutoff)).toList();
    if (kept.length > activityLogMaxEntries) {
      kept.sort((a, b) => a.at.compareTo(b.at)); // oldest first
      kept = kept.sublist(kept.length - activityLogMaxEntries);
    }
    return kept;
  }
}

final activityLogRepositoryProvider = Provider<ActivityLogRepository>((ref) {
  return DefaultActivityLogRepository(SharedPrefsActivityLogStore());
});

/// Latest entries for the Home "กิจกรรมล่าสุด" section. `autoDispose` so
/// returning to Home re-reads the freshly recorded navigations.
final recentActivityProvider =
    FutureProvider.autoDispose<List<ActivityLogEntry>>((ref) {
      return ref.watch(activityLogRepositoryProvider).list(limit: 6);
    });
