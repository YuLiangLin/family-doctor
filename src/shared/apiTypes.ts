// API 的資料形狀（前後端共用）。欄位對應集中在 src/worker/mappers.ts。
import type { Slot, Timing } from './meds';

export type Role = 'admin' | 'member';
export const ROLE_LABEL: Record<Role, string> = { admin: '管理者', member: '家人' };

/** AI 代理（家裡的 dr-claude-runner）的 email 前綴 */
export const AGENT_PREFIX = 'agent:';

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
  loggedAt: string;
  loggedBy: string;
}

/** 今天頁：今天要吃的藥、進行中的療程、近期回診 */
export interface TodayResponse {
  date: string;
  members: Member[];
  medications: Medication[];
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

// ---- Dr.Claude ----

export type Mood = 'calm' | 'happy' | 'concerned' | 'urgent';

/** Dr.Claude 這次幫忙做的事（顯示在訊息下方） */
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
