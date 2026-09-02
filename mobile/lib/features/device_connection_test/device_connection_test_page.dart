import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import 'device_connection_test_repository.dart';

/// "ทดสอบสัญญาณ" — ช่างหน้างาน (ST/OT) กรอกเลขเครื่องแล้วยิงไปที่
/// `POST /devices/{deviceId}/test-connection` (backend จริง จาก PR #54)
class DeviceConnectionTestPage extends ConsumerStatefulWidget {
  const DeviceConnectionTestPage({super.key});

  @override
  ConsumerState<DeviceConnectionTestPage> createState() =>
      _DeviceConnectionTestPageState();
}

class _DeviceConnectionTestPageState
    extends ConsumerState<DeviceConnectionTestPage> {
  final _deviceIdController = TextEditingController();

  bool _running = false;
  DeviceConnectionTestResult? _result;
  String? _error;

  @override
  void dispose() {
    _deviceIdController.dispose();
    super.dispose();
  }

  String get _deviceId => _deviceIdController.text.trim();

  Future<void> _run() async {
    setState(() {
      _running = true;
      _result = null;
      _error = null;
    });
    try {
      final result = await ref
          .read(deviceConnectionTestRepositoryProvider)
          .testConnection(_deviceId);
      if (!mounted) return;
      setState(() => _result = result);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = _messageFor(e));
    } finally {
      if (mounted) setState(() => _running = false);
    }
  }

  static String _messageFor(ApiException e) {
    switch (e.statusCode) {
      case 404:
        return 'ไม่พบอุปกรณ์ที่มีเลขเครื่องนี้ ตรวจสอบเลขเครื่องอีกครั้ง';
      case 409:
        return 'อุปกรณ์นี้ยังไม่ได้ติดตั้ง หรือถูกปลดระวางไปแล้ว ทดสอบสัญญาณไม่ได้';
      case 403:
        return 'ไม่มีสิทธิ์ทดสอบสัญญาณอุปกรณ์ (เฉพาะ ST/OT)';
      default:
        return e.message;
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    final error = _error;
    final canRun = !_running && _deviceId.isNotEmpty;

    return Scaffold(
      appBar: AppBar(title: const Text('ทดสอบสัญญาณ')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            key: const Key('device_id_input'),
            controller: _deviceIdController,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: 'เลขเครื่อง (Device ID)',
              hintText: 'เช่น DEV-001',
            ),
          ),
          const SizedBox(height: 24),
          FilledButton(
            key: const Key('test_connection_submit'),
            onPressed: canRun ? _run : null,
            child: _running
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('ทดสอบสัญญาณ'),
          ),
          const SizedBox(height: 24),
          if (error != null) _ErrorCard(message: error),
          if (result != null) _ResultCard(result: result),
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
      key: const Key('test_connection_error'),
      color: scheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(Icons.error_outline, color: scheme.onErrorContainer),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                message,
                style: TextStyle(color: scheme.onErrorContainer),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ResultCard extends StatelessWidget {
  const _ResultCard({required this.result});

  final DeviceConnectionTestResult result;

  static String _formatTime(DateTime dt) {
    final local = dt.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(local.hour)}:${two(local.minute)}:${two(local.second)}';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final passed = result.passed;
    return Card(
      key: const Key('test_connection_result'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  passed ? Icons.check_circle : Icons.cancel,
                  color: passed ? Colors.green : scheme.error,
                ),
                const SizedBox(width: 8),
                Text(
                  passed ? 'สัญญาณปกติ' : 'สัญญาณมีปัญหา',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              'ความแรงสัญญาณ: ${result.signalStrength} dBm',
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            const SizedBox(height: 8),
            for (final line in result.details)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text('• $line'),
              ),
            const SizedBox(height: 8),
            Text(
              'ทดสอบเมื่อ ${_formatTime(result.testedAt)}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}
