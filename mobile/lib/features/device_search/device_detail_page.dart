import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/realtime/live_refresh.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_fade_in.dart';
import '../../core/ui/app_info_row.dart';
import '../../core/ui/app_ink_header.dart';
import '../../core/ui/app_notice.dart';
import '../../core/ui/app_skeleton.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/ui/labels.dart';
import '../../core/ui/status_tones.dart';
import '../../core/widgets/app_error_view.dart';
import '../config_override/config_override_repository.dart';
import '../config_override/pending_config_override_banner.dart';
import '../firmware_override/pending_firmware_override_banner.dart';
import '../task/apply_mode_provider.dart';
import '../task/config_apply_request_repository.dart';
import '../task/field_task_repository.dart';
import '../task/task_repository.dart';
import 'device_central_repository.dart';
import 'device_history_repository.dart';
import 'device_online.dart';
import 'device_search_repository.dart';
import 'device_status_repository.dart';

String _formatDate(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

/// สถานะเครื่องเป็นคำที่ช่างอ่านเข้าใจ (ภาพ r4) — หน้าอื่นยังใช้ [deviceLifecycleLabel]
String _lifecycleText(DeviceLifecycleStatus status) => switch (status) {
  DeviceLifecycleStatus.registered => 'ลงทะเบียนแล้ว ยังไม่ติดตั้ง',
  DeviceLifecycleStatus.installed => 'ติดตั้งแล้ว',
  DeviceLifecycleStatus.decommissioned => 'ปลดระวางแล้ว',
};

String _statusErrorMessage(Object error) {
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

/// "รายละเอียดอุปกรณ์" (R4-04 · ภาพ r4 0175–0264) — หัวพื้นเข้มบอกเลขเครื่อง รุ่น
/// และซิม · การ์ด "สถานะเครื่อง" · คำเตือนที่เกี่ยวข้อง · ปุ่มหลัก "ขอส่ง Config /
/// Firmware" และปุ่มรองตามสิทธิ์ · ทางลัดเป็นการ์ดเล็ก · ข้อมูลเครื่องเต็มอยู่ท้ายหน้า
///
/// สิทธิ์และโหมดคงเดิม (docs/29 §2): ขอแก้ค่าเฉพาะเครื่อง = ST เท่านั้น · ยืนยันติดตั้ง
/// Firmware/Firmware Override เฉพาะโหมด legacy · Operation ดูอย่างเดียว ·
/// "เริ่มงาน/ไปที่งาน" (docs/28) อยู่ในทางลัดของช่าง · ส่งค่าเข้ากล่องได้เฉพาะเครื่อง
/// ที่ติดตั้งแล้ว และ backend ยังเป็นผู้ตรวจจริงทุกครั้ง
class DeviceDetailPage extends ConsumerWidget {
  const DeviceDetailPage({super.key, required this.deviceId});

  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final role = ref.watch(authControllerProvider.select((s) => s.role));
    final isSt = role == UserRole.st;
    final isFieldStaff = isSt || role == UserRole.ot;
    final deviceAsync = ref.watch(deviceDetailProvider(deviceId));
    final navigator = Navigator.of(context);
    final device = deviceAsync.valueOrNull;
    return LiveRefresh(
      interval: const Duration(seconds: 10),
      onRefresh: () async {
        await Future.wait([
          ref.refresh(deviceCentralProvider(deviceId).future),
          ref.refresh(deviceStatusProvider(deviceId).future),
          if (isSt) ref.refresh(currentConfigProvider(deviceId).future),
          if (isFieldStaff) ...[
            ref.refresh(openTaskForDeviceProvider(deviceId).future),
            ref.refresh(deviceApplyOptionsProvider(deviceId).future),
          ],
        ]);
      },
      child: AppV2Theme(
        child: Scaffold(
          backgroundColor: AppColors.background,
          body: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppInkHeader(
                title: deviceId,
                subtitle: device == null
                    ? null
                    : '${device.deviceModel} · ซิม ${device.simNumber}',
                onBack: navigator.canPop() ? navigator.pop : null,
              ),
              Expanded(
                child: deviceAsync.when(
                  skipLoadingOnRefresh: true,
                  data: (device) => AppFadeIn(
                    child: _DeviceDetailView(
                      device: device,
                      deviceId: deviceId,
                    ),
                  ),
                  loading: () => const AppDetailSkeleton(
                    lines: 6,
                    padding: EdgeInsets.fromLTRB(18, 16, 18, 16),
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

class _DeviceDetailView extends ConsumerWidget {
  const _DeviceDetailView({required this.device, required this.deviceId});

  final Device device;
  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final role = ref.watch(authControllerProvider).role;
    final isSt = role == UserRole.st;
    // ยืนยันติดตั้ง Firmware (issue #261) และ Field Report (#236): backend เปิดให้ ST และ OT
    final isFieldStaff = isSt || role == UserRole.ot;
    // docs/27 §9 (B3) — โหมด central ส่ง Firmware ผ่านคำขอ ปุ่มยืนยันติดตั้ง/Override
    // แบบเดิมไม่ได้ส่งอะไรเข้ากล่องจริง จึงซ่อน · ยังไม่รู้โหมด = แสดงตามเดิม
    final centralMode = isFieldStaff
        ? ref.watch(centralApplyModeProvider).valueOrNull ?? false
        : false;
    // docs/28 — งานที่ช่างเปิดอยู่ของกล่องนี้ ("เริ่มงาน" → "ไปที่งาน")
    final openTask = isFieldStaff
        ? ref.watch(openTaskForDeviceProvider(deviceId)).valueOrNull
        : null;
    final installed = device.status == DeviceLifecycleStatus.installed;
    final installedAt = device.installedAt;

    Future<void> openApply() async {
      await context.push(AppRoutes.deviceApply(deviceId));
      ref.invalidate(openTaskForDeviceProvider(deviceId));
      ref.invalidate(deviceApplyOptionsProvider(deviceId));
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 32),
      children: [
        _StatusCard(device: device, deviceId: deviceId),
        const SizedBox(height: 14),
        // UX audit #2 — เฉพาะ ST (role เดียวที่ขอ Config Override ได้ จึงไม่
        // ยิง GET /devices/{id}/config ให้ role อื่นโดยไม่จำเป็น)
        if (isSt) _PendingConfigOverride(deviceId: deviceId),
        _PendingFirmwareOverride(deviceId: deviceId),
        if (isFieldStaff) _OpenRequestNotice(deviceId: deviceId, isSt: isSt),
        if (isFieldStaff && !installed) ...[
          const AppNotice(
            key: Key('device_detail_not_installed'),
            tone: AppBadgeTone.warning,
            icon: Icons.warning_amber_rounded,
            title: 'เครื่องยังไม่ติดตั้ง',
            child: Text('ส่งค่าเข้ากล่องได้เฉพาะเครื่องที่ติดตั้งแล้ว'),
          ),
          const SizedBox(height: 14),
        ],
        if (!isFieldStaff) ...[
          const AppNotice(
            key: Key('device_detail_view_only'),
            tone: AppBadgeTone.info,
            icon: Icons.person_outline,
            title: 'ดูอย่างเดียว',
            child: Text(
              'Operation อนุมัติคำขอบน Web · แอปนี้ไม่มีปุ่มส่งค่าให้ Operation',
            ),
          ),
          const SizedBox(height: 14),
        ],
        if (isFieldStaff) ...[
          // docs/28 §6 — ปุ่มหลัก: เลือก Config/Firmware (เริ่มงานให้อัตโนมัติ)
          _ActionButton(
            key: const Key('device_detail_upload'),
            label: 'ขอส่ง Config / Firmware',
            icon: Icons.near_me_outlined,
            primary: true,
            onPressed: installed ? openApply : null,
          ),
          if (isSt)
            // UX audit #2 — กลับมาจากหน้าขอ Override แล้วโหลดคำขอที่รออยู่ใหม่
            _ActionButton(
              key: const Key('device_detail_config_override'),
              label: 'ขอแก้ค่าเฉพาะเครื่อง',
              icon: Icons.tune,
              onPressed: installed
                  ? () => _pushThenRefresh(
                      context,
                      ref,
                      deviceId: deviceId,
                      path: AppRoutes.deviceConfigOverride(deviceId),
                    )
                  : null,
            ),
          if (!centralMode) ...[
            // issue #261 — ยืนยันว่าติดตั้ง Firmware เข้าเครื่องเสร็จแล้ว (ST/OT)
            _ActionButton(
              key: const Key('device_detail_confirm_firmware'),
              label: 'ยืนยันติดตั้ง Firmware (ช่างยืนยันเอง)',
              icon: Icons.check,
              onPressed: () =>
                  context.push(AppRoutes.deviceConfirmFirmware(deviceId)),
            ),
            // issue #256 — ทางขอ Firmware Override เมื่อ Firmware ที่ต้องการ
            // ติดตั้งไม่ตรงแผน Campaign
            if (isSt)
              _ActionButton(
                key: const Key('device_detail_firmware_override'),
                label: 'ขอ Firmware Override',
                icon: Icons.memory,
                onPressed: () => _pushThenRefresh(
                  context,
                  ref,
                  deviceId: deviceId,
                  path: AppRoutes.deviceFirmwareOverride(deviceId),
                ),
              ),
          ],
          const SizedBox(height: 2),
        ],
        _ShortcutGrid(
          tiles: [
            if (isFieldStaff)
              _Shortcut(
                key: const Key('device_detail_field_report'),
                label: 'แจ้งปัญหา',
                icon: Icons.add,
                tint: AppColors.warningSubtle,
                onTap: () => context.push(
                  Uri(
                    path: AppRoutes.incidentReport,
                    queryParameters: {'deviceId': deviceId},
                  ).toString(),
                ),
              ),
            _Shortcut(
              key: const Key('device_detail_incidents'),
              label: 'Incidents',
              icon: Icons.warning_amber_outlined,
              onTap: () => context.go(AppRoutes.incidents),
            ),
            _Shortcut(
              key: const Key('device_detail_history'),
              label: 'ประวัติเครื่อง',
              icon: Icons.history,
              onTap: () => context.push(AppRoutes.deviceHistory(deviceId)),
            ),
            // docs/28 §6 — ช่างเริ่มงานเอง · มีงานเปิดอยู่แล้ว = ไปที่งานนั้นเลย
            if (isFieldStaff)
              _Shortcut(
                key: const Key('device_detail_start_task'),
                label: openTask == null ? 'เริ่มงาน' : 'รายละเอียดงาน',
                icon: openTask == null
                    ? Icons.play_circle_outline
                    : Icons.assignment_outlined,
                onTap: () => openTask == null
                    ? _startTask(context, ref, deviceId)
                    : context.push(AppRoutes.taskDetail(openTask.id)),
              ),
          ],
        ),
        const SizedBox(height: 22),
        _DeviceInfoCard(device: device, installedAt: installedAt),
      ],
    );
  }
}

class _DeviceInfoCard extends StatefulWidget {
  const _DeviceInfoCard({required this.device, required this.installedAt});

  final Device device;
  final DateTime? installedAt;

  @override
  State<_DeviceInfoCard> createState() => _DeviceInfoCardState();
}

class _DeviceInfoCardState extends State<_DeviceInfoCard> {
  var _expanded = false;

  @override
  Widget build(BuildContext context) {
    final device = widget.device;
    final details = <(String, String?)>[
      ('โปรโตคอล', device.protocol),
      ('IMEI', device.imei),
      ('Serial Number', device.serialNumber),
      ('Blackbox ID', device.blackboxId),
      ('Hardware revision', device.hardwareRevisionCode),
      ('Bootloader', device.bootloader),
      ('ลงทะเบียนเมื่อ', _formatDate(device.registeredAt)),
    ];
    final missing = details
        .where((row) => row.$2 == null || row.$2!.trim().isEmpty)
        .map((row) => row.$1)
        .toList();

    return AppCard(
      key: const Key('device_detail_info'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _CardTitle('ข้อมูลอุปกรณ์'),
          AppInfoRow(label: 'รุ่น', value: device.deviceModel),
          AppInfoRow(label: 'เบอร์ซิม', value: device.simNumber),
          AppInfoRow(
            label: 'ติดตั้งเมื่อ',
            value: widget.installedAt == null
                ? null
                : _formatDate(widget.installedAt!),
          ),
          AppInfoRow(label: 'ลูกค้า', value: device.customer?.companyName),
          if (_expanded) ...[
            for (final (label, value) in details)
              if (value != null && value.trim().isNotEmpty)
                AppInfoRow(label: label, value: value),
            if (missing.isNotEmpty)
              AppInfoRow(
                key: const Key('device_detail_info_missing'),
                label: 'ยังไม่มีข้อมูล',
                value: missing.join(', '),
              ),
          ],
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              key: Key(
                _expanded
                    ? 'device_detail_info_collapse'
                    : 'device_detail_info_expand',
              ),
              onPressed: () => setState(() => _expanded = !_expanded),
              icon: Icon(_expanded ? Icons.expand_less : Icons.expand_more),
              label: Text(_expanded ? 'ย่อ' : 'ดูทั้งหมด'),
            ),
          ),
        ],
      ),
    );
  }
}

/// การ์ดสถานะรวมข้อมูลที่กล่องรายงานกับสถานะ payload ไว้ด้วยกัน
class _StatusCard extends ConsumerWidget {
  const _StatusCard({required this.device, required this.deviceId});

  final Device device;
  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statusAsync = ref.watch(deviceStatusProvider(deviceId));
    final status = statusAsync.valueOrNull;
    final central = ref.watch(deviceCentralProvider(deviceId)).valueOrNull;
    final history = ref.watch(deviceHistoryProvider(deviceId)).valueOrNull;
    final online = central?.reachable == true && central?.device != null
        ? DeviceOnline(
            online: central!.device!.online,
            lastSeenAt: central.device!.lastSeenAt,
            fromCentral: true,
          )
        : status == null
        ? null
        : DeviceOnline.resolve(status, central);
    final onlineLabel = online == null || online.online == null
        ? 'ไม่ทราบ'
        : online.label;
    final onlineTone = online?.tone ?? AppBadgeTone.neutral;
    // ค่าที่กล่องรายงานก่อน (Server กลาง แล้วค่อย telemetry) · ไม่มีเลยใช้
    // `summary` ของประวัติเครื่อง
    final reportedFw = online?.fromCentral == true
        ? central?.device?.reportedFirmwareVersion
        : null;
    final firmware =
        reportedFw ??
        device.reportedFirmwareVersion ??
        history?.currentFirmwareVersion;
    return AppCard(
      key: const Key('device_detail_status_card'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Expanded(child: _CardTitle('สถานะเครื่อง')),
              AppBadge(
                key: const Key('device_detail_lifecycle'),
                label: _lifecycleText(device.status),
                tone: device.status == DeviceLifecycleStatus.installed
                    ? AppBadgeTone.success
                    : AppBadgeTone.neutral,
                dot: true,
              ),
            ],
          ),
          // ชื่อ Config/Firmware แสดงเสมอ · เฉพาะป้ายสถานะที่รอ `/status`
          _StatusPayloadRows(
            status: status,
            isOnline: online?.online == true,
            onlineLabel: onlineLabel,
            onlineTone: onlineTone,
            configName: history?.currentConfigName,
            firmware: firmware,
            reportedConfigVersion: central?.reachable == true
                ? central?.device?.reportedConfigVersion
                : null,
            lastSeenAt: online?.lastSeenAt,
          ),
          statusAsync.when(
            skipLoadingOnRefresh: true,
            skipError: true,
            data: (_) => const SizedBox.shrink(),
            loading: () => const AppDetailSkeleton(
              key: Key('device_status_loading'),
              lines: 2,
              padding: EdgeInsets.zero,
            ),
            error: (error, _) => AppErrorView(
              compact: true,
              message: _statusErrorMessage(error),
              onRetry: () {
                ref.invalidate(deviceStatusProvider(deviceId));
                ref.invalidate(deviceCentralProvider(deviceId));
              },
              messageKey: const Key('device_status_error'),
              retryKey: const Key('device_status_retry'),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusPayloadRows extends StatelessWidget {
  const _StatusPayloadRows({
    required this.status,
    required this.isOnline,
    required this.onlineLabel,
    required this.onlineTone,
    required this.configName,
    required this.firmware,
    required this.reportedConfigVersion,
    required this.lastSeenAt,
  });

  final DeviceStatus? status;
  final bool isOnline;
  final String onlineLabel;
  final AppBadgeTone onlineTone;
  final String? configName;
  final String? firmware;
  final int? reportedConfigVersion;
  final DateTime? lastSeenAt;

  @override
  Widget build(BuildContext context) {
    final deviceStatus = status;
    final connection = _StatusTile(
      label: 'การเชื่อมต่อ',
      value: Row(
        children: [
          if (isOnline) ...[const _OnlinePulseDot(), const SizedBox(width: 6)],
          Flexible(
            child: AppBadge(
              key: const Key('device_online_row'),
              label: onlineLabel,
              tone: onlineTone,
              dot: false,
            ),
          ),
        ],
      ),
      footnoteWidget: lastSeenAt == null ? null : _RelativeTime(lastSeenAt!),
    );
    final firmwareTile = _StatusTile(
      key: const Key('device_detail_firmware'),
      label: 'Firmware',
      value: Text(firmware ?? 'ไม่ทราบ', style: _statusValueStyle),
      badge: deviceStatus == null
          ? null
          : AppBadge(
              label: devicePayloadLabel(
                deviceStatus.firmwareStatus,
                firmware: true,
              ),
              tone: devicePayloadTone(deviceStatus.firmwareStatus),
              dot: true,
            ),
    );
    // ตัวอักษรใหญ่เกิน 1.3 เท่า ช่องครึ่งจอแคบจนคำถูกตัดกลาง จึงซ้อนแนวตั้ง
    final largeText = MediaQuery.textScalerOf(context).scale(10) > 13;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (largeText) ...[
          connection,
          const SizedBox(height: 8),
          firmwareTile,
        ] else
          // ช่องสูงเท่ากัน — Row แบบ stretch ใน ListView ต้องมีความสูงจำกัด
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: connection),
                const SizedBox(width: 8),
                Expanded(child: firmwareTile),
              ],
            ),
          ),
        const SizedBox(height: 8),
        _StatusTile(
          key: const Key('device_detail_current_config'),
          label: 'Config ปัจจุบัน',
          value: Text(
            configName?.trim().isNotEmpty == true ? configName! : '—',
            style: _statusValueStyle,
          ),
          footnote: reportedConfigVersion == null
              ? null
              : 'ในกล่องเป็นรุ่นที่ $reportedConfigVersion',
          badge: deviceStatus == null
              ? null
              : AppBadge(
                  label: devicePayloadLabel(
                    deviceStatus.configStatus,
                    firmware: false,
                  ),
                  tone: devicePayloadTone(deviceStatus.configStatus),
                  dot: true,
                ),
        ),
      ],
    );
  }
}

const _statusValueStyle = TextStyle(
  fontSize: AppTypography.base,
  height: AppTypography.baseHeight,
  fontWeight: FontWeight.w700,
  color: AppColors.foreground,
);

class _StatusTile extends StatelessWidget {
  const _StatusTile({
    super.key,
    required this.label,
    required this.value,
    this.footnote,
    this.footnoteWidget,
    this.badge,
  });
  final String label;
  final Widget value;
  final String? footnote;
  final Widget? footnoteWidget;
  final Widget? badge;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: AppColors.background,
      borderRadius: BorderRadius.circular(AppRadius.md),
    ),
    child: Padding(
      padding: const EdgeInsets.all(11),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: AppTypography.xs,
              color: AppColors.mutedForeground,
            ),
          ),
          const SizedBox(height: 3),
          value,
          if (footnote != null) ...[
            const SizedBox(height: 3),
            Text(
              footnote!,
              style: const TextStyle(
                fontSize: AppTypography.xs,
                color: AppColors.mutedForeground,
              ),
            ),
          ],
          if (footnoteWidget != null) ...[
            const SizedBox(height: 3),
            footnoteWidget!,
          ],
          if (badge != null) ...[const SizedBox(height: 4), badge!],
        ],
      ),
    ),
  );
}

