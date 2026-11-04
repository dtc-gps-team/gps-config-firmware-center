import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';

/// ตัวเลือก 1 ช่องของ [AppSegmentedToggle] / 1 รายการของ [AppFilterMenu]
class AppFilterOption<T> {
  const AppFilterOption({required this.value, required this.label, this.key});

  final T value;
  final String label;
  final Key? key;
}

/// สวิตช์หลายช่องแบบแถบเดียว ช่องที่เลือกพื้นเข้มตัวขาว (B 04/11/2026: ชิป
/// หลายอันดูไม่ออกว่าเลือกอันไหนอยู่) · ใช้กรองหลักของหน้ารายการ เช่น
/// ทั้งหมด/ยังไม่อ่าน (แจ้งเตือน), ต้องติดตาม/ปิดแล้ว/ทั้งหมด (Incidents)
class AppSegmentedToggle<T> extends StatelessWidget {
  const AppSegmentedToggle({
    super.key,
    required this.options,
    required this.selected,
    required this.onChanged,
  });

  final List<AppFilterOption<T>> options;
  final T selected;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 40),
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: AppColors.secondary,
        borderRadius: BorderRadius.circular(AppRadius.xl),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final o in options)
              Expanded(
                child: _Segment(
                  key: o.key,
                  label: o.label,
                  selected: o.value == selected,
                  onTap: () => onChanged(o.value),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Segment extends StatelessWidget {
  const _Segment({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      button: true,
      child: Material(
        color: selected ? AppColors.primary : Colors.transparent,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadius.xl),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
            child: Center(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: AppTypography.sm,
                  fontWeight: FontWeight.w600,
                  color: selected
                      ? AppColors.primaryForeground
                      : AppColors.mutedForeground,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// ปุ่มกรองรองที่เปิดเป็นเมนู ไม่กินที่บนจอ · ยังไม่เลือก (null) แสดง
/// [placeholder] พื้นขาว · เลือกแล้วพื้นเข้มพร้อมชื่อที่เลือก ให้รู้ว่ากำลัง
/// กรองอยู่ · รายการแรกในเมนูคือ [allLabel] = ยกเลิกตัวกรอง
class AppFilterMenu<T extends Object> extends StatelessWidget {
  const AppFilterMenu({
    super.key,
    required this.placeholder,
    required this.allLabel,
    required this.options,
    required this.selected,
    required this.onChanged,
    this.allKey,
    this.tooltip,
  });

  final String placeholder;
  final String allLabel;
  final Key? allKey;
  final List<AppFilterOption<T>> options;
  final T? selected;
  final ValueChanged<T?> onChanged;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final active = selected != null;
    String? selectedLabel;
    for (final o in options) {
      if (o.value == selected) selectedLabel = o.label;
    }
    // PopupMenuButton คืน null ไม่ได้ (null = ปิดเมนูเฉย ๆ) จึงใช้ sentinel
    // [_all] แทน "ทั้งหมด"
    return PopupMenuButton<Object>(
      tooltip: tooltip ?? placeholder,
      onSelected: (v) => onChanged(v is T ? v : null),
      itemBuilder: (_) => [
        PopupMenuItem<Object>(
          key: allKey,
          value: _all,
          child: Text(
            allLabel,
            style: TextStyle(
              fontWeight: active ? FontWeight.w400 : FontWeight.w700,
            ),
          ),
        ),
        for (final o in options)
          PopupMenuItem<Object>(
            key: o.key,
            value: o.value,
            child: Text(
              o.label,
              style: TextStyle(
                fontWeight: o.value == selected
                    ? FontWeight.w700
                    : FontWeight.w400,
              ),
            ),
          ),
      ],
      child: AppFilterButton(
        label: selectedLabel ?? placeholder,
        active: active,
      ),
    );
  }
}

/// หน้าตาปุ่มกรอง ใช้ร่วมกันทุกหน้า: ยังไม่เลือก = พื้นขาวขอบบาง · เลือกแล้ว
/// = พื้นเข้มตัวขาว ชื่อหดเป็น "…" ได้เมื่อวางใน Flexible / Wrap ·
/// [onTap] null เมื่อผู้เรียกจัดการการแตะเอง (เช่น [AppFilterMenu])
class AppFilterButton extends StatelessWidget {
  const AppFilterButton({
    super.key,
    required this.label,
    required this.active,
    this.onTap,
    this.minHeight = 40,
  });

  final String label;
  final bool active;
  final VoidCallback? onTap;
  final double minHeight;

  @override
  Widget build(BuildContext context) {
    final fg = active ? AppColors.primaryForeground : AppColors.foreground;
    final content = Container(
      constraints: BoxConstraints(minHeight: minHeight),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: active ? AppColors.primary : AppColors.card,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(
          color: active ? AppColors.primary : AppColors.border,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.filter_list,
            size: 18,
            color: active
                ? AppColors.primaryForeground
                : AppColors.mutedForeground,
          ),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: AppTypography.sm,
                fontWeight: FontWeight.w600,
                color: fg,
              ),
            ),
          ),
        ],
      ),
    );
    if (onTap == null) return content;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        child: content,
      ),
    );
  }
}

const _all = Object();
