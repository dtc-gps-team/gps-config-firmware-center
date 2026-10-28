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
import '../../core/ui/app_fade_in.dart';
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

/// ค่าใน filter "ลูกค้า" ของเครื่องที่ยังไม่ผูกบริษัท (`customer` null)
const _noCustomer = 'none';

/// ตัวกรองของหน้าค้นหาอุปกรณ์ — ค่าตรงตัวแบบเดียวกับ filter ของ `GET /devices`
/// (`deviceModel` / `customerId` / `protocol` / `status`) แต่กรองฝั่ง client
/// เหมือนช่องค้นหา · ตัวเลือกมาจากค่าที่มีจริงในรายการ (ไม่มีรายการรุ่น/ลูกค้า
/// แยกให้ดึง)
enum _DeviceFilter {
  model('model', 'รุ่น'),
  customer('customer', 'ลูกค้า'),
  protocol('protocol', 'โปรโตคอล'),
  status('status', 'สถานะ');

  const _DeviceFilter(this.keyName, this.title);

  final String keyName;
  final String title;

  String valueOf(Device d) => switch (this) {
    _DeviceFilter.model => d.deviceModel,
    _DeviceFilter.customer => d.customer?.id ?? _noCustomer,
    _DeviceFilter.protocol => d.protocol,
    _DeviceFilter.status => d.status.wireName,
  };

  String labelOf(Device d) => switch (this) {
    _DeviceFilter.customer => d.customer?.companyName ?? 'ยังไม่ผูกลูกค้า',
    _DeviceFilter.status => deviceLifecycleLabel(d.status),
    _ => valueOf(d),
  };
}

class _FilterOption {
  _FilterOption(this.value, this.label);

  final String value;
  final String label;
  int count = 0;
}

/// ตัวเลือกของ [filter] จากทุกเครื่องในรายการ เรียงตามชื่อ · "ยังไม่ผูกลูกค้า" ไว้ท้าย
List<_FilterOption> _filterOptions(_DeviceFilter filter, List<Device> devices) {
  final byValue = <String, _FilterOption>{};
  for (final d in devices) {
    final value = filter.valueOf(d);
    byValue
        .putIfAbsent(value, () => _FilterOption(value, filter.labelOf(d)))
        .count++;
  }
  return byValue.values.toList()..sort((a, b) {
    if (a.value == _noCustomer) return 1;
    if (b.value == _noCustomer) return -1;
    return a.label.compareTo(b.label);
  });
}

/// "Device Search" — แท็บค้นหาอุปกรณ์ (ทุก role) · Lists `GET /devices` (every
/// role may read it) and filters client-side by `deviceId` / `simNumber`.
/// Tapping a row opens the detail screen.
///
/// design system ใหม่ (docs/22 Batch 4): หัวหน้าจอ "Device Search" ตาม Web
/// (§6.2) + ปุ่มบัญชีผู้ใช้ (หน้าระดับแท็บ) · การ์ด `AppCard` · ป้ายสถานะ `AppBadge`
/// + dot · ตรรกะ/การเรียก API เหมือนเดิม
///
/// ใต้ช่องค้นหามีชิปตัวกรอง รุ่น / ลูกค้า / โปรโตคอล / สถานะ ใช้ร่วมกับคำค้นได้
class DeviceSearchPage extends ConsumerStatefulWidget {
  const DeviceSearchPage({super.key});

  @override
  ConsumerState<DeviceSearchPage> createState() => _DeviceSearchPageState();
}

class _DeviceSearchPageState extends ConsumerState<DeviceSearchPage> {
  final _controller = TextEditingController();
  String _query = '';
  final Map<_DeviceFilter, String> _filters = {};

  /// [except] = ไม่นับตัวกรองนั้น (ใช้หาตัวเลือกของตัวกรองที่กำลังเปิด)
  List<Device> _applyFilters(List<Device> devices, {_DeviceFilter? except}) =>
      devices
          .where(
            (d) => _filters.entries.every(
              (f) => f.key == except || f.key.valueOf(d) == f.value,
            ),
          )
          .toList(growable: false);

