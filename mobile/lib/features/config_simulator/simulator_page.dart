import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import 'config_repository.dart';
import 'simulator_repository.dart';

String _configLabel(DeviceConfigDraft c) {
  final model = c.deviceModel ?? '?';
  final protocol = c.protocol ?? '?';
  final status = c.status == null ? '?' : _configStatusLabel(c.status!);
  return '$model/$protocol · $status';
}

String _configStatusLabel(ConfigStatus status) => switch (status) {
  ConfigStatus.draft => 'draft',
  ConfigStatus.testing => 'testing',
  ConfigStatus.approved => 'approved',
  ConfigStatus.rejected => 'rejected',
  ConfigStatus.synced => 'synced',
};

class SimulatorPage extends ConsumerStatefulWidget {
  const SimulatorPage({super.key});

  @override
  ConsumerState<SimulatorPage> createState() => _SimulatorPageState();
}

class _SimulatorPageState extends ConsumerState<SimulatorPage> {
  String? _selectedDeviceId;
  String? _selectedConfigId;
  bool _running = false;
  DeviceSimulateConfigResult? _result;
  String? _error;

  Future<void> _run() async {
    final configId = _selectedConfigId;
    final deviceId = _selectedDeviceId;
    if (configId == null || deviceId == null) return;
    setState(() {
      _running = true;
      _result = null;
      _error = null;
    });
    try {
      final result = await ref
          .read(simulatorRepositoryProvider)
          .simulate(deviceId: deviceId, configId: configId);
      if (!mounted) return;
      setState(() {
        _running = false;
        _result = result;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _running = false;
        _error = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final deviceIdsAsync = ref.watch(assignedDeviceIdListProvider);
    final configsAsync = ref.watch(deployableConfigListProvider);
    final result = _result;

    final canRun =
        !_running && _selectedDeviceId != null && _selectedConfigId != null;

    return Scaffold(
      appBar: AppBar(title: const Text('ทดสอบความพร้อม Config')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('อุปกรณ์', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          _DeviceDropdown(
            async: deviceIdsAsync,
            value: _selectedDeviceId,
            onChanged: (v) => setState(() => _selectedDeviceId = v),
          ),
          const SizedBox(height: 20),
          const Text('Config', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          _ConfigDropdown(
            async: configsAsync,
            value: _selectedConfigId,
            onChanged: (v) => setState(() => _selectedConfigId = v),
          ),
          const SizedBox(height: 20),
          FilledButton(
            key: const Key('simulator_run'),
            onPressed: canRun ? _run : null,
            child: _running
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('ทดสอบความพร้อม'),
          ),
          const SizedBox(height: 24),
          if (_error != null) _ErrorCard(message: _error!),
          if (result != null) _ResultCard(result: result),
        ],
      ),
    );
  }
}

class _DeviceDropdown extends StatelessWidget {
  const _DeviceDropdown({
    required this.async,
    required this.value,
    required this.onChanged,
  });

  final AsyncValue<List<String>> async;
  final String? value;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return async.when(
      loading: () => const _DropdownSkeleton(),
      error: (error, _) => _InlineMessage(
        key: const Key('simulator_device_error'),
        message: error is ApiException
            ? error.message
            : 'โหลดรายการอุปกรณ์ไม่สำเร็จ',
        isError: true,
      ),
      data: (ids) {
        if (ids.isEmpty) {
          return const _InlineMessage(
            key: Key('simulator_device_empty'),
            message:
                'คุณไม่มีอุปกรณ์ที่ถูกมอบหมายตอนนี้ (ดูจากงานที่มีเลขเครื่องผูกอยู่)',
            isError: false,
          );
        }
        final safeValue = ids.contains(value) ? value : null;
        return InputDecorator(
          decoration: const InputDecoration(border: OutlineInputBorder()),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              key: const Key('simulator_device_dropdown'),
              value: safeValue,
              isExpanded: true,
              hint: const Text('เลือกอุปกรณ์'),
              items: [
                for (final id in ids)
                  DropdownMenuItem(value: id, child: Text(id)),
              ],
              onChanged: onChanged,
            ),
          ),
        );
      },
    );
  }
}

class _ConfigDropdown extends StatelessWidget {
  const _ConfigDropdown({
    required this.async,
    required this.value,
    required this.onChanged,
  });

