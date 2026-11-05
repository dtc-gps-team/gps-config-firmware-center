import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'realtime_controller.dart';
import '../sync/sync_providers.dart';

/// Registers refresh work only while this page is tick-enabled, foregrounded
/// and authenticated. The child stays mounted while Riverpod refreshes data.
class LiveRefresh extends ConsumerStatefulWidget {
  const LiveRefresh({
    super.key,
    required this.interval,
    required this.onRefresh,
    required this.child,
  });

  final Duration interval;
  final Future<void> Function() onRefresh;
  final Widget child;

  @override
  ConsumerState<LiveRefresh> createState() => _LiveRefreshState();
}

class _LiveRefreshState extends ConsumerState<LiveRefresh> {
  late final LiveRefreshRegistration _registration;
  bool? _lastTickerEnabled;

  @override
  void initState() {
    super.initState();
    _registration = ref
        .read(realtimeControllerProvider)
        .register(
          interval: widget.interval,
          refresh: widget.onRefresh,
          active: false,
        );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final enabled = TickerMode.valuesOf(context).enabled;
    if (enabled == _lastTickerEnabled) return;
    final returningToVisible = _lastTickerEnabled == false && enabled;
    _lastTickerEnabled = enabled;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _registration.setActive(enabled, refreshImmediately: returningToVisible);
    });
  }

  @override
  void didUpdateWidget(covariant LiveRefresh oldWidget) {
    super.didUpdateWidget(oldWidget);
    _registration.update(interval: widget.interval, refresh: widget.onRefresh);
  }

  @override
  Widget build(BuildContext context) => widget.child;

  @override
  void dispose() {
    _registration.dispose();
    super.dispose();
  }
}
