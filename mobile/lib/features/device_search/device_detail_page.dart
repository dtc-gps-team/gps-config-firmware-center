import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_error_view.dart';
import 'device_search_repository.dart';
import 'device_status_ui.dart';

String _formatDate(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

/// "รายละเอียดอุปกรณ์" — one device from `GET /devices/{deviceId}`, opened from
/// a row on the search screen. Read-only aside from the "Override ค่า
/// พารามิเตอร์" entry point (ST only — Config Override Phase 2, issue #211,
/// via `GET /devices/{deviceId}/config`): shows the fields of the `Device`
/// record itself, firmware sync status is still a separate, not-yet-built
/// endpoint.
class DeviceDetailPage extends ConsumerWidget {
  const DeviceDetailPage({super.key, required this.deviceId});

  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final deviceAsync = ref.watch(deviceDetailProvider(deviceId));
    final isSt = ref.watch(authControllerProvider).role == UserRole.st;

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('รายละเอียดอุปกรณ์'),
      ),
      body: deviceAsync.when(
        skipLoadingOnRefresh: true,
        data: (device) =>
            _DeviceDetailView(device: device, deviceId: deviceId, isSt: isSt),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _DetailError(
          message: _errorMessage(error),
          onRetry: () => ref.invalidate(deviceDetailProvider(deviceId)),
        ),
      ),
    );
  }

  static String _errorMessage(Object error) {
    if (error is ApiException) {
      switch (error.statusCode) {
        case 404:
          return 'ไม่พบอุปกรณ์นี้';
        case 403:
          return 'ไม่มีสิทธิ์ดูอุปกรณ์นี้';
        default:
          return error.message;
      }
    }
    return 'โหลดรายละเอียดอุปกรณ์ไม่สำเร็จ';
  }
}

class _DeviceDetailView extends StatelessWidget {
  const _DeviceDetailView({
    required this.device,
    required this.deviceId,
    required this.isSt,
  });

  final Device device;
  final String deviceId;
  final bool isSt;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Text(
          device.deviceId,
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w700,
            color: AppTheme.textPrimary,
          ),
        ),
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerLeft,
          child: DeviceStatusPill(status: device.status),
        ),
        const SizedBox(height: 20),
        _InfoCard(
          rows: [
            ('เบอร์ซิม', device.simNumber.isEmpty ? '—' : device.simNumber),
            ('รุ่น', device.deviceModel.isEmpty ? '—' : device.deviceModel),
            ('โปรโตคอล', device.protocol.isEmpty ? '—' : device.protocol),
            ('สถานะ', DeviceStatusStyle.label(device.status)),
            ('ลงทะเบียนเมื่อ', _formatDate(device.registeredAt)),
            (
              'ติดตั้งเมื่อ',
              device.installedAt == null
                  ? '—'
                  : _formatDate(device.installedAt!),
            ),
          ],
        ),
        if (isSt) ...[
          const SizedBox(height: 20),
          OutlinedButton.icon(
            key: const Key('device_detail_config_override'),
            onPressed: () =>
                context.push(AppRoutes.deviceConfigOverride(deviceId)),
            icon: const Icon(Icons.tune),
            label: const Text('Override ค่าพารามิเตอร์'),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppTheme.navy,
              side: const BorderSide(color: AppTheme.navy),
              minimumSize: const Size.fromHeight(48),
            ),
          ),
        ],
      ],
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.rows});

  final List<(String, String)> rows;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          for (final (label, value) in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 110,
                    child: Text(
                      label,
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      value,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _DetailError extends StatelessWidget {
  const _DetailError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return AppErrorView(
      message: message,
      onRetry: onRetry,
      messageKey: const Key('device_detail_error'),
      retryKey: const Key('device_detail_retry'),
    );
  }
}