  final AsyncValue<List<DeviceConfigDraft>> async;
  final String? value;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return async.when(
      loading: () => const _DropdownSkeleton(),
      error: (error, _) => _InlineMessage(
        key: const Key('simulator_config_error'),
        message: error is ApiException
            ? error.message
            : 'โหลดรายการ Config ไม่สำเร็จ',
        isError: true,
      ),
      data: (configs) {
        if (configs.isEmpty) {
          return const _InlineMessage(
            key: Key('simulator_config_empty'),
            message:
                'ไม่มี Config ที่พร้อมทดสอบตอนนี้ '
                '(ต้องเป็นสถานะ approved หรือ synced — ผ่านการอนุมัติแล้ว)',
            isError: false,
          );
        }
        final ids = configs.map((c) => c.id).whereType<String>().toSet();
        final safeValue = ids.contains(value) ? value : null;
        return InputDecorator(
          decoration: const InputDecoration(border: OutlineInputBorder()),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              key: const Key('simulator_config_dropdown'),
              value: safeValue,
              isExpanded: true,
              hint: const Text('เลือก Config'),
              items: [
                for (final c in configs)
                  if (c.id != null)
                    DropdownMenuItem(value: c.id, child: Text(_configLabel(c))),
              ],
              onChanged: onChanged,
            ),
          ),
        );
      },
    );
  }
}

class _DropdownSkeleton extends StatelessWidget {
  const _DropdownSkeleton();

  @override
  Widget build(BuildContext context) {
    return const InputDecorator(
      decoration: InputDecoration(border: OutlineInputBorder()),
      child: SizedBox(
        height: 20,
        child: Align(
          alignment: Alignment.centerLeft,
          child: SizedBox(
            height: 16,
            width: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      ),
    );
  }
}

class _InlineMessage extends StatelessWidget {
  const _InlineMessage({
    super.key,
    required this.message,
    required this.isError,
  });

  final String message;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = isError ? scheme.error : Theme.of(context).hintColor;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          isError ? Icons.error_outline : Icons.info_outline,
          size: 18,
          color: color,
        ),
        const SizedBox(width: 6),
        Expanded(
          child: Text(message, style: TextStyle(color: color)),
        ),
      ],
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      key: const Key('simulator_run_error'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.error_outline, color: scheme.error),
            const SizedBox(width: 8),
            Expanded(child: Text(message)),
          ],
        ),
      ),
    );
  }
}

/// ผลจาก `POST /devices/{deviceId}/simulate-config` — หัวข้อรวม (`result.passed`)
/// แล้วแยกแสดง 3 ส่วน (Config / ความเข้ากันได้ / สัญญาณอุปกรณ์) พร้อม
/// pass-fail + details ของแต่ละส่วน.
class _ResultCard extends StatelessWidget {
  const _ResultCard({required this.result});

  final DeviceSimulateConfigResult result;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final conn = result.connectionCheck;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  result.passed ? Icons.check_circle : Icons.cancel,
                  color: result.passed ? Colors.green : scheme.error,
                ),
                const SizedBox(width: 8),
                Text(
                  result.passed ? 'พร้อมติดตั้ง' : 'ยังไม่พร้อมติดตั้ง',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
            const Divider(height: 24),
            _CheckBlock(
              label: 'Config',
              passed: result.configCheck.passed,
              details: result.configCheck.details,
            ),
            const SizedBox(height: 12),
            _CheckBlock(
              label: 'ความเข้ากันได้กับอุปกรณ์',
              passed: result.compatibilityCheck.passed,
              details: result.compatibilityCheck.details,
            ),
            const SizedBox(height: 12),
            _CheckBlock(
              label: 'สัญญาณอุปกรณ์',
              passed: conn.passed,
              details: [
                'แรงสัญญาณ: ${conn.signalStrength} dBm',
                ...conn.details,
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// หนึ่งส่วนย่อยของ [_ResultCard] — label + pass/fail ของตัวเอง + bullet details.
class _CheckBlock extends StatelessWidget {
  const _CheckBlock({
    required this.label,
    required this.passed,
    required this.details,
  });

  final String label;
  final bool passed;
  final List<String> details;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(
              passed ? Icons.check_circle_outline : Icons.cancel_outlined,
              size: 18,
              color: passed ? Colors.green : scheme.error,
            ),
            const SizedBox(width: 6),
            Text(
              '$label — ${passed ? 'ผ่าน' : 'ไม่ผ่าน'}',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ],
        ),
        for (final line in details)
          Padding(
            padding: const EdgeInsets.only(left: 24, top: 4),
            child: Text('• $line'),
          ),
      ],
    );
  }
}
