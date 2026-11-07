// API 的資料形狀（前後端共用）。欄位對應集中在 src/worker/mappers.ts。
import type { Slot, Timing } from './meds';

export type Role = 'admin' | 'member';
export const ROLE_LABEL: Record<Role, string> = { admin: '管理者', member: '家人' };

/** AI 代理（家裡的 dr-claude-runner）的 email 前綴 */
export const AGENT_PREFIX = 'agent:';

// ---- API token（給 Claude Code 等程式用；migration 0002） ----

/** read 唯讀；log 再加記身體狀況、量測、打勾；write 再加家人、看診、用藥 */
export type TokenScope = 'read' | 'log' | 'write';
export const TOKEN_SCOPE_LABEL: Record<TokenScope, string> = { read: '唯讀', log: '記日常', write: '完整寫入' };
/** token 本身的開頭（Authorization: Bearer fdt_…） */
export const API_TOKEN_PREFIX = 'fdt_';
/** 最長一年 */
export const API_TOKEN_MAX_DAYS = 365;
/** 用 token 寫進去的紀錄，created_by 等欄位記成 token:<id>:<名稱> */
export const TOKEN_ACTOR_PREFIX = 'token:';

export const tokenActor = (id: number, name: string) => `${TOKEN_ACTOR_PREFIX}${id}:${name}`;

/** created_by 是 API token 的話回傳 token 名稱，否則 null */
export function tokenActorName(by: string | null | undefined): string | null {
  const m = /^token:\d+:(.*)$/s.exec(by ?? '');
  return m ? m[1] || 'API' : null;
}