  Future<void> _openFilter(_DeviceFilter filter, List<Device> all) async {
    // ตัวเลือกและจำนวนนับจากเครื่องที่ผ่านคำค้นและตัวกรองอื่นอยู่แล้ว
    // ไม่งั้นเลือกแล้วได้ 0 เครื่อง (เช่น เลือกรุ่นแล้วลูกค้าที่ไม่มีรุ่นนั้นยังโผล่)
    final devices = _applyFilters(_filterDevices(all, _query), except: filter);
    final picked = await showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      backgroundColor: AppColors.card,
      showDragHandle: true,
      builder: (_) => AppV2Theme(
        child: _FilterSheet(
          filter: filter,
          options: _filterOptions(filter, devices),
          selected: _filters[filter],
          total: devices.length,
        ),
      ),
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (picked.isEmpty) {
        _filters.remove(filter);
      } else {
        _filters[filter] = picked;
      }
    });
  }

  /// ชื่อที่แสดงบนชิปของค่าที่เลือก · หาไม่เจอ (เครื่องหายหลังรีเฟรช) = ค่าดิบ
  String _selectedLabel(_DeviceFilter filter, List<Device> devices) {
    final value = _filters[filter]!;
    for (final d in devices) {
      if (filter.valueOf(d) == value) return filter.labelOf(d);
    }
    return value;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final devicesAsync = ref.watch(deviceListProvider);
    final allDevices = devicesAsync.valueOrNull ?? const <Device>[];
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
              // ตัดบรรทัดแทนเลื่อนแนวนอน ให้เห็นค่าที่เลือกและปุ่มล้างครบเสมอ
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    for (final filter in _DeviceFilter.values)
                      _FilterChipButton(
                        key: Key('device_filter_${filter.keyName}'),
                        label: _filters.containsKey(filter)
                            ? '${filter.title}: ${_selectedLabel(filter, allDevices)}'
                            : filter.title,
                        active: _filters.containsKey(filter),
                        onTap: allDevices.isEmpty
                            ? null
                            : () => _openFilter(filter, allDevices),
                      ),
                    if (_filters.isNotEmpty)
                      TextButton(
                        key: const Key('device_filter_clear'),
                        onPressed: () => setState(_filters.clear),
                        child: const Text('ล้างตัวกรอง'),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () => ref.refresh(deviceListProvider.future),
                  child: devicesAsync.when(
                    skipLoadingOnRefresh: true,
                    data: (devices) {
                      final filtered = _applyFilters(
                        _filterDevices(devices, _query),
                      );
                      if (filtered.isEmpty) {
                        return _DeviceSearchEmpty(
                          message: _filters.isNotEmpty
                              ? 'ไม่พบอุปกรณ์ที่ตรงกับคำค้นหรือตัวกรอง'
                              : _query.trim().isNotEmpty
                              ? 'ไม่พบอุปกรณ์ที่ตรงกับคำค้น'
                              : 'ยังไม่มีอุปกรณ์ในระบบ',
                        );
                      }
                      final counted = _filters.isNotEmpty;
                      // จางเข้าทั้งรายการตอนโหลดเสร็จ (ไม่ใช่ทีละแถว — แถวถูกสร้างใหม่ตอนเลื่อน)
                      return AppFadeIn(
                        child: ListView.separated(
                          padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                          // แถวแรกบอกจำนวนที่เหลือเมื่อมีตัวกรอง
                          itemCount: filtered.length + (counted ? 1 : 0),
                          separatorBuilder: (_, _) =>
                              const SizedBox(height: 12),
                          itemBuilder: (context, row) {
                            if (counted && row == 0) {
                              return Text(
                                'แสดง ${filtered.length} จาก ${devices.length} เครื่อง',
                                key: const Key('device_search_count'),
                                style: const TextStyle(
                                  fontSize: AppTypography.sm,
                                  height: AppTypography.smHeight,
                                  color: AppColors.mutedForeground,
                                ),
                              );
                            }
                            final i = counted ? row - 1 : row;
                            return _DeviceCard(
                              key: Key('device_card_$i'),
                              device: filtered[i],
                              onTap: () => context.push(
                                AppRoutes.deviceDetail(filtered[i].deviceId),
                              ),
                            );
                          },
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
                const SizedBox(height: 2),
                // เวอร์ชันที่กล่องรายงานเอง (telemetry) ไม่ใช่เวอร์ชันที่สั่งส่ง
                Text(
                  'Firmware ${device.reportedFirmwareVersion ?? 'ยังไม่ทราบ'}',
                  key: Key('device_firmware_${device.deviceId}'),
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

/// ชิปตัวกรองหนึ่งตัว — แตะเปิดแผ่นเลือกค่า · [active] = เลือกค่าไว้แล้ว
class _FilterChipButton extends StatelessWidget {
  const _FilterChipButton({
    super.key,
    required this.label,
    required this.active,
    required this.onTap,
  });

  final String label;
  final bool active;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final color = active ? AppColors.primary : AppColors.foreground;
    return Material(
      color: active ? AppColors.primarySubtle : AppColors.card,
      shape: StadiumBorder(
        side: BorderSide(color: active ? AppColors.primary : AppColors.border),
      ),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 6, 8, 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: AppTypography.sm,
                  height: AppTypography.smHeight,
                  fontWeight: active ? FontWeight.w600 : FontWeight.w400,
                  color: color,
                ),
              ),
              const SizedBox(width: 2),
              Icon(Icons.expand_more, size: 18, color: color),
            ],
          ),
        ),
      ),
    );
  }
}

/// แผ่นเลือกค่าของตัวกรอง · คืน `''` = ทั้งหมด (ยกเลิกตัวกรองนี้) · ปิดแผ่น = null
class _FilterSheet extends StatelessWidget {
  const _FilterSheet({
    required this.filter,
    required this.options,
    required this.selected,
    required this.total,
  });

  final _DeviceFilter filter;
  final List<_FilterOption> options;
  final String? selected;
  final int total;

  @override
  Widget build(BuildContext context) {
    Widget tile(String keyValue, String value, String label, bool isSelected) {
      return ListTile(
        key: Key('device_filter_option_$keyValue'),
        title: Text(label),
        trailing: isSelected
            ? const Icon(Icons.check, color: AppColors.primary)
            : null,
        onTap: () => Navigator.of(context).pop(value),
      );
    }

    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text(
              'กรองตาม${filter.title}',
              style: const TextStyle(
                fontSize: AppTypography.lg,
                height: AppTypography.lgHeight,
                fontWeight: FontWeight.w600,
                color: AppColors.foreground,
              ),
            ),
          ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              children: [
                tile('all', '', 'ทั้งหมด ($total)', selected == null),
                for (final o in options)
                  tile(
                    o.value,
                    o.value,
                    '${o.label} (${o.count})',
                    selected == o.value,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DeviceSearchEmpty extends StatelessWidget {
  const _DeviceSearchEmpty({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    // ListView ให้ดึงลงเพื่อรีเฟรชได้แม้ไม่มีรายการ
    return ListView(
      children: [
        const SizedBox(height: 48),
        AppEmptyState(
          icon: Icons.devices_other_outlined,
          message: message,
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
