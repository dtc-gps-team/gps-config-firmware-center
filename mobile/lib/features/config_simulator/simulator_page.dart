import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/models.dart';
import 'simulator_repository.dart';

class SimulatorPage extends ConsumerStatefulWidget {
  const SimulatorPage({super.key});

  @override
  ConsumerState<SimulatorPage> createState() => _SimulatorPageState();
}

class _SimulatorPageState extends ConsumerState<SimulatorPage> {
  final _configIdController = TextEditingController(text: 'demo-config-1');
  final _deviceModelController = TextEditingController(text: 'GT06N');

  bool _running = false;
  SimulationResult? _result;

  @override
  void dispose() {
    _configIdController.dispose();
    _deviceModelController.dispose();
    super.dispose();
  }

  Future<void> _run() async {
    setState(() {
      _running = true;
      _result = null;
    });
    final result = await ref
        .read(simulatorRepositoryProvider)
        .simulate(
          configId: _configIdController.text,
          deviceModel: _deviceModelController.text,
        );
    if (!mounted) return;
    setState(() {
      _running = false;
      _result = result;
    });
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;

    return Scaffold(
      appBar: AppBar(title: const Text('Mobile Simulator Test')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _configIdController,
            decoration: const InputDecoration(labelText: 'Config ID'),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _deviceModelController,
            decoration: const InputDecoration(labelText: 'Device Model'),
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _running ? null : _run,
            child: _running
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('รันทดสอบ (mock)'),
          ),
          const SizedBox(height: 24),
          if (result != null) _ResultCard(result: result),
        ],
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
