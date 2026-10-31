import 'dart:async';

import 'package:flutter/widgets.dart';

/// Coordinates foreground, authenticated polling registrations for visible
/// pages. Each registration owns at most one timer and one in-flight refresh.
class RealtimeController with WidgetsBindingObserver {
  RealtimeController({required this.mockMode});

  final bool mockMode;
  final Set<LiveRefreshRegistration> _registrations = {};
  bool _started = false;
  bool _disposed = false;
  bool _authenticated = false;
  bool _foreground = true;

  bool get _enabled => !_disposed && !mockMode && _authenticated && _foreground;

  void start() {
    if (_started || _disposed) return;
    _started = true;
    WidgetsBinding.instance.addObserver(this);
  }

  void setAuthenticated(bool authenticated) {
    if (_authenticated == authenticated || _disposed) return;
    _authenticated = authenticated;
    _reconcileTimers();
  }

  LiveRefreshRegistration register({
    required Duration interval,
    required FutureOr<void> Function() refresh,
    bool active = true,
  }) {
    if (interval <= Duration.zero) {
      throw ArgumentError.value(interval, 'interval', 'must be positive');
    }
    final registration = LiveRefreshRegistration._(
      this,
      interval: interval,
      refresh: refresh,
      active: active,
    );
    _registrations.add(registration);
    _reconcile(registration);
    return registration;
  }

  /// Called by the sync trigger after its queued writes have flushed.
  void refreshActive() {
    if (!_enabled) return;
    for (final registration in List<LiveRefreshRegistration>.of(
      _registrations,
    )) {
      if (registration.active) _refresh(registration);
    }
  }

  void _refresh(LiveRefreshRegistration registration) {
    if (!_enabled || !registration.active || registration._running) return;
    registration._running = true;
    Future<void>.sync(registration.refresh)
        .catchError((Object _) {})
        .whenComplete(() => registration._running = false);
  }

  void _reconcileTimers() {
    for (final registration in _registrations) {
      _reconcile(registration);
    }
  }

  void _reconcile(LiveRefreshRegistration registration) {
    final shouldRun = _enabled && registration.active;
    if (!shouldRun) {
      registration._timer?.cancel();
      registration._timer = null;
      return;
    }
    if (registration._timer != null) return;
    registration._timer = Timer.periodic(
      registration.interval,
      (_) => _refresh(registration),
    );
  }

  void _remove(LiveRefreshRegistration registration) {
    registration._timer?.cancel();
    registration._timer = null;
    _registrations.remove(registration);
  }

  void _refreshRegistration(LiveRefreshRegistration registration) {
    _refresh(registration);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final foreground = state == AppLifecycleState.resumed;
    if (_foreground == foreground || _disposed) return;
    _foreground = foreground;
    _reconcileTimers();
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    if (_started) WidgetsBinding.instance.removeObserver(this);
    for (final registration in List<LiveRefreshRegistration>.of(
      _registrations,
    )) {
      _remove(registration);
    }
  }
}

class LiveRefreshRegistration {
  LiveRefreshRegistration._(
    this._owner, {
    required this.interval,
    required this.refresh,
    required this.active,
  });

  final RealtimeController _owner;
  Duration interval;
  FutureOr<void> Function() refresh;
  bool active;
  Timer? _timer;
  bool _running = false;
  bool _disposed = false;

  void update({
    Duration? interval,
    FutureOr<void> Function()? refresh,
    bool? active,
    bool refreshImmediately = true,
  }) {
    if (_disposed) return;
    final wasActive = this.active;
    final changedInterval = interval != null && interval != this.interval;
    if (interval != null) {
      if (interval <= Duration.zero) {
        throw ArgumentError.value(interval, 'interval', 'must be positive');
      }
      this.interval = interval;
    }
    if (refresh != null) this.refresh = refresh;
    if (active != null) this.active = active;
    if (changedInterval) {
      _timer?.cancel();
      _timer = null;
    }
    _owner._reconcile(this);
    if (!wasActive && this.active && refreshImmediately) {
      _owner._refreshRegistration(this);
    }
  }

  void setActive(bool active, {bool refreshImmediately = true}) =>
      update(active: active, refreshImmediately: refreshImmediately);

  void refreshNow() => _owner._refreshRegistration(this);

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _owner._remove(this);
  }
}
