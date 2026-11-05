import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentJobContext,
  ApiToken,
  DrugCandidate,
  CreatedApiToken,
  ConversationDetail,
  Me,
  MemberDetail,
  TimelineItem,
  TodayResponse,
  VisitDetail,
  VisitDraft,
} from '../src/shared/apiTypes';
import { agentMayCall, tokenMayCall } from '../src/worker/auth';
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

describe('API token', () => {
  /** 用 token 呼叫：不帶 DEV_AUTH_EMAIL 的人，只靠 Authorization */
  const withToken = <T = unknown>(token: string, method: string, path: string, body?: unknown) =>
    call<T>(method, path, { body, headers: { Authorization: `Bearer ${token}` }, env: { DEV_AUTH_EMAIL: '' } });
  const make = async (scope: 'read' | 'log' | 'write', days = 30, as = ADMIN) =>
    call<CreatedApiToken>('POST', '/tokens', { as, body: { name: 'Claude Code', scope, days } });

  it('只有最高管理者能建；最長一年；token 只顯示一次、資料庫只存雜湊', async () => {
    await seed();
    expect((await make('read', 30, MOM)).status).toBe(403);
    expect((await make('read', 366)).status).toBe(400);
    const t = await make('read', 365);
    expect(t.status).toBe(201);
    expect(t.json.token).toMatch(/^fdt_[A-Za-z0-9_-]{40,}$/);
    expect(t.json.expiresAt.slice(0, 10)).toBe('2027-11-04');
    const list = await call<ApiToken[]>('GET', '/tokens');
    expect(list.json).toHaveLength(1);
    expect(JSON.stringify(list.json)).not.toContain(t.json.token);
    const stored = shim.asD1().prepare('SELECT token_hash FROM api_tokens').bind();
    expect(JSON.stringify(await stored.all())).not.toContain(t.json.token);
  });

  it('唯讀：能看、不能寫；都不能管帳號、建 token、走 /api/agent', async () => {
    const { dad } = await seed();
    const t = (await make('read')).json.token;
    expect((await withToken(t, 'GET', '/today')).status).toBe(200);
    expect((await withToken<MemberDetail>(t, 'GET', `/members/${dad}`)).json.member.name).toBe('Nathan');
    expect((await withToken(t, 'POST', '/notes', { memberId: dad, notedAt: '2026-11-04 12:00', body: '咳嗽' })).status).toBe(403);
    expect((await withToken(t, 'GET', '/users')).status).toBe(403);
    expect((await withToken(t, 'GET', '/tokens')).status).toBe(403);
    expect((await withToken(t, 'POST', '/tokens', { name: 'x', scope: 'write', days: 1 })).status).toBe(403);
    expect((await withToken(t, 'POST', '/agent/jobs/claim', {})).status).toBe(403);
    expect((await withToken(t, 'GET', '/chat/conversations')).status).toBe(403);
  });

  it('記日常：能記身體狀況、量測、打勾；不能改家人、看診、用藥', async () => {
    const { dad } = await seed();
    const t = (await make('log')).json.token;
    expect((await withToken(t, 'POST', '/notes', { memberId: dad, notedAt: '2026-11-04 12:00', body: '咳嗽' })).status).toBe(201);
    expect((await withToken(t, 'POST', '/measurements', { memberId: dad, kind: 'temperature', value: 37.8, measuredAt: '2026-11-04 12:00' })).status).toBe(201);
    expect((await withToken(t, 'POST', '/members', { name: '阿嬤' })).status).toBe(403);
    expect((await withToken(t, 'POST', '/medications', { memberId: dad, startDate: '2026-11-04', name: '退燒藥', asNeeded: true })).status).toBe(403);
  });

  it('完整寫入：看診與用藥直接生效，紀錄標記是哪把 token 建的', async () => {
    const { dad } = await seed();
    const t = await make('write');
    const v = await withToken<{ id: number }>(t.json.token, 'POST', '/visits', { memberId: dad, visitDate: '2026-11-04', clinic: '測試診所', medications: MEDS });
    expect(v.status).toBe(201);
    const visit = await call<VisitDetail>('GET', `/visits/${v.json.id}`);
    expect(visit.json.createdBy).toBe(`token:${t.json.id}:Claude Code`);
    expect(visit.json.medications.every((m) => m.createdBy === `token:${t.json.id}:Claude Code`)).toBe(true);
    expect((await call<TodayResponse>('GET', '/today')).json.medications).toHaveLength(3);
    expect((await withToken(t.json.token, 'POST', `/members/${dad}/active`, { active: false })).status).toBe(403);
    const list = await call<ApiToken[]>('GET', '/tokens');
    expect(list.json[0].lastUsedAt).not.toBeNull();
  });

  it('撤銷、過期、帳號停用、亂打的 token 一律 401', async () => {
    await seed();
    const a = await make('read', 1);
    await call('POST', `/tokens/${a.json.id}/revoke`, { body: {} });
    expect((await withToken(a.json.token, 'GET', '/today')).status).toBe(401);
    const b = await make('read', 1);
    vi.setSystemTime(new Date('2026-11-05T05:00:01Z'));
    expect((await withToken(b.json.token, 'GET', '/today')).status).toBe(401);
    expect((await withToken('fdt_not-a-real-token', 'GET', '/today')).status).toBe(401);
    expect((await call('GET', '/today', { headers: { Authorization: 'Basic abc' }, env: { DEV_AUTH_EMAIL: '' } })).status).toBe(401);
    // 不再是最高管理者，token 也跟著失效
    const c = await make('read', 30);
    expect((await withToken(c.json.token, 'GET', '/today', undefined)).status).toBe(200);
    const res = await app.request(
      'http://localhost/api/today',
      { headers: { Authorization: `Bearer ${c.json.token}` } },
      env({ SUPER_ADMINS: 'someone-else@test.com', DEV_AUTH_EMAIL: '' }),
    );
    expect(res.status).toBe(401);
  });

  it('正式網域沒設 Access 也一律拒絕（fail closed）', async () => {
    await seed();
    const t = (await make('read')).json.token;
    const res = await app.request('https://doctor.example.com/api/today', { headers: { Authorization: `Bearer ${t}` } }, env());
    expect(res.status).toBe(500);
  });

  it('權限表：一層包一層', () => {
    expect(tokenMayCall('read', 'GET', 'http://x/api/members/3')).toBe(true);
    expect(tokenMayCall('read', 'POST', 'http://x/api/doses')).toBe(false);
    expect(tokenMayCall('log', 'POST', 'http://x/api/doses')).toBe(true);
    expect(tokenMayCall('log', 'PUT', 'http://x/api/medications/3')).toBe(false);
    expect(tokenMayCall('write', 'PUT', 'http://x/api/medications/3')).toBe(true);
    expect(tokenMayCall('write', 'PATCH', 'http://x/api/users/me')).toBe(false);
  });
});

