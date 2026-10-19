import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/config/app_config.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_card.dart';
import '../../core/ui/app_v2_theme.dart';

/// App version/build shown at the bottom of Login — read once per app
/// session (`PackageInfo.fromPlatform()` reflects the installed package, not
/// something that changes at runtime).
final _packageInfoProvider = FutureProvider<PackageInfo>(
  (ref) => PackageInfo.fromPlatform(),
);

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    await ref
        .read(authControllerProvider.notifier)
        .login(_usernameController.text, _passwordController.text);
  }

  InputDecoration _fieldDecoration({
    required String label,
    required String hint,
    Widget? prefixIcon,
    Widget? suffixIcon,
  }) {
    // ขอบ / radius / focus มาจาก inputDecorationTheme ของ theme v2 (ขอบ
    // `inputBorder #576171` ผ่าน 3:1 — docs/22 §4.3) · ที่ตั้งตรงนี้เหลือแค่พื้น
    // ขาวให้ช่องเด่นจากพื้นหลัง และสีตัวอักษร
    return InputDecoration(
      labelText: label,
      hintText: hint,
      filled: true,
      fillColor: AppColors.card,
      labelStyle: const TextStyle(color: AppColors.mutedForeground),
      floatingLabelStyle: const TextStyle(color: AppColors.primary),
      hintStyle: const TextStyle(color: AppColors.mutedForeground),
      prefixIcon: prefixIcon,
      suffixIcon: suffixIcon,
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);

    // เมื่อคีย์บอร์ดเปิด (โดยเฉพาะจอเล็ก/ความละเอียดต่ำ) พื้นที่เหนือคีย์บอร์ด
    // เหลือไม่พอให้ทั้งโลโก้ + หัวข้อ + คำอธิบาย + ช่องกรอกทั้ง 2 + ปุ่ม login
    // แสดงพร้อมกันได้ — ย่อส่วนที่ไม่จำเป็นตอนกรอกฟอร์ม (โลโก้, คำอธิบายรอง,
    // mock banner, เวอร์ชันแอป) ออกไปก่อน เพื่อให้ปุ่ม login ยังอยู่ในระยะที่
    // เลื่อนขึ้นมาเห็นได้ง่ายกว่าเดิม โดยไม่ต้องเขียนโครง layout ใหม่ทั้งหมด
    final keyboardOpen = MediaQuery.of(context).viewInsets.bottom > 0;

    // design system ใหม่ (docs/22 Batch 2) — ฟอร์มอยู่ใน AppCard แบบหน้า login
    // ของ Web · ไม่มี AppPageHeader (docs/22 §7.1: ทุกหน้ายกเว้น Login)
    return AppV2Theme(
      child: Scaffold(
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: EdgeInsets.symmetric(
                horizontal: 16,
                vertical: keyboardOpen ? 16 : 32,
              ),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: AppCard(
                  child: Form(
                    key: _formKey,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (!keyboardOpen) ...[
                          const SizedBox(height: 8),
                          const Center(child: _AppMark()),
                          const SizedBox(height: 16),
                        ],
                        const Text(
                          'GPS Config & Firmware Center',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: AppTypography.xxl,
                            height: AppTypography.xxlHeight,
                            fontWeight: FontWeight.w600,
                            color: AppColors.foreground,
                          ),
                        ),
                        if (!keyboardOpen) ...[
                          const SizedBox(height: 8),
                          const Text(
                            'ระบบบริการและตั้งค่าอุปกรณ์ภาคสนาม',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: AppTypography.base,
                              height: AppTypography.baseHeight,
                              color: AppColors.mutedForeground,
                            ),
                          ),
                        ],
                        if (AppConfig.apiMockMode && !keyboardOpen) ...[
                          const SizedBox(height: 16),
                          const _MockModeBanner(),
                        ],
                        SizedBox(height: keyboardOpen ? 16 : 24),
                        TextFormField(
                          key: const Key('login_username'),
                          controller: _usernameController,
                          autocorrect: false,
                          enableSuggestions: false,
                          textInputAction: TextInputAction.next,
                          decoration: _fieldDecoration(
                            label: 'ชื่อผู้ใช้',
                            hint: 'กรอกชื่อผู้ใช้ของคุณ',
                            prefixIcon: const Icon(
                              Icons.person_outline,
                              color: AppColors.mutedForeground,
                            ),
                          ),
                          validator: (value) =>
                              (value == null || value.trim().isEmpty)
                              ? 'กรุณากรอก Username'
                              : null,
                        ),
                        const SizedBox(height: 16),
                        TextFormField(
                          key: const Key('login_password'),
                          controller: _passwordController,
                          obscureText: _obscurePassword,
                          textInputAction: TextInputAction.done,
                          onFieldSubmitted: (_) => _submit(),
                          decoration: _fieldDecoration(
                            label: 'รหัสผ่าน',
                            hint: 'กรอกรหัสผ่าน',
                            prefixIcon: const Icon(
                              Icons.lock_outline,
                              color: AppColors.mutedForeground,
                            ),
                            suffixIcon: IconButton(
                              key: const Key('login_password_toggle'),
                              onPressed: () => setState(
                                () => _obscurePassword = !_obscurePassword,
                              ),
                              icon: Icon(
                                _obscurePassword
                                    ? Icons.visibility_outlined
                                    : Icons.visibility_off_outlined,
                                color: AppColors.mutedForeground,
                              ),
                              tooltip: _obscurePassword
                                  ? 'แสดงรหัสผ่าน'
                                  : 'ซ่อนรหัสผ่าน',
                            ),
                          ),
                          validator: (value) => (value == null || value.isEmpty)
                              ? 'กรุณากรอก Password'
                              : null,
                        ),
                        if (auth.error != null) ...[
                          const SizedBox(height: 12),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Padding(
                                padding: EdgeInsets.only(top: 3),
                                child: Icon(
                                  Icons.error_outline,
                                  size: 18,
                                  color: AppColors.destructive,
                                ),
                              ),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  auth.error!,
                                  key: const Key('login_error'),
                                  style: const TextStyle(
                                    color: AppColors.destructive,
                                    fontSize: AppTypography.sm,
                                    height: AppTypography.smHeight,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                        const SizedBox(height: 24),
                        _SubmitButton(busy: auth.isBusy, onPressed: _submit),
                        if (!keyboardOpen) ...[
                          const SizedBox(height: 16),
                          const _AppVersionText(),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// สัญลักษณ์ของระบบแบบ `LogoMark` ของ Web — หมุดตำแหน่งในกรอบสี primary
/// (`size-14 rounded-xl` = 56 / มุม 14) ไม่มีตัวอักษร
class _AppMark extends StatelessWidget {
  const _AppMark();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 56,
      height: 56,
      decoration: BoxDecoration(
        color: AppColors.primary,
        borderRadius: BorderRadius.circular(AppRadius.xl),
      ),
      child: const Icon(
        Icons.location_on_outlined,
        color: AppColors.primaryForeground,
        size: 30,
      ),
    );
  }
}

class _SubmitButton extends StatelessWidget {
  const _SubmitButton({required this.busy, required this.onPressed});

  final bool busy;
  final Future<void> Function() onPressed;

  @override
  Widget build(BuildContext context) {
    // สี / มุม / ความสูง 48 มาจาก filledButtonTheme ของ theme v2 · เต็มความกว้าง
    // เพราะอยู่ใน Column ที่ stretch
    return FilledButton(
      key: const Key('login_submit'),
      onPressed: busy ? null : onPressed,
      child: busy
          ? const SizedBox(
              height: 22,
              width: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: AppColors.primaryForeground,
              ),
            )
          : const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text('เข้าสู่ระบบ'),
                SizedBox(width: 8),
                Icon(Icons.arrow_forward, size: 18),
              ],
            ),
    );
  }
}

/// "เวอร์ชัน x.y.z (build n)" ท้ายจอ Login — เงียบๆ ถ้าอ่านไม่สำเร็จ (ไม่ใช่
/// ข้อมูลที่จำเป็นต่อการ login เลยไม่ต้องมี error state ของตัวเอง).
class _AppVersionText extends ConsumerWidget {
  const _AppVersionText();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final packageInfo = ref.watch(_packageInfoProvider);
    return packageInfo.when(
      data: (info) => Text(
        key: const Key('login_app_version'),
        'เวอร์ชัน ${info.version} (build ${info.buildNumber})',
        textAlign: TextAlign.center,
        style: const TextStyle(
          fontSize: AppTypography.xs,
          height: AppTypography.xsHeight,
          color: AppColors.mutedForeground,
        ),
      ),
      loading: () => const SizedBox.shrink(key: Key('login_app_version')),
      error: (_, _) => const SizedBox.shrink(key: Key('login_app_version')),
    );
  }
}

/// คำใบ้ตอนเปิด mock mode — prefix ที่ login เข้า Mobile ได้จริงมีแค่ op / st / ot
/// (`audit` / `admin` ถูกบล็อกด้วย `webOnlyRoles` · `sw` ไม่มีแล้วตั้งแต่แยก role
/// ใน #174) — docs/21 #19
class _MockModeBanner extends StatelessWidget {
  const _MockModeBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.secondary,
        borderRadius: BorderRadius.circular(AppRadius.lg),
      ),
      child: const Text(
        'API_MOCK_MODE — ล็อกอินด้วย prefix ของ role ได้ทันที (op / st / ot)',
        key: Key('login_mock_hint'),
        style: TextStyle(
          color: AppColors.mutedForeground,
          fontSize: AppTypography.sm,
          height: AppTypography.smHeight,
        ),
        textAlign: TextAlign.center,
      ),
    );
  }
}
