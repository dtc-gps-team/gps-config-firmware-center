import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_info_row.dart';
import '../../core/ui/app_page_header.dart';
import '../../core/ui/app_fade_in.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/ui/labels.dart';
import '../../core/ui/status_tones.dart';
import '../../core/widgets/app_error_view.dart';
import '../config_override/config_override_repository.dart';
import '../config_override/pending_config_override_banner.dart';
import '../firmware_override/pending_firmware_override_banner.dart';
import 'device_search_repository.dart';
import 'device_status_repository.dart';

String _formatDate(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

/// "รายละเอียดอุปกรณ์" — one device from `GET /devices/{deviceId}`, opened from
/// a row on the search screen. Read-only aside from the action buttons: shows
/// the fields of the `Device` record itself, plus a "สถานะ Config / Firmware"
/// card from `GET /devices/{deviceId}/status` (issue #245, PR #247) that loads
/// and fails independently of the device record.
///
/// design system ใหม่ (docs/22 Batch 4): ป้ายสถานะเครื่อง + เลขเครื่องอยู่ใน
/// `AppPageHeader` (§6.2 — ชื่อ record อยู่ใน meta) · ปุ่มทั้งหมดย้ายขึ้น actions ของ
/// หัวหน้าจอ (role ที่ทำไม่ได้ = ซ่อน, ปุ่มหลักไว้ท้ายสุด) และเพิ่มปุ่ม "Field Report"
/// สำหรับ ST/OT ตามตารางหน้าใน docs/22 §8 / §7.2 (pre-fill อุปกรณ์ผ่าน `?deviceId=`
/// ที่ route รองรับอยู่แล้ว) · แถวข้อมูลเป็น `AppInfoRow` · ตรรกะ/การเรียก API เหมือนเดิม
class DeviceDetailPage extends ConsumerWidget {
  const DeviceDetailPage({super.key, required this.deviceId});

  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final deviceAsync = ref.watch(deviceDetailProvider(deviceId));
    final role = ref.watch(authControllerProvider).role;
    final isSt = role == UserRole.st;
    // ยืนยันติดตั้ง Firmware (issue #261) และ Field Report (#236): backend เปิดให้ ST และ OT
    final isFieldStaff = isSt || role == UserRole.ot;
    final navigator = Navigator.of(context);
    final device = deviceAsync.valueOrNull;

    return AppV2Theme(
      child: Scaffold(
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppPageHeader(
                title: 'รายละเอียดอุปกรณ์',
                onBack: navigator.canPop() ? navigator.pop : null,
                status: device == null
                    ? null
                    : AppBadge(
                        label: deviceLifecycleLabel(device.status),
                        tone: deviceLifecycleTone(device.status),
                        dot: true,
                      ),
                meta: [
                  if (device != null)
                    AppPageHeaderMeta(
                      label: 'เลขเครื่อง',
                      value: device.deviceId,
                    ),
                ],
                // ปุ่มแสดงหลังโหลดเครื่องสำเร็จเท่านั้น (เหมือนเดิมที่ปุ่มอยู่ในเนื้อหา) —
                // โหลดไม่ได้ (เช่น 404) ไม่มีอะไรให้สั่ง
                actions: device == null
                    ? const []
                    : [
                        // UX audit #2 — กลับมาจากหน้าขอ Override แล้วโหลดคำขอที่รออยู่ใหม่
                        AppPageHeaderAction(
                          key: const Key('device_detail_config_override'),
                          label: 'Config Override',
                          icon: Icons.tune,
                          visible: isSt,
                          onPressed: () => _pushThenRefresh(
                            context,
                            ref,
                            deviceId: deviceId,
                            path: AppRoutes.deviceConfigOverride(deviceId),
                          ),
                        ),
                        // issue #256 — ทางขอ Firmware Override เมื่อ Firmware ที่ต้องการ
                        // ติดตั้งไม่ตรงแผน Campaign (backend ตอบ 409 ที่ confirm-firmware-install)
                        AppPageHeaderAction(
                          key: const Key('device_detail_firmware_override'),
                          label: 'Firmware Override',
                          icon: Icons.system_update_alt,
                          visible: isSt,
                          onPressed: () => _pushThenRefresh(
                            context,
                            ref,
                            deviceId: deviceId,
                            path: AppRoutes.deviceFirmwareOverride(deviceId),
                          ),
                        ),
                        AppPageHeaderAction(
                          key: const Key('device_detail_field_report'),
                          label: 'Field Report',
                          icon: Icons.report_problem_outlined,
                          visible: isFieldStaff,
                          onPressed: () => context.push(
                            Uri(
                              path: AppRoutes.incidentReport,
                              queryParameters: {'deviceId': deviceId},
                            ).toString(),
                          ),
                        ),
                        // issue #261 — ยืนยันว่าติดตั้ง Firmware เข้าเครื่องเสร็จแล้ว (ST/OT)
                        AppPageHeaderAction(
                          key: const Key('device_detail_confirm_firmware'),
                          label: 'ยืนยันติดตั้ง Firmware',
                          icon: Icons.check_circle_outline,
                          primary: true,
                          visible: isFieldStaff,
                          onPressed: () => context.push(
                            AppRoutes.deviceConfirmFirmware(deviceId),
                          ),
                        ),
                      ],
              ),
              Expanded(
                child: deviceAsync.when(
                  skipLoadingOnRefresh: true,
                  data: (device) => AppFadeIn(
                    child: _DeviceDetailView(
                      device: device,
                      deviceId: deviceId,
                      isSt: isSt,
                    ),
                  ),
                  loading: () => const AppDetailSkeleton(
                    lines: 6,
                    padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                  ),
                  error: (error, _) => ListView(
                    children: [
                      const SizedBox(height: 64),
                      AppErrorView(
                        message: _errorMessage(error),
                        onRetry: () =>
                            ref.invalidate(deviceDetailProvider(deviceId)),
                        messageKey: const Key('device_detail_error'),
                        retryKey: const Key('device_detail_retry'),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
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
    final installedAt = device.installedAt;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
      children: [
        // UX audit #2 — เฉพาะ ST (role เดียวที่ขอ Config Override ได้ จึงไม่
        // ยิง GET /devices/{id}/config ให้ role อื่นโดยไม่จำเป็น)
        if (isSt) _PendingConfigOverride(deviceId: deviceId),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const _CardTitle('ข้อมูลอุปกรณ์'),
              AppInfoRow(label: 'เบอร์ซิม', value: device.simNumber),
              AppInfoRow(label: 'รุ่น', value: device.deviceModel),
              AppInfoRow(label: 'โปรโตคอล', value: device.protocol),
              AppInfoRow(label: 'IMEI', value: device.imei),
              AppInfoRow(label: 'Serial Number', value: device.serialNumber),
              AppInfoRow(label: 'Blackbox ID', value: device.blackboxId),
              AppInfoRow(
                label: 'ลงทะเบียนเมื่อ',
                value: _formatDate(device.registeredAt),
              ),
              AppInfoRow(
                label: 'ติดตั้งเมื่อ',
                value: installedAt == null ? null : _formatDate(installedAt),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const _CardTitle('ลูกค้า'),
              AppInfoRow(
                label: 'ชื่อบริษัท',
                value: device.customer?.companyName,
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        _StatusSection(deviceId: deviceId),
      ],
    );
  }
}

/// เปิดหน้าขอ Override แล้วโหลดคำขอที่รออยู่ใหม่เมื่อย้อนกลับมา (UX audit #2)
/// — คำขอ Config อยู่ใน `GET /devices/{id}/config` ส่วนคำขอ Firmware อยู่ใน
/// `GET /devices/{id}/status` จึง refresh ทั้งคู่
Future<void> _pushThenRefresh(
  BuildContext context,
  WidgetRef ref, {
  required String deviceId,
  required String path,
}) async {
  await context.push(path);
  if (!context.mounted) return;
  ref.invalidate(currentConfigProvider(deviceId));
  ref.invalidate(deviceStatusProvider(deviceId));
}

/// คำขอ Config Override ที่รอ Operation อนุมัติของเครื่องนี้ (UX audit #2) —
/// โหลดไม่ได้ (เช่น 404 เครื่องยังไม่มี Config) หรือยังโหลดอยู่ = ไม่แสดงอะไร
/// เพราะเป็นข้อมูลเสริม ไม่ควรบังข้อมูลอุปกรณ์ด้วย error
class _PendingConfigOverride extends ConsumerWidget {
  const _PendingConfigOverride({required this.deviceId});

  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pending = ref
        .watch(currentConfigProvider(deviceId))
        .valueOrNull
        ?.pendingOverride;
    if (pending == null || pending.status != 'pending') {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: PendingConfigOverrideBanner(pending: pending),
    );
  }
}

/// "สถานะ Config / Firmware" — `GET /devices/{deviceId}/status`. Has its own
/// loading / error (with retry) state so a failing status call never hides the
/// device record above it.
class _StatusSection extends ConsumerWidget {
  const _StatusSection({required this.deviceId});

  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statusAsync = ref.watch(deviceStatusProvider(deviceId));
    return statusAsync.when(
      skipLoadingOnRefresh: true,
      data: (status) {
        final pendingFw = status.pendingFirmwareOverride;
        final card = AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const _CardTitle('สถานะ Config / Firmware'),
              _PayloadRow(
                label: 'สถานะ Config',
                status: status.configStatus,
                firmware: false,
              ),
              _PayloadRow(
                label: 'สถานะ Firmware',
                status: status.firmwareStatus,
                firmware: true,
              ),
              // Placeholder: there is no online/offline signal yet — the
              // backend has no device check-in / `lastSeenAt` concept (issue
              // #245; design is tracked separately). Static "ไม่ทราบ" until
              // that design lands, then drive it from the response.
              const AppInfoRow(label: 'ออนไลน์/ออฟไลน์', value: 'ไม่ทราบ'),
              AppInfoRow(
                label: 'เช็คอินล่าสุด',
                value: status.lastCheckInMessage,
              ),
            ],
          ),
        );
        if (pendingFw == null) return card;
        // issue #256 — คำขอ Firmware Override ที่รอ Operation (PR #257)
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            PendingFirmwareOverrideBanner(pending: pendingFw),
            const SizedBox(height: 12),
            card,
          ],
        );
      },
      loading: () => const AppDetailSkeleton(
        key: Key('device_status_loading'),
        lines: 4,
        padding: EdgeInsets.zero,
      ),
      error: (error, _) => AppErrorView(
        compact: true,
        message: _errorMessage(error),
        onRetry: () => ref.invalidate(deviceStatusProvider(deviceId)),
        messageKey: const Key('device_status_error'),
        retryKey: const Key('device_status_retry'),
      ),
    );
  }

  static String _errorMessage(Object error) {
    if (error is ApiException) {
      switch (error.statusCode) {
        case 404:
          return 'ไม่พบสถานะอุปกรณ์นี้';
        case 403:
          return 'ไม่มีสิทธิ์ดูสถานะอุปกรณ์นี้';
        default:
          return error.message;
      }
    }
    return 'โหลดสถานะอุปกรณ์ไม่สำเร็จ';
  }
}

/// สถานะ payload เป็นป้าย `AppBadge` + dot ตาม tone ของ Web (docs/22 §5.2)
class _PayloadRow extends StatelessWidget {
  const _PayloadRow({
    required this.label,
    required this.status,
    required this.firmware,
  });

  final String label;
  final DevicePayloadStatus status;
  final bool firmware;

  @override
  Widget build(BuildContext context) {
    return AppInfoRow(
      label: label,
      child: AppBadge(
        label: devicePayloadLabel(status, firmware: firmware),
        tone: devicePayloadTone(status),
        dot: true,
      ),
    );
  }
}

class _CardTitle extends StatelessWidget {
  const _CardTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: AppTypography.sm,
        height: AppTypography.smHeight,
        fontWeight: FontWeight.w600,
        color: AppColors.foreground,
      ),
    ),
  );
}
