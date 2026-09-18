import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/config/app_config.dart';
import '../../core/theme/app_theme.dart';

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
    const border = OutlineInputBorder(
      borderRadius: BorderRadius.all(Radius.circular(10)),
      borderSide: BorderSide(color: AppTheme.fieldBorder),
    );
    return InputDecoration(
      labelText: label,
      hintText: hint,
      filled: true,
      fillColor: AppTheme.surface,
      labelStyle: const TextStyle(color: AppTheme.label),
      floatingLabelStyle: const TextStyle(color: AppTheme.navy),
      hintStyle: TextStyle(color: AppTheme.label.withValues(alpha: 0.6)),
      prefixIcon: prefixIcon,
      suffixIcon: suffixIcon,
      enabledBorder: border,
      border: border,
      focusedBorder: border.copyWith(
        borderSide: const BorderSide(color: AppTheme.navy, width: 1.6),
      ),
      errorBorder: border.copyWith(
        borderSide: const BorderSide(color: AppTheme.error),
      ),
      focusedErrorBorder: border.copyWith(
        borderSide: const BorderSide(color: AppTheme.error, width: 1.6),
      ),
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

    return Scaffold(
      backgroundColor: AppTheme.background,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: EdgeInsets.symmetric(
              horizontal: 24,
              vertical: keyboardOpen ? 16 : 32,
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (!keyboardOpen) ...[
                      const Center(child: _AppMark()),
                      const SizedBox(height: 24),
                    ],
                    const Text(
                      'GPS Config & Firmware Center',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w700,
                        height: 1.25,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    if (!keyboardOpen) ...[
                      const SizedBox(height: 8),
                      const Text(
                        'ระบบบริการและตั้งค่าอุปกรณ์ภาคสนาม',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 14,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                    ],
                    if (AppConfig.apiMockMode && !keyboardOpen) ...[
                      const SizedBox(height: 16),
                      const _MockModeBanner(),
                    ],
                    SizedBox(height: keyboardOpen ? 16 : 32),
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
                          color: AppTheme.label,
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
                          color: AppTheme.label,
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
                            color: AppTheme.label,
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
                        children: [
                          const Icon(
                            Icons.error_outline,
                            size: 18,
                            color: AppTheme.error,
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              auth.error!,
                              key: const Key('login_error'),
                              style: const TextStyle(
                                color: AppTheme.error,
                                fontSize: 13,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: 24),
                    _SubmitButton(busy: auth.isBusy, onPressed: _submit),
                    if (!keyboardOpen) ...[
                      const SizedBox(height: 24),
                      const _AppVersionText(),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Rounded navy tile with a location/target glyph — no text inside.
class _AppMark extends StatelessWidget {
  const _AppMark();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 76,
      height: 76,
      decoration: BoxDecoration(
        color: AppTheme.navy,
        borderRadius: BorderRadius.circular(20),
      ),
      child: const Icon(Icons.my_location, color: Colors.white, size: 40),
    );
  }
}

class _SubmitButton extends StatelessWidget {
  const _SubmitButton({required this.busy, required this.onPressed});

  final bool busy;
  final Future<void> Function() onPressed;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      key: const Key('login_submit'),
      onPressed: busy ? null : onPressed,
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        backgroundColor: AppTheme.navy,
        foregroundColor: Colors.white,
        disabledBackgroundColor: AppTheme.navy.withValues(alpha: 0.5),
        disabledForegroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
      child: busy
          ? const SizedBox(
              height: 22,
              width: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: Colors.white,
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
        style: TextStyle(
          fontSize: 11,
          color: AppTheme.textSecondary.withValues(alpha: 0.7),
        ),
      ),
      loading: () => const SizedBox.shrink(key: Key('login_app_version')),
      error: (_, _) => const SizedBox.shrink(key: Key('login_app_version')),
    );
  }
}

class _MockModeBanner extends StatelessWidget {
  const _MockModeBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFE8EEF3),
        borderRadius: BorderRadius.circular(8),
      ),
      child: const Text(
        'API_MOCK_MODE — ล็อกอินด้วย prefix ของ role ได้ทันที '
        '(sw / op / st / ot / admin / audit)',
        style: TextStyle(color: AppTheme.label),
        textAlign: TextAlign.center,
      ),
    );
  }
}
