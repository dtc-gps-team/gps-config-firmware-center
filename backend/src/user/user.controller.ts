import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { QueryUserDto } from './dto/query-user.dto';
import { UserService, UserSummary } from './user.service';

// user module (read-only — Sprint 3 #19):
//   GET /users?role=<code>  — รายชื่อ user แบบย่อ (id + ชื่อ + role)
//
// JwtAuthGuard อย่างเดียว ไม่มี PermissionGuard — ทุก role ที่ login เรียกได้
// (pattern เดียวกับ `/notifications/device-tokens`) · **ไม่ใช่** จอ User / Role
// Management (RBAC_Matrix.md §2 = Admin เท่านั้น) ที่ยังไม่ทำ (docs/11 Part B2)
// — endpoint นี้เกิดมาเพื่อ dropdown "เจาะจงผู้อนุมัติ" ใน Approval Center คืน
// แค่ชื่อ ไม่มีข้อมูล sensitive
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  list(@Query() query: QueryUserDto): Promise<UserSummary[]> {
    return this.userService.list(query);
  }
}
