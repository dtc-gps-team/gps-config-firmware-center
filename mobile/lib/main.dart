import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/config/app_config.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'features/push_notification/push_message_handler.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Background / terminated-state pushes are handled in a separate isolate —
  // register before runApp(). Safe to register even when push is disabled
  // (no token is ever sent, so nothing arrives).
  if (AppConfig.pushNotificationsEnabled) {
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  }
  runApp(const ProviderScope(child: GpsMobileApp()));
}

class GpsMobileApp extends ConsumerStatefulWidget {
  const GpsMobileApp({super.key});

  @override
  ConsumerState<GpsMobileApp> createState() => _GpsMobileAppState();
}

class _GpsMobileAppState extends ConsumerState<GpsMobileApp> {
  @override
  void initState() {
    super.initState();
    // Foreground / open-from-notification wiring — runs once, independent of
    // the auth flow, and guards on the feature flag internally.
    ref.read(pushMessageHandlerProvider).setup();
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'GPS Config & Firmware Center',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      routerConfig: router,
    );
  }
}