class _RelativeTime extends StatefulWidget {
  const _RelativeTime(this.at);
  final DateTime at;
  @override
  State<_RelativeTime> createState() => _RelativeTimeState();
}

class _RelativeTimeState extends State<_RelativeTime> {
  Timer? _timer;
  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Text(
    'ติดต่อ${_relativeTime(widget.at)}',
    key: const Key('device_detail_last_seen'),
    style: const TextStyle(
      fontSize: AppTypography.xs,
      color: AppColors.mutedForeground,
    ),
  );
}

class _OnlinePulseDot extends StatefulWidget {
  const _OnlinePulseDot();
  @override
  State<_OnlinePulseDot> createState() => _OnlinePulseDotState();
}

class _OnlinePulseDotState extends State<_OnlinePulseDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  var _reduced = false;
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final disabled = MediaQuery.disableAnimationsOf(context);
    if (_reduced == disabled) return;
    _reduced = disabled;
    if (disabled) {
      _controller.stop();
    } else {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _controller,
    builder: (context, _) => Container(
      width: 9,
      height: 9,
      decoration: BoxDecoration(
        color: AppColors.success,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: AppColors.success.withValues(
              alpha: _reduced ? 0 : (1 - _controller.value) * .4,
            ),
            spreadRadius: _reduced ? 0 : _controller.value * 5,
            blurRadius: 4,
          ),
        ],
      ),
    ),
  );
}

