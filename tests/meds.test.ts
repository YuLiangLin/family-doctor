import { describe, expect, it } from 'vitest';
import {
  courseProgress,
  dosesOn,
  isScheduledOn,
  packCourses,
  packLabel,
  packsOn,
  reminderText,
  scheduleLabel,
  shortClinic,
  slotAt,
  slotsForTimes,
  takenAtProblem,
  type DoseMark,
  type MedSchedule,
  type PackSchedule,
} from '../src/shared/meds';

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

  it('提醒內容只列還沒吃完的那幾包，依家人分行', () => {
    expect(
      reminderText('noon', [
        { memberName: 'Nathan', label: '聖青診所的藥（3 種）', done: false },
        { memberName: 'Nathan', label: '維他命', done: false },
        { memberName: '蓉蓉', label: '小兒科的藥（2 種）', done: true },
      ]),
    ).toEqual({ title: '☀️ 中午吃藥時間', body: 'Nathan：聖青診所的藥（3 種）、維他命' });
    expect(reminderText('noon', [{ memberName: 'x', label: 'y', done: true }])).toBeNull();
  });

  it('Cron 時間 → 時段', () => {
    expect(slotAt('08:00')).toBe('morning');
    expect(slotAt('12:31')).toBe('noon');
    expect(slotAt('18:30')).toBe('evening');
    expect(slotAt('21:30')).toBe('bedtime');
    expect(slotAt('15:00')).toBeNull();
  });
});

