import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService, LoginResult } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/v1/auth/login (ดู docs/api/openapi.yaml — public, security: [])
   */
  @Post('login')
  @HttpCode(HttpStatus.OK) // openapi.yaml ระบุ 200 ไม่ใช่ 201 default ของ POST
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.authService.login(dto.username, dto.password);
  }
}
