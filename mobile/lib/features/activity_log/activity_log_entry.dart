/// One recorded read-level activity — kept **local to this device only**
/// (`docs/10_LocalActivityLog_Proposal.md` §3.3). Never sent to the backend.
class ActivityLogEntry {
  const ActivityLogEntry({
    required this.id,
    required this.type,
    required this.at,
    required this.detail,
  });

  /// client-generated (uuid v4)
  final String id;
  final ActivityLogType type;

  /// device time, stored/serialized as ISO-8601 UTC
  final DateTime at;

  /// type-specific payload — for [ActivityLogType.navigation]:
  /// `{ 'path': String, 'title': String }`
  final Map<String, dynamic> detail;

  String? get path => detail['path'] as String?;
  String? get title => detail['title'] as String?;

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type.wireName,
    'at': at.toUtc().toIso8601String(),
    'detail': detail,
  };

  /// Throws on a malformed entry — callers ([ActivityLogRepository]) drop
  /// entries that fail to parse rather than propagating.
  factory ActivityLogEntry.fromJson(Map<String, dynamic> json) {
    return ActivityLogEntry(
      id: json['id'] as String,
      type: ActivityLogType.fromWire(json['type'] as String),
      at: DateTime.parse(json['at'] as String).toUtc(),
      detail: (json['detail'] as Map).cast<String, dynamic>(),
    );
  }
}

/// String enum kept open for future event kinds (`search` / `filter` land with
/// the table-filter work — mobile has no search field yet, see §6.2).
enum ActivityLogType {
  navigation('navigation');

  const ActivityLogType(this.wireName);

  final String wireName;

  static ActivityLogType fromWire(String value) {
    for (final t in ActivityLogType.values) {
      if (t.wireName == value) return t;
    }
    throw ArgumentError.value(value, 'value', 'Unknown activity log type');
  }
}
