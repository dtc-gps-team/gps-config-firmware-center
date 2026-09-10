import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import 'device_search_repository.dart';
import 'device_status_ui.dart';

/// Device Detail palette. Scoped to this file, same values as Task Detail.
class _DeviceColors {
  const _DeviceColors._();

  static const navy = Color(0xFF12344D);
  static const background = Color(0xFFF4F6F8);
  static const surface = Colors.white;
  static const textPrimary = Color(0xFF12344D);
  static const textSecondary = Color(0xFF5F6E79);
  static const error = Color(0xFFC0392B);
}

String _formatDate(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

/// "รายละเอียดอุปกรณ์" — one device from `GET /devices/{deviceId}`, opened from
/// a row on the search screen. Read-only: shows the fields of the `Device`
/// record itself (config/firmware sync status is a separate, not-yet-built
/// endpoint).
class DeviceDetailPage extends ConsumerWidget {
  const DeviceDetailPage({super.key, required this.deviceId});

  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final deviceAsync = ref.watch(deviceDetailProvider(deviceId));

    return Scaffold(
      backgroundColor: _DeviceColors.background,
      appBar: AppBar(
        backgroundColor: _DeviceColors.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('รายละเอียดอุปกรณ์'),
      ),
      body: deviceAsync.when(
        skipLoadingOnRefresh: true,
        data: (device) => _DeviceDetailView(device: device),
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
  const _DeviceDetailView({required this.device});

  final Device device;

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
            color: _DeviceColors.textPrimary,
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
        color: _DeviceColors.surface,
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
                        color: _DeviceColors.textSecondary,
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
                        color: _DeviceColors.textPrimary,
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
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.error_outline,
              color: _DeviceColors.error,
              size: 32,
            ),
            const SizedBox(height: 12),
            Text(
              message,
              key: const Key('device_detail_error'),
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 14,
                color: _DeviceColors.textSecondary,
              ),
            ),
            const SizedBox(height: 16),
            FilledButton(
              key: const Key('device_detail_retry'),
              onPressed: onRetry,
              style: FilledButton.styleFrom(
                backgroundColor: _DeviceColors.navy,
                foregroundColor: Colors.white,
              ),
              child: const Text('ลองอีกครั้ง'),
            ),
          ],
        ),
      ),
    );
  }
}
