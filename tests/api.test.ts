import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentJobContext,
  ConversationDetail,
  Me,
  MemberDetail,
  TimelineItem,
  TodayResponse,
  VisitDetail,
  VisitDraft,
} from '../src/shared/apiTypes';
import { agentMayCall } from '../src/worker/auth';
import type { Env } from '../src/worker/env';
import { app } from '../src/worker/index';
import { ageText } from '../src/worker/routes/agent';
import { ShimD1 } from './helpers/d1Shim';
import { ShimR2 } from './helpers/r2Shim';

const ADMIN = 'dad@test.com';
const MOM = 'mom@test.com';
const STRANGER = 'nobody@test.com';
const RUNNER = 'agent:runner-id.access';

let shim: ShimD1;
let r2: ShimR2;

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: shim.asD1(),
    FILES: r2.asR2(),
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    SUPER_ADMINS: ADMIN,
    AGENT_CLIENT_IDS: 'runner-id.access=家裡的主機',
    ...overrides,
  };
}

async function call<T = unknown>(
  method: string,
  path: string,
  opts: { body?: unknown; as?: string; env?: Partial<Env>; raw?: Uint8Array; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: T }> {
  const res = await app.request(
    `http://localhost/api${path}`,
    {
      method,
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    },
    env({ DEV_AUTH_EMAIL: opts.as ?? ADMIN, ...opts.env }),
  );
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json: json as T };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);

async function upload(as = ADMIN, kind = 'rx') {
  return call<{ id: number }>('POST', `/attachments?kind=${kind}`, {
    as,
    raw: JPEG,
    headers: { 'Content-Type': 'image/jpeg', 'X-Upload-Filename': encodeURIComponent('藥袋.jpg') },
  });
}

async function seed() {
  await call('GET', '/me'); // 最高管理者第一次登入自動建立
  const dad = await call<{ id: number }>('POST', '/members', { body: { name: 'Nathan', relation: '本人', birthDate: '1985-03-27', sex: 'M' } });
  const kid = await call<{ id: number }>('POST', '/members', { body: { name: '蓉蓉', relation: '女兒', birthDate: '2021-06-10', allergies: '無' } });
  await call('POST', '/users', { body: { email: MOM, name: 'Candy', role: 'member' } });
  return { dad: dad.json.id, kid: kid.json.id };
}

const MEDS = [
  { name: 'CEPHALEXIN 500MG', genericName: 'Cephalexin', category: '抗生素', slots: ['morning', 'noon', 'evening'], timing: 'after', days: 3, mustFinish: true },
  { name: 'SUBILIN 30MG', genericName: 'Pseudoephedrine', category: '鼻塞藥', slots: ['morning', 'noon', 'evening'], timing: 'after', days: 3 },
  { name: 'FEXODINE 60MG', genericName: 'Fexofenadine', category: '抗過敏', slots: ['morning', 'evening'], timing: 'after', days: 3 },
];

beforeEach(() => {
  shim = new ShimD1();
  r2 = new ShimR2();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T05:00:00Z')); // 台北 13:00
});

describe('登入白名單', () => {
  it('最高管理者自動開通；不在名單的人 403；管理者加進來就能用', async () => {
    const me = await call<Me>('GET', '/me');
    expect(me.json.superAdmin).toBe(true);
    expect((await call('GET', '/me', { as: STRANGER })).status).toBe(403);
    await call('POST', '/users', { body: { email: MOM, role: 'member' } });
    expect((await call('GET', '/me', { as: MOM })).status).toBe(200);
    // 家人不能管帳號
    expect((await call('POST', '/users', { as: MOM, body: { email: STRANGER } })).status).toBe(403);
    // 停用就進不來
    await call('PATCH', `/users/${encodeURIComponent(MOM)}`, { body: { active: false } });
    expect((await call('GET', '/me', { as: MOM })).status).toBe(403);
  });

  it('沒設 Access 一律拒絕（正式網域）', async () => {
    const res = await app.request('https://doctor.example.com/api/me', {}, env());
    expect(res.status).toBe(500);
  });

  it('runner 只能走 /api/agent；人不能走 /api/agent', async () => {
    await seed();
    expect((await call('GET', '/members', { as: RUNNER })).status).toBe(403);
    expect((await call('POST', '/agent/jobs/claim', { as: ADMIN, body: {} })).status).toBe(403);
    expect((await call('POST', '/agent/jobs/claim', { as: RUNNER, body: {} })).status).toBe(204);
    expect((await call('POST', '/agent/jobs/claim', { as: 'agent:unknown', body: {} })).status).toBe(403);
    expect(agentMayCall('POST', 'http://x/api/agent/jobs/3/complete')).toBe(true);
    expect(agentMayCall('POST', 'http://x/api/agent/members')).toBe(false);
  });

  it('改資料只收 JSON（擋 CSRF）', async () => {
    const res = await app.request('http://localhost/api/members', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }, env({ DEV_AUTH_EMAIL: ADMIN }));
    expect(res.status).toBe(415);
  });
});

