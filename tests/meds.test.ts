import { describe, expect, it } from 'vitest';
import { courseProgress, dosesOn, isScheduledOn, reminderText, scheduleLabel, slotAt, slotsForTimes, type MedSchedule } from '../src/shared/meds';

// 2026-11-03 聖青診所的三種藥（假資料，同樣的開法）
const antibiotic: MedSchedule = { id: 1, memberId: 1, slots: ['morning', 'noon', 'evening'], asNeeded: false, startDate: '2026-11-03', days: 3, stoppedAt: null };
const allergy: MedSchedule = { id: 3, memberId: 1, slots: ['morning', 'evening'], asNeeded: false, startDate: '2026-11-03', days: 3, stoppedAt: null };
const prn: MedSchedule = { id: 4, memberId: 2, slots: [], asNeeded: true, startDate: '2026-11-01', days: null, stoppedAt: null };

describe('用藥排程', () => {
  it('一天幾次 → 時段', () => {
    expect(slotsForTimes(3)).toEqual(['morning', 'noon', 'evening']);
    expect(slotsForTimes(2)).toEqual(['morning', 'evening']);
    expect(slotsForTimes(4)).toEqual(['morning', 'noon', 'evening', 'bedtime']);
  });

  it('藥袋的寫法', () => {
    expect(scheduleLabel(['morning', 'noon', 'evening'], 'after', false)).toBe('一天 3 次・三餐飯後');
    expect(scheduleLabel(['morning', 'evening'], 'after', false)).toBe('一天 2 次・早晚飯後');
    expect(scheduleLabel(['morning'], 'before', false)).toBe('一天 1 次・早餐飯前');
    expect(scheduleLabel(['bedtime'], 'any', false)).toBe('一天 1 次・睡前');
    expect(scheduleLabel([], 'after', true)).toBe('需要時服用');
  });

  it('3 天份：11/3～11/5 要吃，11/6 起不用', () => {
    expect(isScheduledOn(antibiotic, '2026-11-02')).toBe(false);
    expect(isScheduledOn(antibiotic, '2026-11-03')).toBe(true);
    expect(isScheduledOn(antibiotic, '2026-11-05')).toBe(true);
    expect(isScheduledOn(antibiotic, '2026-11-06')).toBe(false);
    expect(isScheduledOn(prn, '2026-11-03')).toBe(false);
  });

  it('停藥那天起不排', () => {
    const stopped = { ...antibiotic, stoppedAt: '2026-11-05' };
    expect(isScheduledOn(stopped, '2026-11-04')).toBe(true);
    expect(isScheduledOn(stopped, '2026-11-05')).toBe(false);
  });

  it('某天的每一包（依時段排）＋打勾', () => {
    const doses = dosesOn([antibiotic, allergy, prn], [{ medicationId: 1, doseDate: '2026-11-04', slot: 'morning', status: 'taken' }], '2026-11-04');
    expect(doses.map((d) => `${d.medicationId}-${d.slot}`)).toEqual(['1-morning', '3-morning', '1-noon', '1-evening', '3-evening']);
    expect(doses[0].mark?.status).toBe('taken');
    expect(doses[1].mark).toBeNull();
  });

  it('療程進度：第幾天、還剩幾包、漏打勾', () => {
    const marks = [
      { medicationId: 1, doseDate: '2026-11-03', slot: 'noon', status: 'taken' as const },
      { medicationId: 1, doseDate: '2026-11-03', slot: 'evening', status: 'taken' as const },
      { medicationId: 1, doseDate: '2026-11-04', slot: 'morning', status: 'taken' as const },
    ];
    const p = courseProgress(antibiotic, marks, '2026-11-04');
    expect(p.dayNo).toBe(2);
    expect(p.totalDays).toBe(3);
    expect(p.totalDoses).toBe(9);
    expect(p.taken).toBe(3);
    expect(p.remaining).toBe(6);
    // 11/3 早上沒打勾（看完醫生中午才開始吃）
    expect(p.missedBeforeToday).toBe(1);
  });

  it('提早停藥：總包數照實際天數算', () => {
    const p = courseProgress({ ...antibiotic, stoppedAt: '2026-11-04' }, [], '2026-11-10');
    expect(p.totalDays).toBe(1);
    expect(p.totalDoses).toBe(3);
  });

  it('長期吃的沒有剩幾包', () => {
    const p = courseProgress({ ...allergy, days: null }, [], '2026-11-13');
    expect(p.dayNo).toBe(11);
    expect(p.remaining).toBeNull();
  });

  it('提醒內容只列還沒吃的，依家人分行', () => {
    expect(
      reminderText('noon', [
        { memberName: 'Nathan', medName: 'CEPHALEXIN', done: false },
        { memberName: 'Nathan', medName: 'SUBILIN', done: false },
        { memberName: '蓉蓉', medName: '退燒藥水', done: true },
      ]),
    ).toEqual({ title: '☀️ 中午吃藥時間', body: 'Nathan：CEPHALEXIN、SUBILIN' });
    expect(reminderText('noon', [{ memberName: 'x', medName: 'y', done: true }])).toBeNull();
  });

  it('Cron 時間 → 時段', () => {
    expect(slotAt('08:00')).toBe('morning');
    expect(slotAt('12:31')).toBe('noon');
    expect(slotAt('18:30')).toBe('evening');
    expect(slotAt('21:30')).toBe('bedtime');
    expect(slotAt('15:00')).toBeNull();
  });
});
