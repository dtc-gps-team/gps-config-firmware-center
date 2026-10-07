import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart'; // apiClientProvider
import '../config/app_config.dart';
import '../db/app_database.dart';
import '../db/providers/database_provider.dart';
import '../db/tables/pending_actions_table.dart';
import 'sync_queue_service.dart';

final pendingActionDaoProvider = Provider(
  (ref) => ref.watch(appDatabaseProvider).pendingActionDao,
);

/// Bumped whenever a flush changed the queue or the cache. Providers that
/// show synced data watch it to refresh (kept as a plain counter so `core/sync`
/// doesn't depend on any feature).
final syncRevisionProvider = StateProvider<int>((ref) => 0);

final syncQueueServiceProvider = Provider<SyncQueueService>((ref) {
  final service = SyncQueueService(
    ref.watch(apiClientProvider),
    ref.watch(pendingActionDaoProvider),
    ref.watch(taskDaoProvider),
  );
  // A flush changed the cache/queue → bump the revision so the providers
  // that watch it (task list / detail) re-read.
  service.onChanged = () => ref.read(syncRevisionProvider.notifier).state++;
  ref.onDispose(() => service.onChanged = null);
  return service;
});

/// Ids of tasks that have a change waiting in the queue — drives the
/// "รอซิงค์" badge. Empty (and no DB access) in `API_MOCK_MODE`.
final pendingTaskIdsProvider = StreamProvider<Set<String>>((ref) {
  if (AppConfig.apiMockMode) return Stream.value(const <String>{});
  return ref
      .watch(pendingActionDaoProvider)
      .watchPending()
      .map(
        (rows) => {
          for (final r in rows)
            if (r.type == PendingActionType.taskStatus.wireName) r.entityId,
        },
      );
});

/// Actions the server rejected (4xx) — shown to the user until dismissed.
final failedSyncActionsProvider = StreamProvider<List<PendingActionRow>>((ref) {
  if (AppConfig.apiMockMode) return Stream.value(const <PendingActionRow>[]);
  return ref.watch(pendingActionDaoProvider).watchFailed();
});

/// Starts the flush triggers: app resume and connectivity coming back.
/// Read once from the app root; disposed with the container.
final syncTriggersProvider = Provider<SyncTriggers>((ref) {
  final triggers = SyncTriggers(
    onTrigger: () => ref.read(syncQueueServiceProvider).flush(),
  );
  if (!AppConfig.apiMockMode) triggers.start();
  ref.onDispose(triggers.stop);
  return triggers;
});

class SyncTriggers with WidgetsBindingObserver {
  SyncTriggers({required this.onTrigger, this.connectivity});

  final void Function() onTrigger;

  /// Injectable for tests; defaults to the platform connectivity stream.
  final Stream<List<ConnectivityResult>>? connectivity;
  StreamSubscription<List<ConnectivityResult>>? _sub;
  bool _wasOffline = false;

  void start() {
    WidgetsBinding.instance.addObserver(this);
    _sub = (connectivity ?? Connectivity().onConnectivityChanged).listen((
      results,
    ) {
      final offline =
          results.isEmpty || results.every((r) => r == ConnectivityResult.none);
      if (_wasOffline && !offline) onTrigger();
      _wasOffline = offline;
    });
    // Anything left over from the previous run goes out right away.
    onTrigger();
  }

  void stop() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_sub?.cancel());
    _sub = null;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) onTrigger();
  }
}
