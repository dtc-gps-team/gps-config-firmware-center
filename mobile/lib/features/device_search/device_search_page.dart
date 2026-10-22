import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_empty_state.dart';
import '../../core/ui/app_page_header.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/ui/labels.dart';
import '../../core/ui/status_tones.dart';
import '../../core/widgets/app_error_view.dart';
import '../../core/widgets/text_scale.dart';
import '../auth/account_sheet.dart';
import 'device_search_repository.dart';

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

/// "Device Search" — แท็บค้นหาอุปกรณ์ (ทุก role) · Lists `GET /devices` (every
/// role may read it) and filters client-side by `deviceId` / `simNumber`.
/// Tapping a row opens the detail screen.
///
/// design system ใหม่ (docs/22 Batch 4): หัวหน้าจอ "Device Search" ตาม Web
/// (§6.2) + ปุ่มบัญชีผู้ใช้ (หน้าระดับแท็บ) · การ์ด `AppCard` · ป้ายสถานะ `AppBadge`
/// + dot · ตรรกะ/การเรียก API เหมือนเดิม
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
    final navigator = Navigator.of(context);

    return AppV2Theme(
      child: Scaffold(
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppPageHeader(
                title: 'Device Search',
                onBack: navigator.canPop() ? navigator.pop : null,
                trailing: const AccountButton(),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: TextField(
                  key: const Key('device_search_field'),
                  controller: _controller,
                  onChanged: (value) => setState(() => _query = value),
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    hintText: 'ค้นหาด้วยเลขเครื่อง หรือเบอร์ซิม',
                    prefixIcon: const Icon(Icons.search),
                    filled: true,
                    fillColor: AppColors.card,
                    suffixIcon: _query.isEmpty
                        ? null
                        : IconButton(
                            key: const Key('device_search_clear'),
                            tooltip: 'ล้างคำค้น',
                            icon: const Icon(Icons.close),
                            onPressed: () {
                              _controller.clear();
                              setState(() => _query = '');
                            },
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
                        return _DeviceSearchEmpty(
                          searching: _query.trim().isNotEmpty,
                        );
                      }
                      return ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                        itemCount: filtered.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 12),
                        itemBuilder: (context, i) => _DeviceCard(
                          key: Key('device_card_$i'),
                          device: filtered[i],
                          onTap: () => context.push(
                            AppRoutes.deviceDetail(filtered[i].deviceId),
                          ),
                        ),
                      );
                    },
                    loading: () => const AppListSkeleton(
                      count: 5,
                      padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                    ),
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
        ),
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
    // ตัวอักษรใหญ่: ป้ายสถานะย้ายลงมาใต้รายละเอียด (UX audit #23) เดิมป้าย
    // ด้านขวาทำให้การ์ดล้นขอบ และรุ่น/โปรโตคอลขึ้นบรรทัดใหม่กลางคำ
    final largeText = isLargeTextScale(context);
    final badge = AppBadge(
      label: deviceLifecycleLabel(device.status),
      tone: deviceLifecycleTone(device.status),
      dot: true,
    );
    return AppCard(
      onTap: onTap,
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  device.deviceId,
                  style: const TextStyle(
                    fontSize: AppTypography.base,
                    height: AppTypography.baseHeight,
                    fontWeight: FontWeight.w600,
                    color: AppColors.foreground,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'ซิม ${device.simNumber} · ${device.deviceModel}/${device.protocol}',
                  style: const TextStyle(
                    fontSize: AppTypography.sm,
                    height: AppTypography.smHeight,
                    color: AppColors.mutedForeground,
                  ),
                ),
                if (largeText) ...[const SizedBox(height: 8), badge],
              ],
            ),
          ),
          if (!largeText) ...[const SizedBox(width: 12), badge],
        ],
      ),
    );
  }
}

class _DeviceSearchEmpty extends StatelessWidget {
  const _DeviceSearchEmpty({required this.searching});

  final bool searching;

  @override
  Widget build(BuildContext context) {
    // ListView ให้ดึงลงเพื่อรีเฟรชได้แม้ไม่มีรายการ
    return ListView(
      children: [
        const SizedBox(height: 48),
        AppEmptyState(
          icon: Icons.devices_other_outlined,
          message: searching
              ? 'ไม่พบอุปกรณ์ที่ตรงกับคำค้น'
              : 'ยังไม่มีอุปกรณ์ในระบบ',
          messageKey: const Key('device_search_empty'),
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
        AppErrorView(
          message: message,
          onRetry: onRetry,
          messageKey: const Key('device_search_error'),
          retryKey: const Key('device_search_retry'),
        ),
      ],
    );
  }
}
