import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/config/app_config.dart';

/// Login-screen colour palette. Scoped to this file on purpose — the shared
/// [AppTheme] drives every other screen (Home, Config Simulator, ทดสอบสัญญาณ)
/// and the redesign only covers Login for now, so nothing here touches the
/// central theme.
class _LoginColors {
  const _LoginColors._();

  /// Deep navy — primary surface for the app mark and the submit button.
  static const primary = Color(0xFF12344D);

  /// Very light, near-white ground with a cool tint. High contrast against the
  /// navy so the screen stays readable outdoors.
  static const background = Color(0xFFF4F6F8);
  static const surface = Colors.white;
  static const fieldBorder = Color(0xFFCED6DE);
  static const fieldBorderFocused = primary;
  static const label = Color(0xFF51606B);
  static const title = Color(0xFF12344D);
  static const subtitle = Color(0xFF5F6E79);
  static const error = Color(0xFFC0392B);
}

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
    Widget? suffixIcon,
  }) {
    const border = OutlineInputBorder(
      borderRadius: BorderRadius.all(Radius.circular(10)),
      borderSide: BorderSide(color: _LoginColors.fieldBorder),
    );
    return InputDecoration(
      labelText: label,
      hintText: hint,
      filled: true,
      fillColor: _LoginColors.surface,
      labelStyle: const TextStyle(color: _LoginColors.label),
      floatingLabelStyle: const TextStyle(color: _LoginColors.primary),
      hintStyle: TextStyle(color: _LoginColors.label.withValues(alpha: 0.6)),
      suffixIcon: suffixIcon,
      enabledBorder: border,
      border: border,
      focusedBorder: border.copyWith(
        borderSide: const BorderSide(
          color: _LoginColors.fieldBorderFocused,
          width: 1.6,
        ),
      ),
      errorBorder: border.copyWith(
        borderSide: const BorderSide(color: _LoginColors.error),
      ),
      focusedErrorBorder: border.copyWith(
        borderSide: const BorderSide(color: _LoginColors.error, width: 1.6),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);

    return Scaffold(
      backgroundColor: _LoginColors.background,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Center(child: _AppMark()),
                    const SizedBox(height: 24),
                    const Text(
                      'GPS Config & Firmware Center',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w700,
                        height: 1.25,
                        color: _LoginColors.title,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'ระบบบริการและตั้งค่าอุปกรณ์ภาคสนาม',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 14,
                        color: _LoginColors.subtitle,
                      ),
                    ),
                    if (AppConfig.apiMockMode) ...[
                      const SizedBox(height: 16),
                      const _MockModeBanner(),
                    ],
                    const SizedBox(height: 32),
                    TextFormField(
                      key: const Key('login_username'),
                      controller: _usernameController,
                      autocorrect: false,
                      enableSuggestions: false,
                      textInputAction: TextInputAction.next,
                      decoration: _fieldDecoration(
                        label: 'ชื่อผู้ใช้',
                        hint: 'กรอกชื่อผู้ใช้ของคุณ',
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
                        suffixIcon: IconButton(
                          key: const Key('login_password_toggle'),
                          onPressed: () => setState(
                            () => _obscurePassword = !_obscurePassword,
                          ),
                          icon: Icon(
                            _obscurePassword
                                ? Icons.visibility_outlined
                                : Icons.visibility_off_outlined,
                            color: _LoginColors.label,
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
                            color: _LoginColors.error,
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              auth.error!,
                              key: const Key('login_error'),
                              style: const TextStyle(
                                color: _LoginColors.error,
                                fontSize: 13,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: 24),
                    _SubmitButton(busy: auth.isBusy, onPressed: _submit),
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
        color: _LoginColors.primary,
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
        backgroundColor: _LoginColors.primary,
        foregroundColor: Colors.white,
        disabledBackgroundColor: _LoginColors.primary.withValues(alpha: 0.5),
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
        style: TextStyle(color: _LoginColors.label),
        textAlign: TextAlign.center,
      ),
    );
  }
}
