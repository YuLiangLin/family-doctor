// DB row → API 物件（欄位對應集中在這裡；加欄位時這裡、apiTypes.ts、migration 一起改）
import type {
  ApiToken,
  Attachment,
  AttachmentKind,
  ChatAction,
  ChatMessage,
  DoseLog,
  HealthNote,
  Measurement,
  MeasurementKind,
  Medication,
  Member,
  Mood,
  TokenScope,
  Visit,
} from '../shared/apiTypes';
import { parseSlots, type Timing } from '../shared/meds';

export interface MemberRow {
  id: number;
  name: string;
  relation: string;
  birth_date: string | null;
  sex: '' | 'M' | 'F';
  blood_type: string;
  allergies: string;
  conditions: string;
  note: string;
  color: string;
  emoji: string;
  sort_order: number;
  active: number;
}

export const toMember = (r: MemberRow): Member => ({
  id: r.id,
  name: r.name,
  relation: r.relation,
  birthDate: r.birth_date,
  sex: r.sex,
  bloodType: r.blood_type,
  allergies: r.allergies,
  conditions: r.conditions,
  note: r.note,
  color: r.color,
  emoji: r.emoji,
  sortOrder: r.sort_order,
  active: !!r.active,
});

export interface VisitRow {
  id: number;
  member_id: number;
  visit_date: string;
  clinic: string;
  department: string;
  doctor: string;
  reason: string;
  diagnosis: string;
  advice: string;
  follow_up_date: string | null;
  copay: number | null;
  note: string;
  created_at: string;
  created_by: string;
}

export const toVisit = (r: VisitRow): Visit => ({
  id: r.id,
  memberId: r.member_id,
  visitDate: r.visit_date,
  clinic: r.clinic,
  department: r.department,
  doctor: r.doctor,
  reason: r.reason,
  diagnosis: r.diagnosis,
  advice: r.advice,
  followUpDate: r.follow_up_date,
  copay: r.copay,
  note: r.note,
  createdAt: r.created_at,
  createdBy: r.created_by,
});

export interface MedicationRow {
  id: number;
  member_id: number;
  visit_id: number | null;
  name: string;
  generic_name: string;
  category: string;
  purpose: string;
  appearance: string;
  dose: string;
  slots: string;
  timing: Timing;
  as_needed: number;
  start_date: string;
  days: number | null;
  must_finish: number;
  cautions: string;
  note: string;
  stopped_at: string | null;
  stop_reason: string;
  created_at: string;
  created_by: string;
}

export const toMedication = (r: MedicationRow): Medication => ({
  id: r.id,
  memberId: r.member_id,
  visitId: r.visit_id,
  name: r.name,
  genericName: r.generic_name,
  category: r.category,
  purpose: r.purpose,
  appearance: r.appearance,
  dose: r.dose,
  slots: parseSlots(r.slots),
  timing: r.timing,
  asNeeded: !!r.as_needed,
  startDate: r.start_date,
  days: r.days,
  mustFinish: !!r.must_finish,
  cautions: r.cautions,
  note: r.note,
  stoppedAt: r.stopped_at,
  stopReason: r.stop_reason,
  createdAt: r.created_at,
  createdBy: r.created_by,
});

export interface DoseLogRow {
  id: number;
  medication_id: number;
  dose_date: string;
  slot: string;
  status: 'taken' | 'skipped';
  logged_at: string;
  logged_by: string;
}

export const toDoseLog = (r: DoseLogRow): DoseLog => ({
  id: r.id,
  medicationId: r.medication_id,
  doseDate: r.dose_date,
  slot: r.slot,
  status: r.status,
  loggedAt: r.logged_at,
  loggedBy: r.logged_by,
});

export interface HealthNoteRow {
  id: number;
  member_id: number;
  noted_at: string;
  body: string;
  severity: 0 | 1 | 2 | 3;
  source: 'manual' | 'dr_claude';
  created_by: string;
}

export const toHealthNote = (r: HealthNoteRow): HealthNote => ({
  id: r.id,
  memberId: r.member_id,
  notedAt: r.noted_at,
  body: r.body,
  severity: r.severity,
  source: r.source,
  createdBy: r.created_by,
});

export interface MeasurementRow {
  id: number;
  member_id: number;
  kind: MeasurementKind;
  value: number;
  value2: number | null;
  measured_at: string;
  note: string;
  source: 'manual' | 'dr_claude';
  created_by: string;
}

export const toMeasurement = (r: MeasurementRow): Measurement => ({
  id: r.id,
  memberId: r.member_id,
  kind: r.kind,
  value: r.value,
  value2: r.value2,
  measuredAt: r.measured_at,
  note: r.note,
  source: r.source,
  createdBy: r.created_by,
});

export interface AttachmentRow {
  id: number;
  member_id: number | null;
  visit_id: number | null;
  kind: AttachmentKind;
  r2_key: string;
  filename: string;
  content_type: string;
  size: number;
  created_at: string;
  created_by: string;
}

export const toAttachment = (r: AttachmentRow): Attachment => ({
  id: r.id,
  memberId: r.member_id,
  visitId: r.visit_id,
  kind: r.kind,
  filename: r.filename,
  contentType: r.content_type,
  size: r.size,
  createdAt: r.created_at,
  createdBy: r.created_by,
});

export interface ChatMessageRow {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant';
  body: string;
  attachment_ids: string;
  actions: string;
  mood: Mood | '';
  created_at: string;
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const toChatMessage = (r: ChatMessageRow): ChatMessage => ({
  id: r.id,
  role: r.role,
  body: r.body,
  attachmentIds: parseJson<number[]>(r.attachment_ids, []),
  actions: parseJson<ChatAction[]>(r.actions, []),
  mood: r.mood,
  createdAt: r.created_at,
});

export interface ApiTokenRow {
  id: number;
  name: string;
  hint: string;
  scope: TokenScope;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export const toApiToken = (r: ApiTokenRow): ApiToken => ({
  id: r.id,
  name: r.name,
  hint: r.hint,
  scope: r.scope,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
});