/// เวลาติดต่อล่าสุดแบบอ่านเร็ว · เกิน 1 วันใช้วันเวลาจริง ("3 วันที่แล้ว"
/// ช่วยช่างน้อยกว่าวันที่ที่เอาไปเทียบกับบันทึกอื่นได้)
String _relativeTime(DateTime at) {
  final minutes = DateTime.now().difference(at).inMinutes;
  if (minutes < 1) return 'เมื่อสักครู่';
  if (minutes < 60) return ' $minutes นาทีที่แล้ว';
  final hours = minutes ~/ 60;
  if (hours < 24) return ' $hours ชั่วโมงที่แล้ว';
  final t = at.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return 'เมื่อ ${two(t.day)}/${two(t.month)} ${two(t.hour)}:${two(t.minute)}';
}

/// คำขอส่ง Config/Firmware ที่ยังไม่จบของกล่องนี้ (`apply-options.openRequest`) —
/// มี `taskId` = งานของผู้ใช้เอง (เปิดคำขอได้) · ไม่มี = งานของช่างคนอื่น ·
/// โหลดไม่ได้/ไม่มีคำขอ = ไม่แสดงอะไร (ข้อมูลเสริม)
///
/// โหมด central คำขอแก้ค่า (Override) อยู่ในคำขอส่งเข้ากล่องตัวเดียวกัน — ST
/// เห็น "ขอแก้ / เหตุผล" ในแถบนี้แถบเดียว ([_PendingConfigOverride] ไม่แสดงซ้ำ)
class _OpenRequestNotice extends ConsumerWidget {
  const _OpenRequestNotice({required this.deviceId, required this.isSt});

