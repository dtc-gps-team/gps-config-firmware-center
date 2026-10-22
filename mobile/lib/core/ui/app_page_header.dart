import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';

/// คู่ "ชื่อสีเทา ค่าสีเข้ม" ใต้ชื่อหน้า — แบบ `PageHeaderMeta` ของ Web
class AppPageHeaderMeta {
  const AppPageHeaderMeta({required this.label, required this.value});

  final String label;
  final String value;
}

/// ปุ่มใน [AppPageHeader.actions] — กติกาเดียวกับ `PageHeader` ของ Web:
/// - Role ที่ทำ action นี้ไม่ได้เลย → [visible] `false` (ซ่อน ไม่ render)
/// - Role ที่ปกติทำได้แต่ติดเงื่อนไขตอนนี้ → ใส่ [disabledReason] ปุ่มยังแสดง
///   แต่กดไม่ได้ แตะแล้วเห็นเหตุผล (มือถือไม่มี hover) และ screen reader อ่านได้
/// - **ห้าม disable เฉยๆ** โดยไม่บอกเหตุผล — ไม่มีทั้ง [onPressed] และ
///   [disabledReason] = assert fail
class AppPageHeaderAction {
  AppPageHeaderAction({
    required this.label,
    this.onPressed,
    this.icon,
    this.primary = false,
    this.visible = true,
    this.disabledReason,
    this.key,
  }) : assert(
         onPressed != null || disabledReason != null,
         'ปุ่มที่กดไม่ได้ต้องมี disabledReason (หรือซ่อนด้วย visible: false)',
       );

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;

  /// ปุ่มหลัก (FilledButton) — วางไว้ท้ายสุดของ list ตามกติกา Web
  final bool primary;
  final bool visible;
  final String? disabledReason;
  final Key? key;
}

/// หัวหน้าจอมาตรฐานแบบ `PageHeader` ของ Web (docs/22 §7.1) — **ใช้แทน AppBar
/// สีกรมท่าเดิม** พื้นโปร่ง (เท่ากับ background ของหน้า)
///
/// - [description] บอกว่าหน้านี้ใช้ทำอะไร **ไม่ใช่เรื่องสิทธิ์**
/// - [status] ป้ายสถานะข้างชื่อ (หน้ารายละเอียด) — ใช้ `AppBadge` พร้อม dot
/// - [meta] แถวข้อมูลสั้นใต้ชื่อ
/// - [actions] ดูกติกาที่ [AppPageHeaderAction]
/// - [onBack] หน้าลูก: ปุ่มย้อนกลับอยู่แถวเดียวกับชื่อ · หน้าระดับแท็บไม่ใส่
///
/// ขนาดชื่อ `xl` (20) เล็กกว่า Web (`2xl` = 24) โดยตั้งใจ — มติ B Batch 2 หลังเทียบ
/// screenshot บนเครื่องจริง: จอมือถือแคบ หน้ารายละเอียดที่มีปุ่มย้อนกลับ + ป้าย
/// สถานะ + ชื่อยาวจะไม่ตัดขึ้นบรรทัดใหม่ง่ายๆ (docs/22 §4.5)
class AppPageHeader extends StatelessWidget {
  const AppPageHeader({
    super.key,
    required this.title,
    this.description,
    this.status,
    this.meta = const [],
    this.actions = const [],
    this.onBack,
    this.trailing,
    this.padding = const EdgeInsets.fromLTRB(16, 16, 16, 12),
  });

  final String title;
  final String? description;
  final Widget? status;
  final List<AppPageHeaderMeta> meta;
  final List<AppPageHeaderAction> actions;
  final VoidCallback? onBack;

  /// ปุ่มมุมขวาของแถว title — หน้าระดับแท็บใส่ปุ่มบัญชีผู้ใช้ (avatar, docs/22
  /// §7.2) · ไม่ใช่ที่ของปุ่มคำสั่ง ปุ่มคำสั่งใช้ [actions]
  final Widget? trailing;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final visibleActions = actions.where((a) => a.visible).toList();

