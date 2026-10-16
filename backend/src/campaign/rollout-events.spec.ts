import {
  maxSeverity,
  ROLLOUT_FAILED_EVENT,
  RolloutEvents,
  rolloutFailureSeverity,
} from './rollout-events';

describe('rollout-events', () => {
  describe('rolloutFailureSeverity', () => {
    const base = {
      autoPaused: false,
      timeoutFailureCount: 0,
      windowFailureCount: 0,
      skippedCount: 0,
      targetCount: 100,
      threshold: 0.05,
    };

    it('มีเครื่องดึงแล้วเงียบ -> critical (ชนะ Auto Pause)', () => {
      expect(
        rolloutFailureSeverity({
          ...base,
          autoPaused: true,
          timeoutFailureCount: 1,
        }),
      ).toBe('critical');
    });

    it('Auto Pause -> high', () => {
      expect(rolloutFailureSeverity({ ...base, autoPaused: true })).toBe(
        'high',
      );
    });

    it('ล้มเกินเกณฑ์ -> high / เท่าหรือต่ำกว่าเกณฑ์ -> medium', () => {
      expect(rolloutFailureSeverity({ ...base, windowFailureCount: 6 })).toBe(
        'high',
      );
      expect(rolloutFailureSeverity({ ...base, windowFailureCount: 5 })).toBe(
        'medium',
      );
    });

    it('ไม่มีเครื่องล้ม มีแต่ถูกข้าม -> low', () => {
      expect(rolloutFailureSeverity({ ...base, skippedCount: 3 })).toBe('low');
    });

    it('targetCount 0 ไม่หารศูนย์', () => {
      expect(
        rolloutFailureSeverity({
          ...base,
          targetCount: 0,
          windowFailureCount: 1,
        }),
      ).toBe('medium');
    });
  });

  describe('maxSeverity', () => {
    it('เลือกค่าที่สูงกว่า', () => {
      expect(maxSeverity('low', 'high')).toBe('high');
      expect(maxSeverity('critical', 'medium')).toBe('critical');
      expect(maxSeverity('medium', 'medium')).toBe('medium');
    });
  });

  describe('safeEmit', () => {
    it('listener ที่ throw แบบ sync ไม่ทำให้ผู้เรียกล้ม', () => {
      const events = new RolloutEvents();
      events.on(ROLLOUT_FAILED_EVENT, () => {
        throw new Error('พัง');
      });

      expect(() =>
        events.safeEmit(ROLLOUT_FAILED_EVENT, { rolloutId: 'r' } as never),
      ).not.toThrow();
    });
  });
});