  final String deviceId;
  final bool isSt;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final request = ref
        .watch(deviceApplyOptionsProvider(deviceId))
        .valueOrNull
        ?.openRequest;
    if (request == null) return const SizedBox.shrink();
    // GET /devices/{id}/config ยิงเฉพาะ ST (role เดียวที่ขอ Override ได้)
    final override = isSt && request.kind == FieldApplyKind.config
        ? ref
              .watch(currentConfigProvider(deviceId))
              .valueOrNull
              ?.pendingOverride
        : null;
    final pendingOverride = override?.status == 'pending' ? override : null;
    final configName = request.configName;
    final firmwareVersion = request.firmwareVersion;
    final subject = request.kind == FieldApplyKind.firmware
        ? (firmwareVersion == null ? 'Firmware' : 'Firmware v$firmwareVersion')
        : (configName == null ? 'Config' : 'Config “$configName”');
    final taskId = request.taskId;
    final mine = taskId != null;
    final status = mine
        ? configApplyRequestStatusLabel(request.status, kind: request.kind)
        : 'รอผู้ถืองานกดส่ง';
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: AppNotice(
        key: const Key('device_detail_open_request'),
        tone: AppBadgeTone.warning,
        icon: Icons.hourglass_empty,
        title: 'มีคำขอที่ยังไม่จบ · $status',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              mine
                  ? '$subject ในงานของคุณ'
                  : '$subject ในงานของช่างคนอื่น — ขอใหม่ได้เมื่อคำขอนี้จบ',
            ),
            if (pendingOverride != null) ...[
              if (pendingOverride.fields.isNotEmpty)
                Text(
                  'ขอแก้: ${pendingOverride.fields.keys.join(', ')}',
                  key: const Key('device_detail_open_request_fields'),
                ),
              Text('เหตุผล: ${pendingOverride.reason}'),
            ],
            if (mine) ...[
              const SizedBox(height: 10),
              OutlinedButton(
                key: const Key('device_detail_open_request_go'),
                onPressed: () => context.push(AppRoutes.taskDetail(taskId)),
                child: const Text('เปิดคำขอ'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    super.key,
    required this.label,
    required this.icon,
    required this.onPressed,
    this.primary = false,
  });

  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(AppRadius.full),
    );
    const padding = EdgeInsets.symmetric(horizontal: 18, vertical: 14);
    final child = Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(icon, size: 20),
        const SizedBox(width: 10),
        Flexible(
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: primary
          ? FilledButton(
              onPressed: onPressed,
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: AppColors.primaryForeground,
                disabledBackgroundColor: AppColors.mutedForeground.withValues(
                  alpha: 0.55,
                ),
                disabledForegroundColor: AppColors.primaryForeground,
                minimumSize: const Size.fromHeight(52),
                padding: padding,
                shape: shape,
              ),
              child: child,
            )
          : OutlinedButton(
              onPressed: onPressed,
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.foreground,
                backgroundColor: AppColors.card,
                side: const BorderSide(color: AppColors.inputBorder),
                minimumSize: const Size.fromHeight(52),
                padding: padding,
                shape: shape,
              ),
              child: child,
            ),
    );
  }
}

