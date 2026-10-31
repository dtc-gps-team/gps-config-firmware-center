import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'realtime_controller.dart';
import '../sync/sync_providers.dart';

/// Registers refresh work only while this page is active, foregrounded and
/// authenticated. The child stays mounted while Riverpod refreshes its data.
class LiveRefresh extends ConsumerStatefulWidget {
  const LiveRefresh({
    super.key,
    required this.interval,
    required this.onRefresh,
    required this.child,
    this.active = true,
    this.tabIndex,
  });

  final Duration interval;
  final Future<void> Function() onRefresh;
  final Widget child;
  final bool active;
  final int? tabIndex;

  @override
  ConsumerState<LiveRefresh> createState() => _LiveRefreshState();
}

class _LiveRefreshState extends ConsumerState<LiveRefresh> with RouteAware {
  late final LiveRefreshRegistration _registration;
  PageRoute<dynamic>? _observedRoute;
  bool _routeVisible = true;

  @override
  void initState() {
    super.initState();
    _registration = ref
        .read(realtimeControllerProvider)
        .register(
          interval: widget.interval,
          refresh: widget.onRefresh,
          active: widget.active && _tabIsActive && _routeVisible,
        );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route is PageRoute<dynamic> && route != _observedRoute) {
      if (_observedRoute != null) mobileRouteObserver.unsubscribe(this);
      _observedRoute = route;
      _routeVisible = route.isCurrent;
      mobileRouteObserver.subscribe(this, route);
      _registration.setActive(widget.active && _tabIsActive && _routeVisible);
    }
  }

  @override
  void didPushNext() => _setRouteVisible(false);

  @override
  void didPopNext() {
    _setRouteVisible(true);
    _registration.refreshNow();
  }

  void _setRouteVisible(bool visible) {
    _routeVisible = visible;
    _registration.setActive(widget.active && _tabIsActive && visible);
  }

  bool get _tabIsActive =>
      widget.tabIndex == null ||
      ref.read(activeAppTabIndexProvider) == widget.tabIndex;

  @override
  void didUpdateWidget(covariant LiveRefresh oldWidget) {
    super.didUpdateWidget(oldWidget);
    _registration.update(
      interval: widget.interval,
      refresh: widget.onRefresh,
      active: widget.active && _tabIsActive && _routeVisible,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.tabIndex != null) {
      ref.listen<int>(activeAppTabIndexProvider, (_, activeTab) {
        _registration.setActive(
          widget.active && activeTab == widget.tabIndex && _routeVisible,
        );
      });
    }
    return widget.child;
  }

  @override
  void dispose() {
    mobileRouteObserver.unsubscribe(this);
    _registration.dispose();
    super.dispose();
  }
}
