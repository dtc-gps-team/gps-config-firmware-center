import '../../core/api/models.dart';
import '../../core/ui/app_page_header.dart';

/// เลขเครื่อง + รุ่น สำหรับ meta ของ `AppPageHeader` ในหน้าลูกของ Device Detail
/// (Firmware Override, ยืนยันติดตั้ง Firmware) — แทนบรรทัด "อุปกรณ์ … · รุ่น" ที่แต่ละ
/// หน้าเขียนเองในเนื้อหา (docs/22 §6.2: ชื่อ record อยู่ใน meta) · ยังโหลดไม่เสร็จ = ว่าง
List<AppPageHeaderMeta> deviceHeaderMeta(Device? device) => [
  if (device != null) ...[
    AppPageHeaderMeta(label: 'อุปกรณ์', value: device.deviceId),
    if (device.deviceModel.isNotEmpty)
      AppPageHeaderMeta(label: 'รุ่น', value: device.deviceModel),
  ],
];