class _Shortcut {
  const _Shortcut({
    required this.key,
    required this.label,
    required this.icon,
    required this.onTap,
    this.tint = AppColors.accent,
  });

  final Key key;
  final String label;
  final IconData icon;
  final VoidCallback onTap;
  final Color tint;
}

/// ทางลัดการ์ดเล็ก 2 คอลัมน์ (ภาพ r4) · ตัวอักษรใหญ่มากเหลือ 1 คอลัมน์ ไม่ให้คำถูกตัด
class _ShortcutGrid extends StatelessWidget {
  const _ShortcutGrid({required this.tiles});

  final List<_Shortcut> tiles;

  @override
  Widget build(BuildContext context) {
    final oneColumn = MediaQuery.textScalerOf(context).scale(1) >= 1.6;
    final rows = <Widget>[];
    final perRow = oneColumn ? 1 : 4;
    for (var i = 0; i < tiles.length; i += perRow) {
      final chunk = tiles.skip(i).take(perRow).toList();
      rows.add(
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var j = 0; j < perRow; j++) ...[
                  if (j > 0) const SizedBox(width: 10),
                  Expanded(
                    child: j < chunk.length
                        ? _ShortcutTile(tile: chunk[j])
                        : const SizedBox.shrink(),
                  ),
                ],
              ],
            ),
          ),
        ),
      );
    }
    return Column(children: rows);
  }
}

