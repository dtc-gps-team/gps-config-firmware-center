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
import '../../core/ui/app_ink_header.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/ui/labels.dart';
import '../../core/ui/status_tones.dart';
import '../../core/widgets/app_error_view.dart';
import '../auth/account_sheet.dart';
import 'device_search_repository.dart';
import 'starred_devices.dart';

// ภาพ R4-03 ใช้ gutter 18px และช่องค้นหาห่างจากหัว 22px; ไม่มีค่าคู่นี้ใน
// AppSpacing จึงเก็บเป็นค่าคงที่เฉพาะหน้านี้ แทนสร้าง token ชุดใหม่.
const double _deviceSearchGutter = 18;
const _deviceSearchSearchPadding = EdgeInsets.fromLTRB(
  _deviceSearchGutter,
  22,
  _deviceSearchGutter,
  AppSpacing.md,
);
const _deviceSearchContentPadding = EdgeInsets.fromLTRB(
  _deviceSearchGutter,
  AppSpacing.lg,
  _deviceSearchGutter,
  0,
);

// ขนาดพื้นที่แตะ 48px และขอบ active 2px ไม่มี semantic token ใน AppTokens.
const double _filterChipMinHeight = 48;
const double _selectedFilterBorderWidth = 2;

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

/// ค้นหาอุปกรณ์ตามภาพ r4: หัวเข้ม ชิปตัวกรอง และการ์ดที่ติดดาวได้
/// ยังค้นเลขเครื่อง/ซิมและกรองด้วยข้อมูลจาก provider เดิม ไม่ค้นไม่แสดงทั้งระบบ
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
    final starred = ref.watch(starredDevicesProvider);
    final navigator = Navigator.of(context);

    Widget card(Device device, Key key) => _DeviceCard(
      key: key,
      device: device,
      starred: starred.contains(device.deviceId),
      onToggleStar: () =>
          ref.read(starredDevicesProvider.notifier).toggle(device.deviceId),
      onTap: () => context.push(AppRoutes.deviceDetail(device.deviceId)),
    );

    // ใช้พื้นที่เลื่อนเดียวทั้งตัวกรองและผลลัพธ์ เพื่อให้จอเล็ก/ข้อความใหญ่
    // ยังเข้าถึงตัวกรองและงานด้านล่างได้ ไม่ให้หัวหน้ากินพื้นที่รายการทั้งหมด
    Widget message(Widget child) => SliverToBoxAdapter(child: child);
    Widget list(
      List<Device> devices,
      String label,
      String keyName, {
      required bool pinned,
      Key? key,
    }) => SliverPadding(
      key: key,
      padding: _deviceSearchContentPadding,
      sliver: SliverList(
        delegate: SliverChildBuilderDelegate((context, row) {
          if (row == 0) {
            return Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.md),
              child: Text(
                label,
                key: Key(keyName),
                style: const TextStyle(
                  fontSize: AppTypography.xs,
                  height: AppTypography.xsHeight,
                  color: AppColors.mutedForeground,
                ),
              ),
            );
          }
          return Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.md),
            child: card(
              devices[row - 1],
              Key(
                pinned
                    ? 'device_starred_card_${row - 1}'
                    : 'device_card_${row - 1}',
              ),
            ),
          );
        }, childCount: devices.length + 1),
      ),
    );
    final results = devicesAsync.when(
      skipLoadingOnRefresh: true,
      data: (devices) {
        if (devices.isNotEmpty && _query.trim().isEmpty && _filters.isEmpty) {
          final pinned = devices
              .where((d) => starred.contains(d.deviceId))
              .toList(growable: false);
          if (pinned.isEmpty) {
            return message(
              _DeviceSearchEmpty(
                icon: Icons.search,
                messageKey: const Key('device_search_prompt'),
                message:
                    'มีอุปกรณ์ทั้งหมด ${devices.length} เครื่อง · พิมพ์เลขเครื่องหรือเบอร์ซิม หรือเลือกตัวกรองด้านบน · แตะ ☆ บนการ์ดเพื่อติดดาว ครั้งหน้าจะขึ้นที่นี่เลย',
                compact: true,
              ),
            );
          }
          return list(
            pinned,
            'ติดดาวไว้ ${pinned.length} เครื่อง · ค้นหาหรือกรองเพื่อดูเครื่องอื่น',
            'device_starred_title',
            pinned: true,
            key: const Key('device_starred_list'),
          );
        }
        final filtered = _applyFilters(_filterDevices(devices, _query));
        if (filtered.isEmpty) {
          return message(
            _DeviceSearchEmpty(
              message: _filters.isNotEmpty
                  ? 'ไม่พบอุปกรณ์ที่ตรงกับคำค้นหรือตัวกรอง'
                  : _query.trim().isNotEmpty
                  ? 'ไม่พบอุปกรณ์ที่ตรงกับคำค้น'
                  : 'ยังไม่มีอุปกรณ์ในระบบ',
            ),
          );
        }
        return list(
          filtered,
          'แสดง ${filtered.length} จาก ${devices.length} เครื่อง',
          'device_search_count',
          pinned: false,
        );
      },
      loading: () => message(
        const AppListSkeleton(count: 5, padding: _deviceSearchContentPadding),
      ),
      error: (error, _) => message(
        _DeviceSearchError(
          message: error is ApiException
              ? error.message
              : 'โหลดรายการอุปกรณ์ไม่สำเร็จ',
          onRetry: () => ref.invalidate(deviceListProvider),
        ),
      ),
    );
    return AppV2Theme(
      child: Scaffold(
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AppInkHeader(
              title: 'ค้นหาอุปกรณ์',
              onBack: navigator.canPop() ? navigator.pop : null,
              trailing: const AccountButton(key: Key('account_button')),
            ),
            // คงกรอบเลื่อนของ 9719653 ไว้: ตัวกรองยาวไม่ดันผลลัพธ์พ้นจอ
            // โดยเฉพาะจอ 360px / text scale 2x.
            ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.sizeOf(context).height / 2,
              ),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(
                      padding: _deviceSearchSearchPadding,
                      child: TextField(
                        key: const Key('device_search_field'),
                        controller: _controller,
                        onChanged: (value) => setState(() => _query = value),
                        textInputAction: TextInputAction.search,
                        decoration: InputDecoration(
                          // ผู้ใช้ไม่รู้ว่าค้นด้วยอะไรได้ — บอกทั้ง 2 ช่องทาง
                          // + ตัวอย่าง (ค้นบางส่วนได้ ตาม _filterDevices)
                          hintText: 'ค้นหาด้วย device_id หรือเบอร์ซิม',
                          helperText:
                              'เช่น BOX-0001 หรือ 0812345678 · พิมพ์แค่บางส่วนก็ได้',
                          helperMaxLines: 2,
                          filled: true,
                          fillColor: AppColors.card,
                          suffixIcon: _query.isEmpty
                              ? Container(
                                  margin: const EdgeInsets.all(AppSpacing.xs),
                                  decoration: BoxDecoration(
                                    color: AppColors.primarySubtle,
                                    borderRadius: BorderRadius.circular(
                                      AppRadius.lg,
                                    ),
                                  ),
                                  child: IconButton(
                                    tooltip: 'ค้นหาอุปกรณ์',
                                    icon: const Icon(Icons.search),
                                    onPressed: () =>
                                        FocusScope.of(context).unfocus(),
                                  ),
                                )
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
                    Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.lg,
                      ),
                      child: Wrap(
                        spacing: AppSpacing.sm,
                        runSpacing: AppSpacing.sm,
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
                    const SizedBox(height: AppSpacing.md),
                  ],
                ),
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () => ref.refresh(deviceListProvider.future),
                child: CustomScrollView(
                  key: const Key('device_search_scroll'),
                  physics: const AlwaysScrollableScrollPhysics(),
                  slivers: [
                    results,
                    const SliverToBoxAdapter(
                      child: SizedBox(height: AppSpacing.xl),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DeviceCard extends StatelessWidget {
  const _DeviceCard({
    super.key,
    required this.device,
    required this.starred,
    required this.onToggleStar,
    required this.onTap,
  });

  final Device device;
  final bool starred;
  final VoidCallback onToggleStar;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // ตัวอักษรใหญ่: ป้ายสถานะย้ายลงมาใต้รายละเอียด (UX audit #23) เดิมป้าย
    // ด้านขวาทำให้การ์ดล้นขอบ และรุ่น/โปรโตคอลขึ้นบรรทัดใหม่กลางคำ
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
                const SizedBox(height: AppSpacing.xs),
                Text(
                  // B (30/10/2026): ไม่แสดงโปรโตคอลบนการ์ด (ยังกรองตามโปรโตคอลได้)
                  'ซิม ${device.simNumber} · ${device.deviceModel}',
                  style: const TextStyle(
                    fontSize: AppTypography.sm,
                    height: AppTypography.smHeight,
                    color: AppColors.mutedForeground,
                  ),
                ),
                const SizedBox(height: AppSpacing.xs / 2),
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
                const SizedBox(height: AppSpacing.sm),
                badge,
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.xs),
          IconButton(
            key: Key('device_star_${device.deviceId}'),
            tooltip: starred ? 'เอาดาวออก' : 'ติดดาว',
            onPressed: onToggleStar,
            icon: Icon(
              starred ? Icons.star_rounded : Icons.star_outline_rounded,
              color: starred ? AppColors.warning : AppColors.mutedForeground,
            ),
          ),
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
        side: BorderSide(
          color: active ? AppColors.primary : AppColors.inputBorder,
        ),
      ),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: _filterChipMinHeight),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: AppSpacing.sm,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text(
                    label,
                    style: TextStyle(
                      fontSize: AppTypography.sm,
                      height: AppTypography.smHeight,
                      fontWeight: active ? FontWeight.w600 : FontWeight.w400,
                      color: color,
                    ),
                  ),
                ),
              ],
            ),
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
      return Padding(
        padding: const EdgeInsets.fromLTRB(
          _deviceSearchGutter,
          0,
          _deviceSearchGutter,
          AppSpacing.sm,
        ),
        child: ListTile(
          shape: StadiumBorder(
            side: BorderSide(
              color: isSelected ? AppColors.primary : AppColors.inputBorder,
              width: isSelected ? _selectedFilterBorderWidth : 1,
            ),
          ),
          key: Key('device_filter_option_$keyValue'),
          title: Text(label),
          trailing: isSelected
              ? const Icon(Icons.check, color: AppColors.primary)
              : null,
          onTap: () => Navigator.of(context).pop(value),
        ),
      );
    }

    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              0,
              AppSpacing.lg,
              AppSpacing.sm,
            ),
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
  const _DeviceSearchEmpty({
    required this.message,
    this.icon = Icons.devices_other_outlined,
    this.messageKey = const Key('device_search_empty'),
    this.compact = false,
  });

  final String message;
  final IconData icon;
  final Key messageKey;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (compact) {
      return Padding(
        padding: _deviceSearchContentPadding,
        child: Text(
          message,
          key: messageKey,
          style: const TextStyle(
            fontSize: AppTypography.xs,
            height: AppTypography.xsHeight,
            color: AppColors.mutedForeground,
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.xxxl + AppSpacing.xs),
      child: AppEmptyState(
        icon: icon,
        message: message,
        messageKey: messageKey,
      ),
    );
  }
}

class _DeviceSearchError extends StatelessWidget {
  const _DeviceSearchError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.xxxl + AppSpacing.xs),
      child: AppErrorView(
        message: message,
        onRetry: onRetry,
        messageKey: const Key('device_search_error'),
        retryKey: const Key('device_search_retry'),
      ),
    );
  }
}
