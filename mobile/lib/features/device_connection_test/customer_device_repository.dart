import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';

/// Backs the "เลือกบริษัท → เลือกอุปกรณ์" flow on the ทดสอบสัญญาณ page
/// (issue #204) — kept separate from `device_search`'s `DeviceSearchRepository`
/// (a different screen: full device search/detail with its own provider
/// lifecycle) since this one exists purely to hand a `deviceId` back to
/// [DeviceConnectionTestPage]'s text field.
abstract class CustomerDeviceRepository {
  Future<List<Customer>> listCustomers();
  Future<List<Device>> listDevicesForCustomer(String customerId);
}

/// Talks to the real backend — `GET /customers` and `GET /devices?customerId=`
/// (the latter live as of issue #204's backend change).
class ApiCustomerDeviceRepository implements CustomerDeviceRepository {
  ApiCustomerDeviceRepository(this._api);

  final ApiClient _api;

  @override
  Future<List<Customer>> listCustomers() => _api.listCustomers();

  @override
  Future<List<Device>> listDevicesForCustomer(String customerId) =>
      _api.listDevices(customerId: customerId);
}

/// In-memory fake for `API_MOCK_MODE` (dev/demo without a backend) — mirrors
/// the style of `device_search`'s `MockDeviceSearchRepository`.
class MockCustomerDeviceRepository implements CustomerDeviceRepository {
  static const _customers = [
    Customer(id: 'mock-customer-1', companyName: 'บริษัท ทดสอบ จำกัด'),
    Customer(id: 'mock-customer-2', companyName: 'บริษัท ขนส่งไทย จำกัด'),
  ];

  static final Map<String, List<Device>> _devicesByCustomer = {
    'mock-customer-1': [
      Device(
        id: 'mock-device-c1-1',
        deviceId: 'DEV-1001',
        simNumber: '0811111111',
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: DeviceLifecycleStatus.installed,
        registeredAt: DateTime(2026, 6, 1),
        installedAt: DateTime(2026, 6, 3),
      ),
      Device(
        id: 'mock-device-c1-2',
        deviceId: 'DEV-1002',
        simNumber: '0822222222',
        deviceModel: 'GT06L',
        protocol: 'TCP',
        status: DeviceLifecycleStatus.installed,
        registeredAt: DateTime(2026, 6, 1),
        installedAt: DateTime(2026, 6, 3),
      ),
      Device(
        id: 'mock-device-c1-3',
        deviceId: 'DEV-1003',
        simNumber: '0833333333',
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: DeviceLifecycleStatus.registered,
        registeredAt: DateTime(2026, 8, 1),
      ),
    ],
    'mock-customer-2': [
      Device(
        id: 'mock-device-c2-1',
        deviceId: 'DEV-2001',
        simNumber: '0844444444',
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: DeviceLifecycleStatus.installed,
        registeredAt: DateTime(2026, 7, 1),
        installedAt: DateTime(2026, 7, 3),
      ),
    ],
  };

  @override
  Future<List<Customer>> listCustomers() async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    return List.unmodifiable(_customers);
  }

  @override
  Future<List<Device>> listDevicesForCustomer(String customerId) async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    return List.unmodifiable(_devicesByCustomer[customerId] ?? const []);
  }
}

final customerDeviceRepositoryProvider = Provider<CustomerDeviceRepository>((
  ref,
) {
  if (AppConfig.apiMockMode) return MockCustomerDeviceRepository();
  return ApiCustomerDeviceRepository(ref.watch(apiClientProvider));
});

/// The company list for step 1 of the picker.
final customerListProvider = FutureProvider.autoDispose<List<Customer>>((ref) {
  return ref.watch(customerDeviceRepositoryProvider).listCustomers();
});

/// Step 2: devices belonging to the company picked in step 1.
final customerDevicesProvider = FutureProvider.autoDispose
    .family<List<Device>, String>((ref, customerId) {
      return ref
          .watch(customerDeviceRepositoryProvider)
          .listDevicesForCustomer(customerId);
    });
