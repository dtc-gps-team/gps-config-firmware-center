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

/// True while queued changes are stuck on an expired session (401). Mobile has
/// no re-login that keeps the queue, so the UI warns that signing out drops
/// them.
final syncAuthExpiredProvider = StateProvider<bool>((ref) => false);

final syncQueueServiceProvider = Provider<SyncQueueService>((ref) {
  final service = SyncQueueService(
    ref.watch(apiClientProvider),
    ref.watch(pendingActionDaoProvider),
    ref.watch(taskDaoProvider),
  );
  // A flush changed the cache/queue → bump the revision so the providers
  // that watch it (task list / detail) re-read.
  service.onChanged = () => ref.read(syncRevisionProvider.notifier).state++;
  service.onAuthExpired = (expired) {
    final notifier = ref.read(syncAuthExpiredProvider.notifier);
    if (notifier.state != expired) notifier.state = expired;
  };
  ref.onDispose(() {
    service.onChanged = null;
    service.onAuthExpired = null;
  });
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
/// Connectivity source for [syncTriggersProvider]; null = the platform stream.
/// Exists so tests can run the provider without the plugin.
final syncConnectivityProvider = Provider<Stream<List<ConnectivityResult>>?>(
  (ref) => null,
);

final syncTriggersProvider = Provider<SyncTriggers>((ref) {
  bool signedIn() => ref.read(authControllerProvider).isAuthenticated;
  // Every trigger is gated on the session: before the token is restored (cold
  // start) a send would go out unauthenticated, get a 401 and wrongly raise
  // the "เซสชันหมดอายุ" banner while leaving the queue stuck until the next
  // resume / connectivity event.
  final triggers = SyncTriggers(
    onTrigger: () {
      if (signedIn()) ref.read(syncQueueServiceProvider).flush();
    },
    connectivity: ref.read(syncConnectivityProvider),
  );
  if (!AppConfig.apiMockMode) {
    // Leftovers from the previous run go out as soon as the session is ready:
    // right away if it already is, otherwise when restore/login completes.
    triggers.start(triggerOnStart: false);
    if (signedIn()) triggers.onTrigger();
    ref.listen(authControllerProvider, (previous, next) {
      if (next.isAuthenticated && !(previous?.isAuthenticated ?? false)) {
        triggers.onTrigger();
      }
    });
  }
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

  /// [triggerOnStart] false lets the owner decide when the first flush is safe
  /// (the session may not be restored yet).
  void start({bool triggerOnStart = true}) {
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
    if (triggerOnStart) onTrigger();
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
