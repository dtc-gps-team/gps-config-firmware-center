import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../router/app_router.dart';
import '../theme/app_tokens.dart';

/// หน้าที่ role นี้ใช้ไม่ได้ (ภาพ r4 แบบ `unavailable` เช่น Operation เปิดหน้าเลือก
/// Config) — ปุ่มในแอปซ่อนไว้แล้ว แต่ลิงก์/การแจ้งเตือนยังพามาถึงได้ จึงบอกตรงๆ
/// แทนการโหลดข้อมูลแล้วโดน 403
class AppRoleLockedView extends StatelessWidget {
  const AppRoleLockedView({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
      children: [
        Container(
          key: const Key('app_role_locked'),
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            children: [
              const Icon(
                Icons.lock_outline,
                size: 28,
                color: AppColors.accentForeground,
              ),
              const SizedBox(height: 10),
              const Text(
                'บทบาทนี้ไม่มีสิทธิ์ใช้หน้านี้',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 6),
              const Text(
                'กลับไปค้นหาอุปกรณ์ หรือใช้เมนูที่บทบาทของคุณเข้าถึงได้',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 13,
                  height: 1.4,
                  color: AppColors.mutedForeground,
                ),
              ),
              const SizedBox(height: 16),
              OutlinedButton(
                key: const Key('app_role_locked_home'),
                onPressed: () => context.go(AppRoutes.home),
                child: const Text('กลับไปหน้าหลัก'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
