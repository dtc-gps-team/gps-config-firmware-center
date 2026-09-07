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
  SimulationResult? _result;
  String? _error;

  Future<void> _run() async {
    final configId = _selectedConfigId;
    if (configId == null || _selectedDeviceId == null) return;
    setState(() {
      _running = true;
      _result = null;
      _error = null;
    });
    try {
      final result = await ref
          .read(simulatorRepositoryProvider)
          .simulate(configId: configId);
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
    final configsAsync = ref.watch(simulatableConfigListProvider);
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
          const SizedBox(height: 16),
          const _PartialReadinessNotice(),
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
                'ไม่มี Config ที่พร้อมทดสอบตอนนี้ (ต้องเป็นสถานะ draft หรือ testing)',
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

/// **Phase 1 hint — do not remove without a real device+config compatibility
/// check to replace it.** `POST /config/{id}/simulate` only validates the
/// Config in isolation (see `SimulatorRepository` doc comment); it never
/// receives the device selected above, so this readiness check cannot catch
/// a config bound to the wrong deviceModel/protocol for that device.
class _PartialReadinessNotice extends StatelessWidget {
  const _PartialReadinessNotice();

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('simulator_partial_notice'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.amber.shade50,
        border: Border.all(color: Colors.amber.shade200),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 18, color: Colors.amber.shade800),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'ผลทดสอบนี้ตรวจแค่ว่า Config เองพร้อมไหม — ยังไม่ตรวจว่ารุ่น/โปรโตคอลของ Config '
              'ตรงกับอุปกรณ์ที่เลือกจริงหรือไม่ (รอ endpoint ตรวจความเข้ากันได้เพิ่มเติมจากทีม backend)',
              style: TextStyle(fontSize: 12, color: Colors.amber.shade900),
            ),
          ),
        ],
      ),
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

class _ResultCard extends StatelessWidget {
  const _ResultCard({required this.result});

  final SimulationResult result;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
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
                  result.passed ? 'ผ่าน' : 'ไม่ผ่าน',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
            const SizedBox(height: 12),
            for (final line in result.details)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text('• $line'),
              ),
          ],
        ),
      ),
    );
  }
}
