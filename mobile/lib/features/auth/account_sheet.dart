import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/config/app_config.dart';
import '../../core/sync/sync_providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_badge.dart';
import '../../core/ui/app_v2_theme.dart';
import '../../core/ui/labels.dart';

/// อักษรย่อไม่เกิน 2 ตัวในวงกลม avatar จากชื่อผู้ใช้จริง — ไม่มีชื่อ = "?"
String accountInitials(String? username) {
  if (username == null || username.isEmpty) return '?';
  final letters = username.replaceAll(RegExp('[^A-Za-zก-๙]'), '');
  if (letters.isEmpty) return username.substring(0, 1).toUpperCase();
  return letters.substring(0, letters.length >= 2 ? 2 : 1).toUpperCase();
}

/// ปุ่ม avatar มุมขวาของ `AppPageHeader` ในหน้าระดับแท็บ (docs/22 §7.2) — แตะแล้ว
/// เปิดแผ่นบัญชีผู้ใช้ ([showAccountSheet]) แทนปุ่ม logout + กระดิ่งบนหัวหน้าแรกเดิม
class AccountButton extends ConsumerWidget {
  const AccountButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final username = ref.watch(
      authControllerProvider.select((s) => s.username),
    );
    return IconButton(
      key: const Key('account_button'),
      tooltip: 'บัญชีผู้ใช้',
      onPressed: () => showAccountSheet(context),
      icon: CircleAvatar(
        radius: 18,
        backgroundColor: AppColors.accent,
        foregroundColor: AppColors.accentForeground,
        child: Text(
          accountInitials(username),
          style: const TextStyle(
            fontSize: AppTypography.xs,
            height: AppTypography.xsHeight,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

/// แผ่นบัญชีผู้ใช้: ชื่อ + ป้าย Role (`ST`) + บรรทัดย่อย "ช่างภาคสนาม" + ปุ่ม
/// ออกจากระบบ (docs/22 §7.2, §6.2)
Future<void> showAccountSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    // เปิดบน navigator ราก ให้คลุมแถบแท็บด้วย (ไม่งั้นแผ่นอยู่ใน navigator ของแท็บ
    // แถบแท็บยังโผล่และกดได้ใต้แผ่น) · navigator รากไม่มี AppV2Theme ครอบ จึงครอบเอง
    useRootNavigator: true,
    builder: (_) => const AppV2Theme(child: _AccountSheet()),
    backgroundColor: AppColors.card,
    showDragHandle: true,
  );
}

class _AccountSheet extends ConsumerWidget {
  const _AccountSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final role = auth.role;
    return SafeArea(
      child: Padding(
        key: const Key('account_sheet'),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Flexible(
                  child: Text(
                    auth.username ?? roleDescription(role),
                    key: const Key('account_username'),
                    style: const TextStyle(
                      fontSize: AppTypography.lg,
                      height: AppTypography.lgHeight,
                      fontWeight: FontWeight.w600,
                      color: AppColors.foreground,
                    ),
                  ),
                ),
                if (role != null) ...[
                  const SizedBox(width: 8),
                  AppBadge(
                    key: const Key('account_role_badge'),
                    label: roleLabel(role),
                    tone: AppBadgeTone.info,
                  ),
                ],
              ],
            ),
            const SizedBox(height: 2),
            Text(
              roleDescription(role),
              key: const Key('account_role_description'),
              style: const TextStyle(
                fontSize: AppTypography.sm,
                height: AppTypography.smHeight,
                color: AppColors.mutedForeground,
              ),
            ),
            const SizedBox(height: 20),
            OutlinedButton.icon(
              key: const Key('account_logout'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.destructive,
              ),
              onPressed: () => _confirmAndLogout(context, ref),
              icon: const Icon(Icons.logout),
              label: const Text('ออกจากระบบ'),
            ),
          ],
        ),
      ),
    );
  }
}

/// ออกจากระบบต้องยืนยันเสมอ (#326) · ถ้ามีรายการที่ยังไม่ถึง server (logout ล้าง
/// DB ในเครื่องรวม `PendingActions`) dialog บอกจำนวนด้วย ไม่งั้นเป็นการยืนยันธรรมดา
Future<void> _confirmAndLogout(BuildContext context, WidgetRef ref) async {
  var unsynced = 0;
  if (!AppConfig.apiMockMode) {
    try {
      unsynced = await ref.read(pendingActionDaoProvider).countUnsynced();
    } catch (_) {
      // อ่านคิวไม่ได้ -> ไม่ขังผู้ใช้ไว้หน้านี้
    }
  }
  if (!context.mounted) return;
  final confirmed = unsynced > 0
      ? await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            key: const Key('logout_unsynced_dialog'),
            title: const Text('ออกจากระบบ?'),
            content: Text(
              'มี $unsynced รายการยังไม่ซิงค์ ถ้าออกจากระบบตอนนี้'
              'การแก้ไขที่ยังไม่ซิงค์จะหายไป ยืนยันออกจากระบบ?',
            ),
            actions: [
              TextButton(
                key: const Key('logout_unsynced_cancel'),
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('ยกเลิก'),
              ),
              TextButton(
                key: const Key('logout_unsynced_confirm'),
                onPressed: () => Navigator.of(dialogContext).pop(true),
                child: const Text('ยืนยัน'),
              ),
            ],
          ),
        )
      : await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            key: const Key('logout_confirm_dialog'),
            title: const Text('ออกจากระบบ?'),
            content: const Text('ต้องการออกจากระบบใช่หรือไม่?'),
            actions: [
              TextButton(
                key: const Key('logout_cancel'),
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('ยกเลิก'),
              ),
              TextButton(
                key: const Key('logout_confirm'),
                onPressed: () => Navigator.of(dialogContext).pop(true),
                child: const Text('ออกจากระบบ'),
              ),
            ],
          ),
        );
  if (confirmed != true || !context.mounted) return;
  // อ่าน notifier ก่อนปิดแผ่น — ปิดแล้ว widget (และ ref) ถูก dispose
  final auth = ref.read(authControllerProvider.notifier);
  Navigator.of(context).pop();
  await auth.logout();
}
