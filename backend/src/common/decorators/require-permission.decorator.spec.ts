import { Reflector } from '@nestjs/core';
import { ActionType } from '@prisma/client';
import {
  PERMISSION_KEY,
  RequiredPermission,
  RequirePermission,
} from './require-permission.decorator';

describe('RequirePermission decorator', () => {
  it('แนบ metadata { resource, action } ไว้ที่ method อ่านกลับด้วย Reflector ได้ตรงตามที่ใส่', () => {
    class Dummy {
      @RequirePermission('config', ActionType.Update)
      // this: void — method นี้ไม่ใช้ `this` เลย ประกาศไว้กัน lint rule
      // @typescript-eslint/unbound-method ตอนอ้างอิง method เฉยๆ (ไม่เรียก)
      // ด้านล่าง (ต้องอ้างอิง function object ตัวเดิมเป๊ะ ห้าม .bind() เพราะ
      // metadata ผูกกับ function reference เดิมที่ decorator แปะไว้เท่านั้น)
      handler(this: void) {
        return undefined;
      }
    }

    const reflector = new Reflector();
    const metadata = reflector.get<RequiredPermission | undefined>(
      PERMISSION_KEY,
      Dummy.prototype.handler,
    );

    expect(metadata).toEqual({
      resource: 'config',
      action: ActionType.Update,
    });
  });

  it('method ที่ไม่ได้ใส่ decorator ไว้เลย -> ไม่มี metadata (undefined)', () => {
    class Dummy {
      handler(this: void) {
        return undefined;
      }
    }

    const reflector = new Reflector();
    const metadata = reflector.get<RequiredPermission | undefined>(
      PERMISSION_KEY,
      Dummy.prototype.handler,
    );

    expect(metadata).toBeUndefined();
  });
});
