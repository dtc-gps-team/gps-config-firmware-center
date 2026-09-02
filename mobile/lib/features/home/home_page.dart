import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/router/app_router.dart';

class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final role = ref.watch(authControllerProvider.select((s) => s.role));

    return Scaffold(
      appBar: AppBar(
        title: const Text('หน้าหลัก'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'ออกจากระบบ',
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              role == null ? 'เข้าสู่ระบบแล้ว' : 'Role: ${role.wireName}',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: () => context.push(AppRoutes.simulator),
              icon: const Icon(Icons.play_circle_outline),
              label: const Text('Mobile Simulator Test'),
            ),
            // ทดสอบสัญญาณ — ช่างหน้างานเท่านั้น (backend บังคับ RBAC 403 ให้
            // เฉพาะ ST/OT อยู่แล้ว — ซ่อนปุ่มจาก UI เพื่อ UX ที่ดีกว่า)
            if (role == UserRole.st || role == UserRole.ot) ...[
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: () =>
                    context.push(AppRoutes.deviceConnectionTest),
                icon: const Icon(Icons.wifi_tethering),
                label: const Text('ทดสอบสัญญาณ'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
