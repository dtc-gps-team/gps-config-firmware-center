import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import 'incident_repository.dart';
import 'incident_ui.dart';

/// Incident list palette. Scoped to this file, same values as Home / Task.
class _IncidentColors {
  const _IncidentColors._();

  static const navy = Color(0xFF12344D);
  static const background = Color(0xFFF4F6F8);
  static const surface = Colors.white;
  static const textPrimary = Color(0xFF12344D);
  static const textSecondary = Color(0xFF5F6E79);
  static const error = Color(0xFFC0392B);
}

String _formatDate(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

/// "Incident" — read-only list from `GET /incidents` (every role may read it).
/// Opened from the Home shortcut. **No create / edit** — field staff have no
/// Create permission (RBAC_Matrix.md "Incident & Rollback"); the Home label is
/// "ดู Incident" for the same reason.
class IncidentListPage extends ConsumerWidget {
  const IncidentListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final incidentsAsync = ref.watch(incidentListProvider);

    return Scaffold(
      backgroundColor: _IncidentColors.background,
      appBar: AppBar(
        backgroundColor: _IncidentColors.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('Incident'),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(incidentListProvider.future),
        child: incidentsAsync.when(
          skipLoadingOnRefresh: true,
          data: (incidents) {
            if (incidents.isEmpty) return const _IncidentsEmpty();
            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: incidents.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, i) => _IncidentCard(
                key: Key('incident_card_$i'),
                incident: incidents[i],
              ),
            );
          },
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => _IncidentsError(
            message: error is ApiException
                ? error.message
                : 'โหลดรายการ Incident ไม่สำเร็จ',
            onRetry: () => ref.invalidate(incidentListProvider),
          ),
        ),
      ),
    );
  }
}

class _IncidentCard extends StatelessWidget {
  const _IncidentCard({super.key, required this.incident});

  final Incident incident;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _IncidentColors.surface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            incident.title,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: _IncidentColors.textPrimary,
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              IncidentSeverityPill(severity: incident.severity),
              IncidentStatusPill(status: incident.status),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            _formatDate(incident.createdAt),
            style: const TextStyle(
              fontSize: 12,
              color: _IncidentColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

class _IncidentsEmpty extends StatelessWidget {
  const _IncidentsEmpty();

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: const [
        SizedBox(height: 80),
        Center(
          child: Column(
            children: [
              Icon(
                Icons.check_circle_outline,
                color: _IncidentColors.textSecondary,
              ),
              SizedBox(height: 8),
              Text(
                'ยังไม่มี Incident',
                key: Key('incidents_empty'),
                style: TextStyle(
                  fontSize: 13,
                  color: _IncidentColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _IncidentsError extends StatelessWidget {
  const _IncidentsError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 64),
        Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.error_outline,
                  color: _IncidentColors.error,
                  size: 32,
                ),
                const SizedBox(height: 12),
                Text(
                  message,
                  key: const Key('incidents_error'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 14,
                    color: _IncidentColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  key: const Key('incidents_retry'),
                  onPressed: onRetry,
                  style: FilledButton.styleFrom(
                    backgroundColor: _IncidentColors.navy,
                    foregroundColor: Colors.white,
                  ),
                  child: const Text('ลองอีกครั้ง'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