class _ShortcutTile extends StatelessWidget {
  const _ShortcutTile({required this.tile});

  final _Shortcut tile;

  @override
  Widget build(BuildContext context) {
    return Material(
      key: tile.key,
      color: AppColors.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: tile.onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 56),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: tile.tint,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    tile.icon,
                    size: 18,
                    color: AppColors.accentForeground,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    tile.label,
                    style: const TextStyle(
                      fontSize: 14,
                      height: 1.35,
                      fontWeight: FontWeight.w600,
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

/// "เริ่มงาน" (docs/28 §5.1) — `POST /tasks/start` แล้วไปหน้างาน · backend คืน
/// งานเดิมถ้ายังเปิดอยู่ (กดซ้ำไม่ได้งานซ้ำ) · ต้องออนไลน์ — ผิดพลาดแสดง
/// ข้อความของ backend ใน snackbar
Future<void> _startTask(
  BuildContext context,
  WidgetRef ref,
  String deviceId,
) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final result = await ref.read(fieldTaskRepositoryProvider).start(deviceId);
    ref.invalidate(taskListProvider);
    ref.invalidate(openTaskForDeviceProvider(deviceId));
    if (!context.mounted) return;
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            result.created ? 'เริ่มงานแล้ว' : 'เปิดงานที่ยังทำอยู่ของกล่องนี้',
          ),
        ),
      );
    await context.push(AppRoutes.taskDetail(result.task.id));
  } on ApiException catch (e) {
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text('เริ่มงานไม่สำเร็จ: ${e.message}')),
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
    // มีคำขอส่ง Config ค้างอยู่ = Override นี้อยู่ในคำขอนั้น (central) —
    // [_OpenRequestNotice] แสดงรวมไว้แล้ว ไม่แสดงซ้ำเป็นสองแถบ
    final openRequest = ref
        .watch(deviceApplyOptionsProvider(deviceId))
        .valueOrNull
        ?.openRequest;
    if (openRequest?.kind == FieldApplyKind.config) {
      return const SizedBox.shrink();
    }
    final central = ref.watch(centralApplyModeProvider).valueOrNull ?? false;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: PendingConfigOverrideBanner(pending: pending, central: central),
    );
  }
}

/// issue #256 — คำขอ Firmware Override ที่รอ Operation (PR #257)
class _PendingFirmwareOverride extends ConsumerWidget {
  const _PendingFirmwareOverride({required this.deviceId});

  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pending = ref
        .watch(deviceStatusProvider(deviceId))
        .valueOrNull
        ?.pendingFirmwareOverride;
    if (pending == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: PendingFirmwareOverrideBanner(pending: pending),
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
        fontSize: 16,
        height: 1.4,
        fontWeight: FontWeight.w700,
        color: AppColors.foreground,
      ),
    ),
  );
}
