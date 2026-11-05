import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActionType } from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import {
  ActingUser,
  CustomerService,
  CustomerListItem,
  ManagedCustomer,
} from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomerDto } from './dto/query-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role, ipAddress: req.ip ?? null };
}

// customer module (docs/12 เฟส B + มติ A 2026-11-05 จัดการลูกค้า):
//   GET    /customers          — รายชื่อแบบย่อ ทุก role ที่ login (JwtAuthGuard อย่างเดียว) ·
//                                `?activeOnly=true` ตัดลูกค้าที่ปิดใช้งานออก (dropdown ลงทะเบียนอุปกรณ์)
//   GET    /customers/managed  — ข้อมูลเต็ม + จำนวนเครื่อง (resource `customer` Read — Admin/SuperAdmin)
//   POST   /customers          — เพิ่มลูกค้า (resource `customer` Create)
//   PATCH  /customers/{id}     — แก้ข้อมูล/เปลี่ยนชื่อ/ปิด-เปิดใช้งาน (resource `customer` Update)
//   DELETE /customers/{id}     — ลบจริงเฉพาะลูกค้าที่ไม่มีเครื่องผูก (resource `customer` Update —
//                                ระบบไม่มี ActionType.Delete ตามแพทเทิร์นของ config/firmware/campaign)
//
// `GET /customers/managed` เป็น static path ประกาศก่อน `:id` · แยกจาก `GET /customers` เดิมเพราะสิทธิ์ต่างกัน
// (ข้อมูลติดต่อของลูกค้าไม่ควรเปิดให้ทุก role) mirror `/users` กับ `/users/managed`
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Query() query: QueryCustomerDto): Promise<CustomerListItem[]> {
    return this.customerService.findAll(query);
  }

  @Get('managed')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('customer', ActionType.Read)
  listManaged(): Promise<ManagedCustomer[]> {
    return this.customerService.listManaged();
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('customer', ActionType.Create)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateCustomerDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ManagedCustomer> {
    return this.customerService.create(dto, toActor(req));
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('customer', ActionType.Update)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ManagedCustomer> {
    return this.customerService.update(id, dto, toActor(req));
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('customer', ActionType.Update)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.customerService.remove(id, toActor(req));
  }
}