describe('藥品照片', () => {
  const CEPH_GW = '衛署藥製字第015660號';
  const CEPH_GY = '衛署藥製字第022105號';
  const CEPH_TAB = '衛署藥製字第037523號';
  const img = (id: string) => `https://mcp.fda.gov.tw/insert/shapeImg/${id}?c=o`;
  const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');

  async function catalog() {
    const rows = [
      [CEPH_GW, '"信東"賜福力欣膠囊 500毫克', 'Cephalexin Capsules 500mg "TBC"', '膠囊', '綠、白', img('a')],
      [CEPH_GY, '"優良"優力黴素膠囊５００毫克（賜福力欣）', 'ULEXIN CAPSULES 500MG (CEPHALEXIN)', '膠囊', '綠、黃', img('b')],
      [CEPH_TAB, '賜福力欣膜衣錠５００毫克', 'CEPHALEXIN F.C.TABLET 500MG "TBC"', '橢圓形', '橘', img('c')],
      ['衛署藥製字第000001號', '"福元"蘇打錠500毫克', 'SODIUM BICARBONATE TABLETS "F.Y."', '圓形', '白', ''],
    ];
    const { normalizeDrugText } = await import('../src/shared/drugs');
    for (const [license, zh, en, shape, color, url] of rows) {
      await shim
        .asD1()
        .prepare(`INSERT INTO drug_catalog (license_no, name_zh, name_en, shape, color, image_url, search_text, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-11-04 00:00:00')`)
        .bind(license, zh, en, shape, color, url, normalizeDrugText(`${en} ${zh}`))
        .run();
    }
  }

  it('從藥袋的藥名＋外觀找候選：顏色、劑型對得上的排前面', async () => {
    await seed();
    await catalog();
    const r = await call<DrugCandidate[]>('GET', `/drugs/match?name=${encodeURIComponent('CEPHALEXIN 500MG')}&appearance=${encodeURIComponent('綠白膠囊')}`);
    expect(r.json.map((x) => x.licenseNo)).toEqual([CEPH_GW, CEPH_GY, CEPH_TAB]);
    expect(r.json[0].colorAgreement).toBe('match');
    expect(r.json[2].colorAgreement).toBe('mismatch');
    const q = await call<DrugCandidate[]>('GET', `/drugs?q=${encodeURIComponent('賜福力欣')}`);
    expect(q.json).toHaveLength(3);
    expect((await call('GET', `/drugs/${encodeURIComponent(CEPH_GW)}`)).status).toBe(200);
  });

  it('用藥對到哪一款：存看診時一起存、之後可以換或拿掉；亂填的字號擋下來', async () => {
    const { dad } = await seed();
    await catalog();
    const bad = await call('POST', '/visits', { body: { memberId: dad, visitDate: '2026-11-04', medications: [{ ...MEDS[0], drugLicense: '衛署藥製字第999999號' }] } });
    expect(bad.status).toBe(400);
    const v = await call<{ id: number }>('POST', '/visits', { body: { memberId: dad, visitDate: '2026-11-04', medications: [{ ...MEDS[0], drugLicense: CEPH_GY }] } });
    const med = (await call<VisitDetail>('GET', `/visits/${v.json.id}`)).json.medications[0];
    expect(med.drugLicense).toBe(CEPH_GY);
    await call('POST', `/medications/${med.id}/drug`, { body: { license: CEPH_GW } });
    expect((await call<VisitDetail>('GET', `/visits/${v.json.id}`)).json.medications[0].drugLicense).toBe(CEPH_GW);
    await call('POST', `/medications/${med.id}/drug`, { body: { license: null } });
    expect((await call<VisitDetail>('GET', `/visits/${v.json.id}`)).json.medications[0].drugLicense).toBeNull();
  });

  it('照片：第一次要排隊給 runner 做，交回來之後就從 R2 拿；只有 runner 能交', async () => {
    await seed();
    await catalog();
    const path = `/drugs/${encodeURIComponent(CEPH_GW)}/photo`;
    expect((await call<{ status: string }>('GET', `${path}/status`)).json.status).toBe('queued');
    const first = await call<{ status: string }>('GET', path);
    expect(first.status).toBe(404);
    expect(first.json.status).toBe('queued');
    // 有照片在排隊：runner 的長輪詢馬上回來
    const res = await app.request('http://localhost/api/agent/jobs/claim?wait=25', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, env({ DEV_AUTH_EMAIL: RUNNER }));
    expect(res.status).toBe(204);
    expect(res.headers.get('X-Drug-Photos')).toBe('queued');
    expect((await call('POST', '/agent/drug-photos/claim', { body: {} })).status).toBe(403);
    const claim = await call<{ items: { license: string; imageUrl: string }[] }>('POST', '/agent/drug-photos/claim', { as: RUNNER, body: {} });
    expect(claim.json.items).toEqual([{ license: CEPH_GW, imageUrl: img('a') }]);
    const up = await call('POST', `/agent/drug-photos/${encodeURIComponent(CEPH_GW)}`, { as: RUNNER, body: { sourceUrl: img('a'), cropped: true, crop: JPEG_B64, full: JPEG_B64 } });
    expect(up.status).toBe(200);
    expect((await call<{ status: string }>('GET', `${path}/status`)).json.status).toBe('done');
    const photo = await app.request(`http://localhost/api${path}`, {}, env({ DEV_AUTH_EMAIL: ADMIN }));
    expect(photo.status).toBe(200);
    expect(photo.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await photo.arrayBuffer())[0]).toBe(0xff);
    // 沒有照片的藥
    expect((await call<{ status: string }>('GET', `/drugs/${encodeURIComponent('衛署藥製字第000001號')}/photo`)).json.status).toBe('none');
  });

  it('照片做不出來：失敗三次就不再自動重試', async () => {
    await seed();
    await catalog();
    const path = `/drugs/${encodeURIComponent(CEPH_GY)}/photo`;
    for (let i = 0; i < 3; i++) {
      expect((await call<{ status: string }>('GET', path)).json.status).toBe('queued');
      const c = await call<{ items: unknown[] }>('POST', '/agent/drug-photos/claim', { as: RUNNER, body: {} });
      expect(c.json.items).toHaveLength(1);
      await call('POST', `/agent/drug-photos/${encodeURIComponent(CEPH_GY)}/fail`, { as: RUNNER, body: { error: '逾時' } });
    }
    expect((await call<{ status: string }>('GET', path)).json.status).toBe('failed');
  });

  it('API token：唯讀能找藥、看照片；完整寫入能幫用藥對照片', async () => {
    const { dad } = await seed();
    await catalog();
    const read = (await call<CreatedApiToken>('POST', '/tokens', { body: { name: 'r', scope: 'read', days: 1 } })).json.token;
    const write = (await call<CreatedApiToken>('POST', '/tokens', { body: { name: 'w', scope: 'write', days: 1 } })).json.token;
    const auth = (t: string) => ({ headers: { Authorization: `Bearer ${t}` }, env: { DEV_AUTH_EMAIL: '' } });
    expect((await call('GET', `/drugs/match?name=CEPHALEXIN`, auth(read))).status).toBe(200);
    expect((await call('GET', `/drugs/${encodeURIComponent(CEPH_GW)}/photo`, auth(read))).status).toBe(404);
    const med = await call<{ id: number }>('POST', '/medications', { body: { memberId: dad, startDate: '2026-11-04', ...MEDS[0] } });
    expect((await call('POST', `/medications/${med.json.id}/drug`, { body: { license: CEPH_GW }, ...auth(read) })).status).toBe(403);
    expect((await call('POST', `/medications/${med.json.id}/drug`, { body: { license: CEPH_GW }, ...auth(write) })).status).toBe(200);
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
