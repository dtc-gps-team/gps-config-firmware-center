import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/router/app_router.dart';
import 'device_search_repository.dart';
import 'device_status_ui.dart';

/// Device Search palette. Scoped to this file, same values as the Home / Task
/// redesigns — nothing here touches the shared [AppTheme].
class _DeviceColors {
  const _DeviceColors._();

  static const navy = Color(0xFF12344D);
  static const background = Color(0xFFF4F6F8);
  static const surface = Colors.white;
  static const textPrimary = Color(0xFF12344D);
  static const textSecondary = Color(0xFF5F6E79);
  static const error = Color(0xFFC0392B);
}

/// `deviceId` / `simNumber` contains-match, case-insensitive — same behaviour
/// as the backend `search` param and the Web search box. Filtering is
/// client-side: the list is small in the MVP so we fetch once and filter as
/// the user types instead of round-tripping every keystroke.
List<Device> _filterDevices(List<Device> devices, String query) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return devices;
  return devices
      .where(
        (d) =>
            d.deviceId.toLowerCase().contains(q) ||
            d.simNumber.toLowerCase().contains(q),
      )
      .toList(growable: false);
}

/// "ค้นหาอุปกรณ์" — full-screen device search, opened from the Home shortcut.
/// Lists `GET /devices` (every role may read it) and filters client-side by
/// `deviceId` / `simNumber`. Tapping a row opens the detail screen.
class DeviceSearchPage extends ConsumerStatefulWidget {
  const DeviceSearchPage({super.key});

  @override
  ConsumerState<DeviceSearchPage> createState() => _DeviceSearchPageState();
}

class _DeviceSearchPageState extends ConsumerState<DeviceSearchPage> {
  final _controller = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final devicesAsync = ref.watch(deviceListProvider);

    return Scaffold(
      backgroundColor: _DeviceColors.background,
      appBar: AppBar(
        backgroundColor: _DeviceColors.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('ค้นหาอุปกรณ์'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: TextField(
              key: const Key('device_search_field'),
              controller: _controller,
              onChanged: (value) => setState(() => _query = value),
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'ค้นหาด้วยเลขเครื่อง หรือเบอร์ซิม',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _query.isEmpty
                    ? null
                    : IconButton(
                        key: const Key('device_search_clear'),
                        icon: const Icon(Icons.close),
                        onPressed: () {
                          _controller.clear();
                          setState(() => _query = '');
                        },
                      ),
                filled: true,
                fillColor: _DeviceColors.surface,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => ref.refresh(deviceListProvider.future),
              child: devicesAsync.when(
                skipLoadingOnRefresh: true,
                data: (devices) {
                  final filtered = _filterDevices(devices, _query);
                  if (filtered.isEmpty) {
                    return _DeviceSearchEmpty(searching: _query.trim().isNotEmpty);
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                    itemCount: filtered.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (context, i) => _DeviceCard(
                      key: Key('device_card_$i'),
                      device: filtered[i],
                      onTap: () => context.push(
                        AppRoutes.deviceDetail(filtered[i].deviceId),
                      ),
                    ),
                  );
                },
                loading: () =>
                    const Center(child: CircularProgressIndicator()),
                error: (error, _) => _DeviceSearchError(
                  message: error is ApiException
                      ? error.message
                      : 'โหลดรายการอุปกรณ์ไม่สำเร็จ',
                  onRetry: () => ref.invalidate(deviceListProvider),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DeviceCard extends StatelessWidget {
  const _DeviceCard({super.key, required this.device, required this.onTap});

  final Device device;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: _DeviceColors.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      device.deviceId,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: _DeviceColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'ซิม ${device.simNumber} · ${device.deviceModel}/${device.protocol}',
                      style: const TextStyle(
                        fontSize: 13,
                        color: _DeviceColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              DeviceStatusPill(status: device.status),
            ],
          ),
        ),
      ),
    );
  }
}

class _DeviceSearchEmpty extends StatelessWidget {
  const _DeviceSearchEmpty({required this.searching});

  final bool searching;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 80),
        Center(
          child: Column(
            children: [
              const Icon(
                Icons.devices_other_outlined,
                color: _DeviceColors.textSecondary,
              ),
              const SizedBox(height: 8),
              Text(
                searching
                    ? 'ไม่พบอุปกรณ์ที่ตรงกับคำค้น'
                    : 'ยังไม่มีอุปกรณ์ในระบบ',
                key: const Key('device_search_empty'),
                style: const TextStyle(
                  fontSize: 13,
                  color: _DeviceColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _DeviceSearchError extends StatelessWidget {
  const _DeviceSearchError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 64),
        Center(
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
                  key: const Key('device_search_error'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 14,
                    color: _DeviceColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  key: const Key('device_search_retry'),
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
        ),
      ],
    );
  }
}