// 一包一包：同一次看診（同一位醫生）、同一個時段、同樣飯前／飯後的藥，診所包在同一包
describe('一包一包打勾', () => {
  const base = { asNeeded: false, startDate: '2026-11-03', days: 3, stoppedAt: null } as const;
  // 聖青診所（看診 10）：抗生素三餐飯後、抗過敏早晚飯後、胃藥早上飯前
  const cef: PackSchedule = { ...base, id: 1, memberId: 1, visitId: 10, slots: ['morning', 'noon', 'evening'], timing: 'after' };
  const fex: PackSchedule = { ...base, id: 2, memberId: 1, visitId: 10, slots: ['morning', 'evening'], timing: 'after' };
  const stomach: PackSchedule = { ...base, id: 3, memberId: 1, visitId: 10, slots: ['morning'], timing: 'before' };
  // 同一天另一位醫生（看診 11，皮膚科）：睡前一包
  const skin: PackSchedule = { ...base, id: 4, memberId: 1, visitId: 11, slots: ['bedtime'], timing: 'after' };
  // 自己買的維他命（沒有看診）：一種一包
  const vitamin: PackSchedule = { ...base, id: 5, memberId: 1, visitId: null, slots: ['morning'], timing: 'after', days: null };
  // 小孩的小兒科藥：同一個時段也是另一包
  const kid: PackSchedule = { ...base, id: 6, memberId: 2, visitId: 12, slots: ['morning', 'noon', 'evening'], timing: 'after' };
  const meds = [cef, fex, stomach, skin, vitamin, kid];
  const mark = (medicationId: number, doseDate: string, slot: string, status: 'taken' | 'skipped' = 'taken'): DoseMark => ({ medicationId, doseDate, slot, status });

  it('同一次看診同一個時段是一包；飯前另一包、別的醫生另一包、自己買的一種一包', () => {
    const packs = packsOn(meds, [], '2026-11-04');
    expect(packs.map((p) => `${p.slot}:${p.doses.map((d) => d.medicationId).join('+')}`)).toEqual([
      'morning:3', // 聖青飯前（胃藥）排在飯後前面
      'morning:1+2',
      'morning:5',
      'morning:6',
      'noon:1',
      'noon:6',
      'evening:1+2',
      'evening:6',
      'bedtime:4',
    ]);
    expect(packs[0].groupKey).toBe(packs[1].groupKey);
    expect(packs[0].key).not.toBe(packs[1].key);
    expect(packs[8].timing).toBe('any'); // 睡前不分飯前飯後
  });

  it('整包都勾了才算吃了；只勾幾種是 partial；全部跳過是 skipped', () => {
    const day = '2026-11-04';
    const status = (marks: DoseMark[]) => packsOn([cef, fex], marks, day)[0].status;
    expect(status([])).toBeNull();
    expect(status([mark(1, day, 'morning')])).toBe('partial');
    expect(status([mark(1, day, 'morning'), mark(2, day, 'morning')])).toBe('taken');
    expect(status([mark(1, day, 'morning'), mark(2, day, 'morning', 'skipped')])).toBe('taken');
    expect(status([mark(1, day, 'morning', 'skipped'), mark(2, day, 'morning', 'skipped')])).toBe('skipped');
  });

  it('療程一份一份算：聖青三天共 9 包（早上飯前、飯後算兩包就是 12 包）', () => {
    const marks = [
      mark(1, '2026-11-03', 'noon'),
      mark(1, '2026-11-03', 'evening'),
      mark(2, '2026-11-03', 'evening'),
      mark(1, '2026-11-04', 'morning'),
      mark(2, '2026-11-04', 'morning'), // 11/4 早上飯後那包整包吃了；胃藥（飯前）沒勾
    ];
    const [c] = packCourses([cef, fex], marks, '2026-11-04');
    expect(c.medicationIds).toEqual([1, 2]);
    expect(c.dayNo).toBe(2);
    expect(c.totalDays).toBe(3);
    expect(c.totalPacks).toBe(9);
    expect(c.taken).toBe(3);
    expect(c.remaining).toBe(6);
    expect(c.missedBeforeToday).toBe(1); // 11/3 早上（看完醫生中午才開始吃）
    const withStomach = packCourses([cef, fex, stomach], marks, '2026-11-04')[0];
    expect(withStomach.totalPacks).toBe(12);
    expect(withStomach.taken).toBe(3);
    expect(withStomach.missedBeforeToday).toBe(2);
  });

  it('不同看診、不同家人、自己買的各算各的；長期吃的沒有總包數', () => {
    const courses = packCourses(meds, [], '2026-11-04');
    expect(courses.map((c) => c.medicationIds.join('+'))).toEqual(['1+2+3', '4', '5', '6']);
    const vit = courses.find((c) => c.visitId === null)!;
    expect(vit.totalPacks).toBeNull();
    expect(vit.dueSoFar).toBe(2);
    expect(vit.missedBeforeToday).toBe(1);
  });

  it('提早停藥：那份藥算到最晚停的那一種', () => {
    const [c] = packCourses([{ ...cef, stoppedAt: '2026-11-04' }, fex], [], '2026-11-10');
    expect(c.totalDays).toBe(3);
    expect(c.totalPacks).toBe(3 + 2 + 2); // 11/3 抗生素＋抗過敏 3 包；11/4、11/5 只剩抗過敏早晚
  });

  it('提醒裡叫什麼：診所（拿掉分店）＋幾種；自己買的叫藥名', () => {
    expect(shortClinic('蔡醫師皮膚科診所（高雄市前鎮區）')).toBe('蔡醫師皮膚科診所');
    expect(shortClinic('聖青診所')).toBe('聖青診所');
    const [before, after] = packsOn([cef, fex, stomach], [], '2026-11-04');
    expect(packLabel(after, '聖青診所 (高雄)', 'CEPHALEXIN')).toBe('聖青診所的藥（2 種）');
    expect(packLabel(before, '聖青診所', 'GASTRO', true)).toBe('聖青診所飯前的藥（1 種）');
    expect(packLabel(packsOn([vitamin], [], '2026-11-04')[0], '', '維他命')).toBe('維他命');
  });

  it('實際吃藥時間：不能晚於現在、要在那天（半夜吃的可以到隔天早上 6 點）', () => {
    const now = '2026-11-07 15:49:22';
    expect(takenAtProblem('2026-11-07', '2026-11-07 08:20', now)).toBeNull();
    expect(takenAtProblem('2026-11-07', '2026-11-07 15:49', now)).toBeNull();
    expect(takenAtProblem('2026-11-07', '2026-11-07 15:50', now)).toBe('吃藥時間不能晚於現在');
    expect(takenAtProblem('2026-11-06', '2026-11-07 01:30', now)).toBeNull();
    expect(takenAtProblem('2026-11-06', '2026-11-07 08:00', now)).toBe('吃藥時間要在 11/6 當天');
    expect(takenAtProblem('2026-11-07', '2026-11-06 23:00', now)).toBe('吃藥時間要在 11/7 當天');
  });
});