export interface ApiToken {
  id: number;
  name: string;
  /** 前幾碼，認得是哪一把 */
  hint: string;
  scope: TokenScope;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** 建立時回傳一次的完整 token */
export interface CreatedApiToken extends ApiToken {
  token: string;
}

export interface Me {
  email: string;
  name: string;
  role: Role;
  picture: string;
  superAdmin: boolean;
  /** 這個帳號是哪位家人 */
  memberId: number | null;
}

export interface UserRow {
  email: string;
  name: string;
  role: Role;
  active: boolean;
  memberId: number | null;
  picture: string;
  lastSeenAt: string;
  superAdmin: boolean;
  /** 其他登入信箱（例：公司的 Google 帳號），登入後都算這個人 */
  emails: string[];
}

export interface Member {
  id: number;
  name: string;
  relation: string;
  birthDate: string | null;
  sex: '' | 'M' | 'F';
  bloodType: string;
  allergies: string;
  conditions: string;
  note: string;
  color: string;
  emoji: string;
  sortOrder: number;
  active: boolean;
}

export interface Medication {
  id: number;
  memberId: number;
  visitId: number | null;
  name: string;
  genericName: string;
  category: string;
  purpose: string;
  appearance: string;
  dose: string;
  slots: Slot[];
  timing: Timing;
  asNeeded: boolean;
  startDate: string;
  days: number | null;
  mustFinish: boolean;
  cautions: string;
  note: string;
  stoppedAt: string | null;
  stopReason: string;
  createdAt: string;
  createdBy: string;
  /** 對到食藥署哪一款（許可證字號，有照片）；null＝還沒對 */
  drugLicense: string | null;
}

/** 食藥署藥品外觀（/api/drugs） */
export interface DrugInfo {
  licenseNo: string;
  nameZh: string;
  nameEn: string;
  shape: string;
  color: string;
  scoreLine: string;
  sizeMm: string;
  marking: string;
  special: string;
  hasImage: boolean;
}

export interface DrugCandidate extends DrugInfo {
  score: number;
  /** 藥袋寫的顏色對不對得上 */
  colorAgreement: 'match' | 'mismatch' | null;
}

export interface Visit {
  id: number;
  memberId: number;
  visitDate: string;
  clinic: string;
  department: string;
  doctor: string;
  reason: string;
  diagnosis: string;
  advice: string;
  followUpDate: string | null;
  copay: number | null;
  note: string;
  createdAt: string;
  createdBy: string;
}

export interface VisitDetail extends Visit {
  medications: Medication[];
  attachments: Attachment[];
}

export type AttachmentKind = 'rx' | 'receipt' | 'photo' | 'report' | 'chat' | 'other';
export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = {
  rx: '藥袋',
  receipt: '收據',
  photo: '照片',
  report: '檢驗報告',
  chat: '對話附圖',
  other: '其他',
};
export const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface Attachment {
  id: number;
  memberId: number | null;
  visitId: number | null;
  kind: AttachmentKind;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
  createdBy: string;
}

export interface HealthNote {
  id: number;
  memberId: number;
  notedAt: string;
  body: string;
  severity: 0 | 1 | 2 | 3;
  source: 'manual' | 'dr_claude';
  createdBy: string;
}

export type MeasurementKind = 'temperature' | 'weight' | 'height' | 'heart_rate' | 'blood_pressure' | 'spo2';
export const MEASUREMENT_INFO: Record<MeasurementKind, { label: string; unit: string; min: number; max: number }> = {
  temperature: { label: '體溫', unit: '°C', min: 33, max: 43 },
  weight: { label: '體重', unit: 'kg', min: 0.5, max: 300 },
  height: { label: '身高', unit: 'cm', min: 30, max: 250 },
  heart_rate: { label: '心跳', unit: '下/分', min: 20, max: 250 },
  blood_pressure: { label: '血壓', unit: 'mmHg', min: 40, max: 260 },
  spo2: { label: '血氧', unit: '%', min: 50, max: 100 },
};

export interface Measurement {
  id: number;
  memberId: number;
  kind: MeasurementKind;
  value: number;
  value2: number | null;
  measuredAt: string;
  note: string;
  source: 'manual' | 'dr_claude';
  createdBy: string;
}

export interface DoseLog {
  id: number;
  medicationId: number;
  doseDate: string;
  slot: string;
  status: 'taken' | 'skipped';
  /** 實際吃藥時間 'YYYY-MM-DD HH:MM'（使用者填的，預設按下去的時間）；跳過的是 null */
  takenAt: string | null;
  /** 按下去（最後一次改）的時間 */
  loggedAt: string;
  loggedBy: string;
}

/** 今天頁：今天要吃的藥、進行中的療程、近期回診 */
export interface TodayResponse {
  date: string;
  members: Member[];
  medications: Medication[];
  /** 這些藥是哪幾次看診開的（每一包標哪家診所、哪位醫生） */
  visits: Visit[];
  doseLogs: DoseLog[];
  followUps: { visitId: number; memberId: number; date: string; clinic: string }[];
  runner: RunnerState;
}

export interface MemberDetail {
  member: Member;
  medications: Medication[];
  doseLogs: DoseLog[];
  visits: Visit[];
  notes: HealthNote[];
  measurements: Measurement[];
}

export type TimelineItem =
  | { type: 'visit'; at: string; memberId: number; visit: Visit; medCount: number }
  | { type: 'note'; at: string; memberId: number; note: HealthNote }
  | { type: 'measurement'; at: string; memberId: number; measurement: Measurement };

// ---- Dr.水獺 ----

export type Mood = 'calm' | 'happy' | 'concerned' | 'urgent';

/** Dr.水獺 這次幫忙做的事（顯示在訊息下方） */
export type ChatAction =
  | { type: 'note'; id: number; memberId: number; summary: string }
  | { type: 'measurement'; id: number; memberId: number; summary: string }
  | { type: 'visit_draft'; memberId: number; draft: VisitDraft; savedVisitId?: number };

/** 看診＋用藥草稿（讀藥袋、或對話中整理出來的；使用者確認後才存） */
export interface VisitDraft {
  visitDate: string;
  clinic: string;
  department: string;
  doctor: string;
  reason: string;
  diagnosis: string;
  advice: string;
  followUpDate: string | null;
  copay: number | null;
  medications: MedicationDraft[];
  /** AI 看不清楚、要人確認的地方 */
  uncertain: string[];
}

export interface MedicationDraft {
  name: string;
  genericName: string;
  category: string;
  purpose: string;
  appearance: string;
  dose: string;
  slots: Slot[];
  timing: Timing;
  asNeeded: boolean;
  days: number | null;
  mustFinish: boolean;
  cautions: string;
  /** 挑好的食藥署許可證字號（有照片）；沒挑是 null 或不給 */
  drugLicense?: string | null;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  body: string;
  attachmentIds: number[];
  actions: ChatAction[];
  mood: Mood | '';
  createdAt: string;
}

export interface Conversation {
  id: number;
  memberId: number | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessage: string;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface AiJob {
  id: number;
  kind: 'chat' | 'rx_scan';
  status: JobStatus;
  stage: string;
  error: string;
  result: VisitDraft | null;
  createdAt: string;
}

/** 家裡的 runner 有沒有在跑：最後一次來領工作的時間 */
export interface RunnerState {
  lastPollAt: string | null;
  online: boolean;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: ChatMessage[];
  /** 還在排隊或處理中的那件 */
  pending: AiJob | null;
  runner: RunnerState;
}

// ---- 給 runner 的工作內容 ----

export interface AgentJobContext {
  job: { id: number; kind: 'chat' | 'rx_scan'; memberId: number | null; createdBy: string; attachmentIds: number[] };
  today: string;
  now: string;
  /** 問的人（帳號）與他是哪位家人 */
  asker: { email: string; name: string; memberId: number | null };
  members: (Member & { ageText: string; latestWeightKg: number | null })[];
  conversation: { id: number; memberId: number | null; messages: { role: 'user' | 'assistant'; body: string; createdAt: string; attachmentIds: number[] }[] } | null;
  activeMedications: (Medication & { schedule: string; progress: string })[];
  recentVisits: Visit[];
  recentNotes: HealthNote[];
  recentMeasurements: Measurement[];
  attachments: Attachment[];
}

// ---- 手機通知 ----

export interface PushDevice {
  id: number;
  device: string;
  endpoint: string;
  createdAt: string;
  lastSuccessAt: string | null;
  lastError: string;
}

export interface PushSettings {
  publicKey: string;
  canSend: boolean;
  devices: PushDevice[];
}
