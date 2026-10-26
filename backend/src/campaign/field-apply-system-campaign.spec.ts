import {
  FIELD_APPLY_SYSTEM_CAMPAIGN_NAME,
  getOrCreateFieldApplySystemCampaign,
} from './field-apply-system-campaign';

describe('getOrCreateFieldApplySystemCampaign', () => {
  it('มี Campaign ระบบอยู่แล้ว -> คืนตัวเดิม ไม่สร้างซ้ำ', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'existing-id' });
    const create = jest.fn();

    const result = await getOrCreateFieldApplySystemCampaign(
      { campaign: { findFirst, create } } as never,
      'op-1',
    );

    expect(result).toEqual({ id: 'existing-id' });
    expect(create).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith({
      where: { name: FIELD_APPLY_SYSTEM_CAMPAIGN_NAME },
      select: { id: true },
    });
  });

  it('ยังไม่มี Campaign ระบบ -> สร้างใหม่ด้วยชื่อที่กำหนด และ createdBy เป็น actor ที่ส่งมา', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({ id: 'new-id' });

    const result = await getOrCreateFieldApplySystemCampaign(
      { campaign: { findFirst, create } } as never,
      'op-1',
    );

    expect(result).toEqual({ id: 'new-id' });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: FIELD_APPLY_SYSTEM_CAMPAIGN_NAME,
        createdBy: 'op-1',
      }) as Record<string, unknown>,
      select: { id: true },
    });
  });
});
