import type {
  Attachment,
  AuditEvent,
  Case,
  CaseIdentifiers,
  FormDraft,
  RegisterItem,
  Rotation,
  TaskRecord,
  TimelineEntry,
  TraineeSettings,
} from '../domain/types';
import { useLiveDecoded } from './hooks';

export const useRotations = () =>
  useLiveDecoded(
    (s) => s.db.rotations.toArray(),
    (s, rows) => s.decodeLatestOfAll<Rotation>('rotations', rows),
    [],
  );

export const useRotationVersions = (id: string) =>
  useLiveDecoded(
    (s) => s.db.rotations.where('entityId').equals(id).toArray(),
    (s, rows) => s.decodeVersions<Rotation>('rotations', rows),
    [id],
  );

export const useCases = () =>
  useLiveDecoded(
    (s) => s.db.cases.toArray(),
    (s, rows) => s.decodeLatestOfAll<Case>('cases', rows),
    [],
  );

export const useCaseVersions = (caseId: string) =>
  useLiveDecoded(
    (s) => s.db.cases.where('entityId').equals(caseId).toArray(),
    (s, rows) => s.decodeVersions<Case>('cases', rows),
    [caseId],
  );

export const useIdentifiers = (caseId: string) =>
  useLiveDecoded(
    (s) => s.db.identifiers.where('entityId').equals(caseId).toArray(),
    async (s, rows) => (await s.decodeVersions<CaseIdentifiers>('identifiers', rows)).at(-1),
    [caseId],
  );

export const useEntries = (caseId: string) =>
  useLiveDecoded(
    (s) => s.rawEntries(caseId),
    (s, rows): Promise<TimelineEntry[]> => s.decodeEntries(rows),
    [caseId],
  );

export const useFormDraft = (caseId: string) =>
  useLiveDecoded(
    (s) => s.db.formDrafts.where('entityId').equals(caseId).toArray(),
    async (s, rows) => (await s.decodeVersions<FormDraft>('formDrafts', rows)).at(-1),
    [caseId],
  );

export const useAudit = (caseId?: string) =>
  useLiveDecoded(
    (s) => s.rawAudit(caseId),
    (s, rows): Promise<AuditEvent[]> => s.decodeAudit(rows),
    [caseId],
  );

export const useTrainee = () =>
  useLiveDecoded(
    (s) => s.db.settings.get('trainee'),
    async (s, row): Promise<TraineeSettings> => (row ? s.openRow<TraineeSettings>('settings', row) : {}),
    [],
  );

export const useAttachments = (caseId: string) =>
  useLiveDecoded(
    (s) => s.rawAttachments(caseId),
    (s, rows): Promise<Attachment[]> => s.decodeAttachments(rows),
    [caseId],
  );

export const useTasks = (caseId: string) =>
  useLiveDecoded(
    (s) => s.rawTasks(caseId),
    (s, rows): Promise<TaskRecord[]> => s.decodeLatestOfAll<TaskRecord>('tasks', rows),
    [caseId],
  );

export const useTaskHistory = (caseId: string, taskId: string) =>
  useLiveDecoded(
    (s) => s.db.tasks.where('entityId').equals(`${caseId}:${taskId}`).toArray(),
    (s, rows) => s.decodeVersions<TaskRecord>('tasks', rows),
    [caseId, taskId],
  );

export const useItems = (caseId: string) =>
  useLiveDecoded(
    (s) => s.rawItems(caseId),
    (s, rows): Promise<RegisterItem[]> => s.decodeItems(rows),
    [caseId],
  );

export const useItemHistory = (itemId: string) =>
  useLiveDecoded(
    (s) => s.db.items.where('entityId').equals(itemId).toArray(),
    (s, rows) => s.decodeVersions<RegisterItem>('items', rows),
    [itemId],
  );

/** Task progress of every case, for lists (Home, Cases, Workflow). */
export const useAllTasks = () =>
  useLiveDecoded(
    (s) => s.db.tasks.toArray(),
    (s, rows): Promise<TaskRecord[]> => s.decodeLatestOfAll<TaskRecord>('tasks', rows),
    [],
  );

export const useAllItems = () =>
  useLiveDecoded(
    (s) => s.db.items.toArray(),
    (s, rows): Promise<RegisterItem[]> => s.decodeItems(rows),
    [],
  );