    return Padding(
      padding: padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (onBack != null)
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: 4),
                  child: IconButton(
                    onPressed: onBack,
                    tooltip: 'ย้อนกลับ',
                    icon: const Icon(Icons.arrow_back),
                    color: AppColors.foreground,
                    visualDensity: VisualDensity.compact,
                  ),
                ),
              Expanded(
                child: Padding(
                  // จัดชื่อให้อยู่กลางแนวเดียวกับปุ่มย้อนกลับ (40) บรรทัดแรก
                  padding: EdgeInsets.only(top: onBack != null ? 4 : 0),
                  child: Wrap(
                    spacing: 12,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Semantics(
                        header: true,
                        child: Text(
                          title,
                          style: const TextStyle(
                            fontSize: AppTypography.xl,
                            height: AppTypography.xlHeight,
                            fontWeight: FontWeight.w600,
                            color: AppColors.foreground,
                          ),
                        ),
                      ),
                      ?status,
                    ],
                  ),
                ),
              ),
              if (trailing != null) ...[const SizedBox(width: 8), trailing!],
            ],
          ),
          if (description != null) ...[
            const SizedBox(height: 6),
            Text(
              description!,
              style: const TextStyle(
                fontSize: AppTypography.sm,
                height: AppTypography.smHeight,
                color: AppColors.mutedForeground,
              ),
            ),
          ],
          if (meta.isNotEmpty) ...[
            const SizedBox(height: 6),
            Wrap(
              spacing: 24,
              runSpacing: 4,
              children: [for (final item in meta) _MetaItem(item)],
            ),
          ],
          if (visibleActions.isNotEmpty) ...[
            const SizedBox(height: 16),
            Wrap(
              key: const Key('app_page_header_actions'),
              alignment: WrapAlignment.end,
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final action in visibleActions) _ActionButton(action),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _MetaItem extends StatelessWidget {
  const _MetaItem(this.item);

  final AppPageHeaderMeta item;

  @override
  Widget build(BuildContext context) {
    const base = TextStyle(
      fontSize: AppTypography.sm,
      height: AppTypography.smHeight,
    );
    // Wrap ไม่ใช่ Row: ตัวอักษรใหญ่บนจอแคบ label ยาว (เช่น "เลขเครื่อง") กว้างเกินจอ
    // ได้เอง Row ที่ label ไม่ยืดหยุ่นจะล้นขอบ (เจอตอนใช้ meta ครั้งแรกใน Batch 4) ·
    // Wrap ให้ค่าขึ้นบรรทัดใหม่ใต้ label และแต่ละข้อความตัดบรรทัดในความกว้างที่มี
    return Wrap(
      spacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(
          item.label,
          style: base.copyWith(color: AppColors.mutedForeground),
        ),
        Text(
          item.value,
          style: base.copyWith(
            color: AppColors.foreground,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton(this.action);

  final AppPageHeaderAction action;

  @override
  Widget build(BuildContext context) {
    final reason = action.disabledReason;
    final onPressed = reason == null ? action.onPressed : null;
    final label = Text(action.label);
    final icon = action.icon == null ? null : Icon(action.icon, size: 18);

    // ตั้ง minimumSize เองไม่พึ่ง theme — หน้าที่ยังใช้ theme เดิม (`light()`) ตั้ง
    // `Size.fromHeight(48)` (กว้าง infinity) ซึ่งจะ throw ใน Wrap · v2 ใช้ค่าเดียวกันนี้แล้ว
    const style = ButtonStyle(
      minimumSize: WidgetStatePropertyAll(Size(64, 48)),
    );
    final Widget button = switch ((action.primary, icon)) {
      (true, null) => FilledButton(
        key: action.key,
        style: style,
        onPressed: onPressed,
        child: label,
      ),
      (true, final i?) => FilledButton.icon(
        key: action.key,
        style: style,
        onPressed: onPressed,
        icon: i,
        label: label,
      ),
      (false, null) => OutlinedButton(
        key: action.key,
        style: style,
        onPressed: onPressed,
        child: label,
      ),
      (false, final i?) => OutlinedButton.icon(
        key: action.key,
        style: style,
        onPressed: onPressed,
        icon: i,
        label: label,
      ),
    };

    if (reason == null) return button;
    // ปุ่มที่ disable รับ tap ไม่ได้ Tooltip ครอบไว้ให้แตะแล้วเห็นเหตุผล
    // (แบบ DisabledWithReason ของ Web ที่ใช้ hover/focus) · hint ให้ screen
    // reader อ่านเหตุผลด้วย เพราะ tooltip ไม่ใช่ทางเดียวที่ควรพึ่ง
    return Tooltip(
      message: reason,
      triggerMode: TooltipTriggerMode.tap,
      // MergeSemantics ให้ hint อยู่ node เดียวกับปุ่ม ไม่แยกเป็นอีก node
      child: MergeSemantics(
        child: Semantics(hint: reason, child: button),
      ),
    );
  }
}
