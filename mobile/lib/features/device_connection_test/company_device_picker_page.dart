import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_error_view.dart';
import '../../core/widgets/skeleton_card.dart';
import '../device_search/device_status_ui.dart';
import 'customer_device_repository.dart';

/// Groups by `deviceModel`, models sorted alphabetically (stable — devices
/// keep their `GET /devices` order, which is `deviceId` ascending, within
/// each group).
Map<String, List<Device>> _groupByModel(List<Device> devices) {
  final grouped = <String, List<Device>>{};
  for (final device in devices) {
    grouped.putIfAbsent(device.deviceModel, () => []).add(device);
  }
  return Map.fromEntries(
    grouped.entries.toList()..sort((a, b) => a.key.compareTo(b.key)),
  );
}

/// Step 1–2 of the "เลือกจากรายการ" path on the ทดสอบสัญญาณ page (issue
/// #204) — เลือกบริษัท (`GET /customers`) → เห็นรายการอุปกรณ์ของบริษัทนั้น
/// แยกกลุ่มตามรุ่น (`GET /devices?customerId=`) → เลือกอุปกรณ์ pop กลับไปพร้อม
/// `deviceId` ที่เลือก
///
/// ไม่แตะ flow เดิม (พิมพ์ device ID เอง) เลย — หน้านี้เป็นทางเลือกเพิ่ม
/// เท่านั้น ตามมติที่ยืนยันไว้ใน #204 (อุปกรณ์ที่ยังไม่ผูกบริษัทไม่โผล่ในนี้
/// เพราะ backend filter `customerId` ไม่คืนแถวที่ `customerId` เป็น `null` —
/// ช่างยังพิมพ์เลขเครื่องเองได้ตามปกติสำหรับเครื่องกลุ่มนั้น)
class CompanyDevicePickerPage extends ConsumerStatefulWidget {
  const CompanyDevicePickerPage({super.key});

  @override
  ConsumerState<CompanyDevicePickerPage> createState() =>
      _CompanyDevicePickerPageState();
}

class _CompanyDevicePickerPageState
    extends ConsumerState<CompanyDevicePickerPage> {
  Customer? _selectedCustomer;

  @override
  Widget build(BuildContext context) {
    final customer = _selectedCustomer;
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(customer == null ? 'เลือกบริษัท' : customer.companyName),
        leading: customer == null
            ? null
            : IconButton(
                key: const Key('company_picker_back_to_customers'),
                icon: const Icon(Icons.arrow_back),
                onPressed: () => setState(() => _selectedCustomer = null),
              ),
      ),
      body: customer == null
          ? _CustomerListView(
              onSelect: (c) => setState(() => _selectedCustomer = c),
            )
          : _DeviceListView(customer: customer),
    );
  }
}

class _CustomerListView extends ConsumerWidget {
  const _CustomerListView({required this.onSelect});

  final ValueChanged<Customer> onSelect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final customersAsync = ref.watch(customerListProvider);

    return RefreshIndicator(
      onRefresh: () => ref.refresh(customerListProvider.future),
      child: customersAsync.when(
        skipLoadingOnRefresh: true,
        data: (customers) {
          if (customers.isEmpty) {
            return ListView(
              padding: const EdgeInsets.all(16),
              children: const [
                SizedBox(height: 64),
                Center(child: Text('ยังไม่มีข้อมูลบริษัทในระบบ')),
              ],
            );
          }
          return ListView.separated(
            key: const Key('company_picker_customer_list'),
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: customers.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (context, i) {
              final c = customers[i];
              return Material(
                color: AppTheme.surface,
                borderRadius: BorderRadius.circular(12),
                child: InkWell(
                  key: Key('company_picker_customer_$i'),
                  borderRadius: BorderRadius.circular(12),
                  onTap: () => onSelect(c),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 16,
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            c.companyName,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                        ),
                        const Icon(
                          Icons.chevron_right,
                          color: AppTheme.textSecondary,
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          );
        },
        loading: () => ListView.separated(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          itemCount: 5,
          separatorBuilder: (_, _) => const SizedBox(height: 8),
          itemBuilder: (_, _) => const SkeletonCard(height: 56),
        ),
        error: (error, _) => ListView(
          children: [
            const SizedBox(height: 64),
            AppErrorView(
              message: error is ApiException
                  ? error.message
                  : 'โหลดรายชื่อบริษัทไม่สำเร็จ',
              onRetry: () => ref.invalidate(customerListProvider),
              retryKey: const Key('company_picker_customers_retry'),
            ),
          ],
        ),
      ),
    );
  }
}

class _DeviceListView extends ConsumerWidget {
  const _DeviceListView({required this.customer});

  final Customer customer;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final devicesAsync = ref.watch(customerDevicesProvider(customer.id));

    return RefreshIndicator(
      onRefresh: () => ref.refresh(customerDevicesProvider(customer.id).future),
      child: devicesAsync.when(
        skipLoadingOnRefresh: true,
        data: (devices) {
          if (devices.isEmpty) {
            return ListView(
              padding: const EdgeInsets.all(16),
              children: const [
                SizedBox(height: 64),
                Center(child: Text('บริษัทนี้ยังไม่มีอุปกรณ์ผูกไว้')),
              ],
            );
          }
          final grouped = _groupByModel(devices);
          return ListView(
            key: const Key('company_picker_device_list'),
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            children: [
              for (final entry in grouped.entries) ...[
                Padding(
                  padding: const EdgeInsets.only(bottom: 8, top: 8),
                  child: Text(
                    '${entry.key} (${entry.value.length})',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                ),
                for (final device in entry.value) ...[
                  _DeviceRow(
                    key: Key('company_picker_device_${device.deviceId}'),
                    device: device,
                    onTap: () => context.pop(device.deviceId),
                  ),
                  const SizedBox(height: 8),
                ],
              ],
            ],
          );
        },
        loading: () => ListView.separated(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          itemCount: 5,
          separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (_, _) => const SkeletonCard(),
        ),
        error: (error, _) => ListView(
          children: [
            const SizedBox(height: 64),
            AppErrorView(
              message: error is ApiException
                  ? error.message
                  : 'โหลดรายการอุปกรณ์ไม่สำเร็จ',
              onRetry: () =>
                  ref.invalidate(customerDevicesProvider(customer.id)),
              retryKey: const Key('company_picker_devices_retry'),
            ),
          ],
        ),
      ),
    );
  }
}

class _DeviceRow extends StatelessWidget {
  const _DeviceRow({super.key, required this.device, required this.onTap});

  final Device device;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppTheme.surface,
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
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'ซิม ${device.simNumber} · ${device.protocol}',
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppTheme.textSecondary,
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