describe('看診與用藥', () => {
  it('存看診＋三種藥＋藥袋照片，今天頁看得到要吃的藥', async () => {
    const { dad } = await seed();
    const photo = await upload();
    const v = await call<{ id: number }>('POST', '/visits', {
      as: MOM,
      body: { memberId: dad, visitDate: '2026-11-03', clinic: '聖青診所', doctor: '謝醫師', reason: '黃鼻涕', medications: MEDS, attachmentIds: [photo.json.id] },
    });
    expect(v.status).toBe(201);
    const detail = await call<VisitDetail>('GET', `/visits/${v.json.id}`);
    expect(detail.json.medications.map((m) => m.genericName)).toEqual(['Cephalexin', 'Pseudoephedrine', 'Fexofenadine']);
    expect(detail.json.medications[0].startDate).toBe('2026-11-03');
    expect(detail.json.attachments[0].filename).toBe('藥袋.jpg');

    const today = await call<TodayResponse>('GET', '/today');
    expect(today.json.date).toBe('2026-11-04');
    expect(today.json.medications).toHaveLength(3);

    // 打勾、再打一次是更新、取消
    const cef = detail.json.medications[0].id;
    expect((await call('POST', '/doses', { body: { medicationId: cef, date: '2026-11-04', slot: 'morning' } })).status).toBe(200);
    expect((await call('POST', '/doses', { body: { medicationId: cef, date: '2026-11-04', slot: 'morning', status: 'skipped' } })).status).toBe(200);
    let logs = (await call<TodayResponse>('GET', '/today')).json.doseLogs;
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('skipped');
    await call('POST', '/doses/clear', { body: { medicationId: cef, date: '2026-11-04', slot: 'morning' } });
    logs = (await call<TodayResponse>('GET', '/today')).json.doseLogs;
    expect(logs).toHaveLength(0);

    // 沒排的時段、還沒到的日子不能打勾
    expect((await call('POST', '/doses', { body: { medicationId: detail.json.medications[2].id, date: '2026-11-04', slot: 'noon' } })).status).toBe(400);
    expect((await call('POST', '/doses', { body: { medicationId: cef, date: '2026-11-05', slot: 'noon' } })).status).toBe(400);
    // 抗生素停藥要寫原因
    expect((await call('POST', `/medications/${cef}/stop`, { body: {} })).status).toBe(400);
    expect((await call('POST', `/medications/${cef}/stop`, { body: { reason: '醫生說可以停' } })).status).toBe(200);
  });

  it('作廢看診連藥一起不見；回診日不能早於看診日', async () => {
    const { dad } = await seed();
    expect((await call('POST', '/visits', { body: { memberId: dad, visitDate: '2026-11-03', followUpDate: '2026-11-01' } })).status).toBe(400);
    const v = await call<{ id: number }>('POST', '/visits', { body: { memberId: dad, visitDate: '2026-11-03', medications: MEDS } });
    await call('POST', `/visits/${v.json.id}/void`, { body: { reason: '打錯人' } });
    expect((await call('GET', `/visits/${v.json.id}`)).status).toBe(404);
    expect((await call<TodayResponse>('GET', '/today')).json.medications).toHaveLength(0);
  });

  it('日記、量測、時間軸；離譜的體溫擋下來', async () => {
    const { dad } = await seed();
    await call('POST', '/notes', { body: { memberId: dad, notedAt: '2026-11-04 13:18', body: '擤鼻涕左側有血絲，頭昏', severity: 2 } });
    expect((await call('POST', '/measurements', { body: { memberId: dad, kind: 'temperature', value: 378, measuredAt: '2026-11-04 13:20' } })).status).toBe(400);
    expect((await call('POST', '/measurements', { body: { memberId: dad, kind: 'temperature', value: 37.8, measuredAt: '2026-11-04 13:20' } })).status).toBe(201);
    expect((await call('POST', '/measurements', { body: { memberId: dad, kind: 'blood_pressure', value: 80, value2: 120, measuredAt: '2026-11-04 13:20' } })).status).toBe(400);
    const tl = await call<TimelineItem[]>('GET', `/timeline?memberId=${dad}`);
    expect(tl.json.map((i) => i.type)).toEqual(['measurement', 'note']);
    const md = await call<MemberDetail>('GET', `/members/${dad}`);
    expect(md.json.measurements[0].value).toBe(37.8);
  });

  it('上傳只收真的照片／PDF', async () => {
    const fake = await call('POST', '/attachments', {
      raw: new TextEncoder().encode('<html>'),
      headers: { 'Content-Type': 'image/jpeg', 'X-Upload-Filename': 'x.jpg' },
    });
    expect(fake.status).toBe(415);
  });
});

