import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/core/theme/app_tokens.dart';
import 'package:mobile/core/ui/app_badge.dart';
import 'package:mobile/core/ui/status_tones.dart';

// docs/22 Batch 1 — token ชุดเดียวกับ Web (§4) และ tone ของสถานะ (§5.2)
// คำนวณ contrast จากค่า Color จริงในโค้ดด้วยสูตร relative luminance ของ WCAG
// แบบเดียวกับ color_contrast_test.dart

double _contrast(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final hi = la > lb ? la : lb;
  final lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

/// สีโปร่งแสง (เช่น `secondary-foreground` 80%) วางบนพื้นทึบ ได้สีที่ตาเห็นจริง
Color _onto(Color fg, Color bg) => Color.alphaBlend(fg, bg);

void main() {
  group(
    'AppColors ตรงกับ oklch จริงของ Web (ไม่ใช่คอมเมนต์ใน globals.css)',
    () {
      // ค่าที่แปลงจาก `web/src/app/globals.css` (`:root`) บน main d487763
      // ยกเว้น mutedForeground = ค่าใหม่จาก #344 ที่ B ตัดสินให้ Mobile ตาม
      final expected = <String, (Color, int)>{
        'background': (AppColors.background, 0xFFF7F8FA),
        'foreground': (AppColors.foreground, 0xFF1B2733),
        'card': (AppColors.card, 0xFFFFFFFF),
        'primary': (AppColors.primary, 0xFF1B6FB2),
        'primaryForeground': (AppColors.primaryForeground, 0xFFFFFFFF),
        'secondary': (AppColors.secondary, 0xFFEEF1F5),
        'mutedForeground': (AppColors.mutedForeground, 0xFF576171),
        'accent': (AppColors.accent, 0xFFECF3F9),
        'accentForeground': (AppColors.accentForeground, 0xFF12344D),
        'destructive': (AppColors.destructive, 0xFFE7000B),
        'success': (AppColors.success, 0xFF4E9B6C),
        'successForeground': (AppColors.successForeground, 0xFF165E3C),
        'successSubtle': (AppColors.successSubtle, 0xFFDBF6E6),
        'warning': (AppColors.warning, 0xFFCB8315),
        'warningForeground': (AppColors.warningForeground, 0xFF824103),
        'warningSubtle': (AppColors.warningSubtle, 0xFFFEF3C9),
        'info': (AppColors.info, 0xFF287CCF),
        'infoForeground': (AppColors.infoForeground, 0xFF075A8E),
        'infoSubtle': (AppColors.infoSubtle, 0xFFDFF2FE),
        'dangerForeground': (AppColors.dangerForeground, 0xFF9D1135),
        'dangerSubtle': (AppColors.dangerSubtle, 0xFFFFF0F2),
        'border': (AppColors.border, 0xFFE2E6EB),
        'inputBorder': (AppColors.inputBorder, 0xFF576171),
        'ring': (AppColors.ring, 0xFF1B6FB2),
      };
      for (final MapEntry(key: name, value: (actual, hex))
          in expected.entries) {
        test(name, () => expect(actual, Color(hex)));
      }
    },
  );

  test('radius และขนาดตัวอักษรตาม Web (--radius 10, text-xs 13 / sm 15)', () {
    expect(AppRadius.lg, 10);
    expect(AppRadius.sm, 6);
    expect(AppRadius.md, 8);
    expect(AppRadius.xl, 14);
    expect(AppTypography.xs, 13);
    expect(AppTypography.sm, 15);
    expect(AppTypography.base, 16);
    expect(AppTypography.xxl, 24);
  });

  group('contrast ของ token (WCAG AA)', () {
    test('ข้อความหลัก / ข้อความรอง / ตัวอักษรบนปุ่มหลัก ≥ 4.5:1', () {
      for (final (name, fg, bg) in [
        (
          'foreground on background',
          AppColors.foreground,
          AppColors.background,
        ),
        ('foreground on card', AppColors.foreground, AppColors.card),
        ('mutedForeground on card', AppColors.mutedForeground, AppColors.card),
        (
          'mutedForeground on background',
          AppColors.mutedForeground,
          AppColors.background,
        ),
        (
          'primaryForeground on primary',
          AppColors.primaryForeground,
          AppColors.primary,
        ),
      ]) {
        final ratio = _contrast(fg, bg);
        expect(
          ratio,
          greaterThanOrEqualTo(4.5),
          reason: '$name: ${ratio.toStringAsFixed(2)}:1',
        );
      }
    });

    test('ขอบช่องกรอก ≥ 3:1 ทั้งบนการ์ดและบน background (WCAG 1.4.11)', () {
      expect(
        _contrast(AppColors.inputBorder, AppColors.card),
        greaterThanOrEqualTo(3),
      );
      expect(
        _contrast(AppColors.inputBorder, AppColors.background),
        greaterThanOrEqualTo(3),
      );
    });

    for (final tone in AppBadgeTone.values) {
      test('ตัวอักษร Badge ${tone.name} บนพื้นของตัวเอง ≥ 4.5:1', () {
        final style = tone.style;
        final ratio = _contrast(
          _onto(style.foreground, style.background),
          style.background,
        );
        expect(
          ratio,
          greaterThanOrEqualTo(4.5),
          reason: '${tone.name}: ${ratio.toStringAsFixed(2)}:1',
        );
      });
    }
  });

  group('AppTheme.v2 (โหมดสว่างอย่างเดียว)', () {
    final theme = AppTheme.v2();

    test('เป็นโหมดสว่าง ใช้ token ของ Web', () {
      expect(theme.brightness, Brightness.light);
      expect(theme.scaffoldBackgroundColor, AppColors.background);
      expect(theme.colorScheme.primary, AppColors.primary);
      expect(theme.colorScheme.onPrimary, AppColors.primaryForeground);
      expect(theme.colorScheme.surface, AppColors.card);
      expect(theme.colorScheme.onSurface, AppColors.foreground);
      expect(theme.colorScheme.error, AppColors.destructive);
      expect(theme.colorScheme.outline, AppColors.inputBorder);
    });

    test('ขอบช่องกรอกใช้ inputBorder มุม 10', () {
      final border = theme.inputDecorationTheme.enabledBorder!;
      expect(border, isA<OutlineInputBorder>());
      final outline = border as OutlineInputBorder;
      expect(outline.borderSide.color, AppColors.inputBorder);
      expect(outline.borderRadius, BorderRadius.circular(AppRadius.lg));
    });

    test('ข้อความเล็กใช้สเกลใหม่ 13 / 15', () {
      expect(theme.textTheme.bodySmall!.fontSize, AppTypography.xs);
      expect(theme.textTheme.bodyMedium!.fontSize, AppTypography.sm);
      expect(theme.textTheme.bodyLarge!.fontSize, AppTypography.base);
    });

    test('ปุ่มหลักสีพื้น primary สูงอย่างน้อย 48 มุม 10', () {
      final style = theme.filledButtonTheme.style!;
      expect(style.backgroundColor!.resolve({}), AppColors.primary);
      expect(style.foregroundColor!.resolve({}), AppColors.primaryForeground);
      expect(style.minimumSize!.resolve({}), const Size(64, 48));
      final shape = style.shape!.resolve({})! as RoundedRectangleBorder;
      expect(shape.borderRadius, BorderRadius.circular(AppRadius.lg));
    });
  });

  testWidgets(
    'ปุ่มทั้ง 3 แบบวางใน Row / Wrap ได้ไม่ throw (กว้างขั้นต่ำ 64 ไม่ใช่ infinity)',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.v2(),
          home: Scaffold(
            body: Column(
              children: [
                Row(
                  children: [
                    FilledButton(onPressed: () {}, child: const Text('หลัก')),
                    OutlinedButton(onPressed: () {}, child: const Text('รอง')),
                    TextButton(onPressed: () {}, child: const Text('ลิงก์')),
                  ],
                ),
                Wrap(
                  children: [
                    FilledButton(onPressed: () {}, child: const Text('หลัก 2')),
                    OutlinedButton(
                      onPressed: () {},
                      child: const Text('รอง 2'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
      final filled = tester.getSize(find.widgetWithText(FilledButton, 'หลัก'));
      expect(filled.height, greaterThanOrEqualTo(48));
      expect(filled.width, greaterThanOrEqualTo(64));
      expect(filled.width, lessThan(400));
    },
  );

  test('ฟอนต์ theme v2 = Anuphan (มติ B ตาม Web #344)', () {
    expect(AppTypography.fontFamily, 'Anuphan');
    expect(AppTheme.v2().textTheme.bodyMedium!.fontFamily, 'Anuphan');
  });

  group('tone ของสถานะ (docs/22 §5.2)', () {
    test('Task status ตาม TASK_STATUS_TONE ของ Web — cancelled = danger', () {
      expect(taskStatusTone(TaskStatus.pending), AppBadgeTone.neutral);
      expect(taskStatusTone(TaskStatus.inProgress), AppBadgeTone.warning);
      expect(taskStatusTone(TaskStatus.completed), AppBadgeTone.success);
      expect(taskStatusTone(TaskStatus.cancelled), AppBadgeTone.danger);
    });

    test('Incident status / severity ตาม Web', () {
      expect(incidentStatusTone(IncidentStatus.open), AppBadgeTone.danger);
      expect(
        incidentStatusTone(IncidentStatus.investigating),
        AppBadgeTone.warning,
      );
      expect(incidentStatusTone(IncidentStatus.rolledBack), AppBadgeTone.info);
      expect(incidentStatusTone(IncidentStatus.resolved), AppBadgeTone.success);
      expect(
        incidentStatusTone(IncidentStatus.dismissed),
        AppBadgeTone.neutral,
      );
      expect(
        incidentSeverityTone(IncidentSeverity.critical),
        AppBadgeTone.danger,
      );
      expect(incidentSeverityTone(IncidentSeverity.high), AppBadgeTone.warning);
      expect(incidentSeverityTone(IncidentSeverity.medium), AppBadgeTone.info);
      expect(incidentSeverityTone(IncidentSeverity.low), AppBadgeTone.neutral);
    });

    test('Device lifecycle / payload status ตาม Web', () {
      expect(
        deviceLifecycleTone(DeviceLifecycleStatus.registered),
        AppBadgeTone.neutral,
      );
      expect(
        deviceLifecycleTone(DeviceLifecycleStatus.installed),
        AppBadgeTone.success,
      );
      expect(
        deviceLifecycleTone(DeviceLifecycleStatus.decommissioned),
        AppBadgeTone.danger,
      );
      expect(
        devicePayloadTone(DevicePayloadStatus.upToDate),
        AppBadgeTone.success,
      );
      expect(
        devicePayloadTone(DevicePayloadStatus.pending),
        AppBadgeTone.warning,
      );
      expect(
        devicePayloadTone(DevicePayloadStatus.failed),
        AppBadgeTone.danger,
      );
      expect(
        devicePayloadTone(DevicePayloadStatus.unknown),
        AppBadgeTone.neutral,
      );
    });
  });
}
