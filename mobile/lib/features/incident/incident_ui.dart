import 'package:flutter/material.dart';

import '../../core/api/models.dart';

/// Shared labels + palette for [IncidentSeverity] / [IncidentStatus] pills.
/// Same navy design-system palette used across Home / Task / Device.
class IncidentStyle {
  const IncidentStyle._();

  static String severityLabel(IncidentSeverity s) => switch (s) {
    IncidentSeverity.critical => 'วิกฤต',
    IncidentSeverity.high => 'สูง',
    IncidentSeverity.medium => 'ปานกลาง',
    IncidentSeverity.low => 'ต่ำ',
  };

  /// `(background, foreground)` for the severity pill.
  static (Color, Color) severityColors(IncidentSeverity s) => switch (s) {
    IncidentSeverity.critical => (Color(0xFF7B241C), Colors.white),
    IncidentSeverity.high => (Color(0xFFFCE8E6), Color(0xFFC0392B)),
    IncidentSeverity.medium => (Color(0xFFFDF0E3), Color(0xFFB9770E)),
    IncidentSeverity.low => (Color(0xFFECEFF1), Color(0xFF5F6E79)),
  };

  static String statusLabel(IncidentStatus s) => switch (s) {
    IncidentStatus.open => 'เปิดอยู่',
    IncidentStatus.investigating => 'กำลังตรวจสอบ',
    IncidentStatus.rolledBack => 'Rollback แล้ว',
    IncidentStatus.resolved => 'แก้ไขแล้ว',
  };

  static (Color, Color) statusColors(IncidentStatus s) => switch (s) {
    IncidentStatus.open => (Color(0xFFECEFF1), Color(0xFF5F6E79)),
    IncidentStatus.investigating => (Color(0xFFE3F0FB), Color(0xFF1F6FB2)),
    IncidentStatus.rolledBack => (Color(0xFFFDF0E3), Color(0xFFB9770E)),
    IncidentStatus.resolved => (Color(0xFFE6F4EA), Color(0xFF1E7E34)),
  };
}

/// Rounded pill — same shape/typography as `TaskStatusPill`.
class _Pill extends StatelessWidget {
  const _Pill({required this.text, required this.bg, required this.fg});

  final String text;
  final Color bg;
  final Color fg;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        text,
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg),
      ),
    );
  }
}

class IncidentSeverityPill extends StatelessWidget {
  const IncidentSeverityPill({super.key, required this.severity});

  final IncidentSeverity severity;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = IncidentStyle.severityColors(severity);
    return _Pill(text: IncidentStyle.severityLabel(severity), bg: bg, fg: fg);
  }
}

class IncidentStatusPill extends StatelessWidget {
  const IncidentStatusPill({super.key, required this.status});

  final IncidentStatus status;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = IncidentStyle.statusColors(status);
    return _Pill(text: IncidentStyle.statusLabel(status), bg: bg, fg: fg);
  }
}