describe('Dr.Claude', () => {
  it('問問題 → runner 領走 → 讀內容 → 回覆並幫忙記日記與體溫', async () => {
    const { dad } = await seed();
    await call('PATCH', '/users/me', { body: { memberId: dad } });
    await call('POST', '/visits', { body: { memberId: dad, visitDate: '2026-11-03', clinic: '聖青診所', medications: MEDS } });
    const conv = await call<{ id: number; memberId: number }>('POST', '/chat/conversations', { body: {} });
    expect(conv.json.memberId).toBe(dad);
    const sent = await call<ConversationDetail>('POST', `/chat/conversations/${conv.json.id}/messages`, { body: { body: '尿尿會火熱，體溫 37.6，要緊嗎？' } });
    expect(sent.status).toBe(201);
    expect(sent.json.pending?.status).toBe('queued');
    expect(sent.json.runner.online).toBe(false);
    // 一次只能一件
    expect((await call('POST', `/chat/conversations/${conv.json.id}/messages`, { body: { body: '再問' } })).status).toBe(409);

    const claim = await call<{ id: number; kind: string }>('POST', '/agent/jobs/claim', { as: RUNNER, body: {} });
    expect(claim.json.kind).toBe('chat');
    const ctx = await call<AgentJobContext>('GET', `/agent/jobs/${claim.json.id}`, { as: RUNNER });
    expect(ctx.json.asker.memberId).toBe(dad);
    expect(ctx.json.conversation?.messages.at(-1)?.body).toContain('尿尿');
    expect(ctx.json.activeMedications.map((m) => m.progress)[0]).toContain('第 2/3 天');
    expect(ctx.json.members[0].ageText).toBe('41 歲');

    const done = await call('POST', `/agent/jobs/${claim.json.id}/complete`, {
      as: RUNNER,
      body: {
        reply: '有可能是泌尿道感染，建議回診驗尿。',
        mood: 'concerned',
        actions: [
          { type: 'note', memberId: dad, body: '尿尿灼熱', severity: 2 },
          { type: 'measurement', memberId: dad, kind: 'temperature', value: 37.6 },
        ],
      },
    });
    expect(done.status).toBe(200);
    const detail = await call<ConversationDetail>('GET', `/chat/conversations/${conv.json.id}`);
    expect(detail.json.pending).toBeNull();
    expect(detail.json.runner.online).toBe(true);
    const reply = detail.json.messages.at(-1)!;
    expect(reply.mood).toBe('concerned');
    expect(reply.actions.map((a) => a.type)).toEqual(['note', 'measurement']);
    const md = await call<MemberDetail>('GET', `/members/${dad}`);
    expect(md.json.notes[0].source).toBe('dr_claude');
    expect(md.json.measurements[0].measuredAt).toBe('2026-11-04 13:00');
    // 已完成的不能再送
    expect((await call('POST', `/agent/jobs/${claim.json.id}/complete`, { as: RUNNER, body: { reply: 'x' } })).status).toBe(409);
  });

  it('runner 給的量測離譜、家人不存在 → 整件拒絕，不會存一半', async () => {
    const { dad } = await seed();
    const conv = await call<{ id: number }>('POST', '/chat/conversations', { body: { memberId: dad } });
    await call('POST', `/chat/conversations/${conv.json.id}/messages`, { body: { body: '幫我記體溫' } });
    const claim = await call<{ id: number }>('POST', '/agent/jobs/claim', { as: RUNNER, body: {} });
    const bad = await call('POST', `/agent/jobs/${claim.json.id}/complete`, {
      as: RUNNER,
      body: { reply: '記好了', actions: [{ type: 'note', memberId: dad, body: 'ok' }, { type: 'measurement', memberId: dad, kind: 'temperature', value: 99 }] },
    });
    expect(bad.status).toBe(400);
    expect((await call<MemberDetail>('GET', `/members/${dad}`)).json.notes).toHaveLength(0);
    expect((await call('POST', `/agent/jobs/${claim.json.id}/complete`, { as: RUNNER, body: { reply: 'x', actions: [{ type: 'note', memberId: 999, body: 'x' }] } })).status).toBe(400);
  });

  it('讀藥袋：產出草稿，存成看診並標記', async () => {
    const { dad } = await seed();
    const photo = await upload();
    const scan = await call<{ job: { id: number; status: string } }>('POST', '/scan', { body: { memberId: dad, attachmentIds: [photo.json.id] } });
    expect(scan.json.job.status).toBe('queued');
    const claim = await call<{ id: number; kind: string }>('POST', '/agent/jobs/claim', { as: RUNNER, body: {} });
    expect(claim.json.kind).toBe('rx_scan');
    // runner 只能拿這件工作的附件
    const file = await app.request(`http://localhost/api/agent/jobs/${claim.json.id}/attachments/${photo.json.id}`, {}, env({ DEV_AUTH_EMAIL: RUNNER }));
    expect(file.status).toBe(200);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(JPEG);
    const other = await upload();
    expect((await call('GET', `/agent/jobs/${claim.json.id}/attachments/${other.json.id}`, { as: RUNNER })).status).toBe(403);

    const draft: VisitDraft = {
      visitDate: '2026-11-03',
      clinic: '聖青診所',
      department: '家醫科',
      doctor: '謝宜勳',
      reason: '黃鼻涕',
      diagnosis: '',
      advice: '',
      followUpDate: null,
      copay: 200,
      medications: MEDS.map((m) => ({ purpose: '', appearance: '', dose: '1 顆', asNeeded: false, cautions: '', mustFinish: false, ...m })) as VisitDraft['medications'],
      uncertain: ['醫師名字字跡不清'],
    };
    expect((await call('POST', `/agent/jobs/${claim.json.id}/complete`, { as: RUNNER, body: { draft } })).status).toBe(200);
    const res = await call<{ job: { status: string; result: VisitDraft } }>('GET', `/scan/${scan.json.job.id}`);
    expect(res.json.job.status).toBe('done');
    expect(res.json.job.result.medications).toHaveLength(3);
    // 別人看不到我的工作
    expect((await call('GET', `/scan/${scan.json.job.id}`, { as: MOM })).status).toBe(404);
  });

  it('處理到一半中斷：15 分鐘後算失敗，可以再試一次', async () => {
    const { dad } = await seed();
    const conv = await call<{ id: number }>('POST', '/chat/conversations', { body: { memberId: dad } });
    await call('POST', `/chat/conversations/${conv.json.id}/messages`, { body: { body: 'hi' } });
    const claim = await call<{ id: number }>('POST', '/agent/jobs/claim', { as: RUNNER, body: {} });
    vi.setSystemTime(new Date('2026-11-04T05:20:00Z'));
    await call('POST', '/agent/jobs/claim', { as: RUNNER, body: {} });
    let d = await call<ConversationDetail>('GET', `/chat/conversations/${conv.json.id}`);
    expect(d.json.pending?.status).toBe('failed');
    expect((await call('POST', `/chat/jobs/${claim.json.id}/retry`, { body: {} })).status).toBe(200);
    d = await call<ConversationDetail>('GET', `/chat/conversations/${conv.json.id}`);
    expect(d.json.pending?.status).toBe('queued');
  });

  it('對話是自己的；每天有上限', async () => {
    const { dad } = await seed();
    const conv = await call<{ id: number }>('POST', '/chat/conversations', { body: { memberId: dad } });
    expect((await call('GET', `/chat/conversations/${conv.json.id}`, { as: MOM })).status).toBe(404);
    const limited = { AI_DAILY_LIMIT: '1' };
    expect((await call('POST', `/chat/conversations/${conv.json.id}/messages`, { body: { body: '1' }, env: limited })).status).toBe(201);
    const c2 = await call<{ id: number }>('POST', '/chat/conversations', { body: {} });
    expect((await call('POST', `/chat/conversations/${c2.json.id}/messages`, { body: { body: '2' }, env: limited })).status).toBe(429);
  });
});

describe('年齡', () => {
  it('小朋友到月、大人到歲', () => {
    expect(ageText('2021-06-10', '2026-11-04')).toBe('5 歲 4 個月');
    expect(ageText('2026-05-20', '2026-11-04')).toBe('5 個月');
    expect(ageText('1985-03-27', '2026-11-04')).toBe('41 歲');
    expect(ageText(null, '2026-11-04')).toBe('');
  });
});
