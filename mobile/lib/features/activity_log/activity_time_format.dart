/// Compact Thai relative time for the activity list ("5 นาทีที่แล้ว").
/// Pure — [now] is passed in so it's testable. Falls back to `d/M` for
/// anything older than a week (retention caps at 14 days anyway).
String activityRelativeTime(DateTime at, DateTime now) {
  final local = at.toLocal();
  final diff = now.difference(local);

  if (diff.isNegative || diff.inSeconds < 45) return 'เมื่อสักครู่';
  if (diff.inMinutes < 60) return '${diff.inMinutes} นาทีที่แล้ว';
  if (diff.inHours < 24) return '${diff.inHours} ชั่วโมงที่แล้ว';
  if (diff.inDays < 7) return '${diff.inDays} วันที่แล้ว';
  return '${local.day}/${local.month}';
}
