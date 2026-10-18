import type {
  AlertAck,
  Attachment,
  AuditEvent,
  Case,
  CaseAnalysis,
  CaseIdentifiers,
  CausalityAssessment,
  ExtractionRun,
  FormDraft,
  RegisterItem,
  Rotation,
  TaskRecord,
  TimelineEntry,
  TraineeSettings,
  Versioned,
} from '../domain/types';
import type { CalcResult } from '../calc/types';
import type { ReferenceKind } from '../domain/reference';
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

/** What the model read from each document of the case (latest version of every reading). */
export const useExtractions = (caseId: string) =>
  useLiveDecoded(
    (s) => s.rawExtractions(caseId),
    (s, rows): Promise<ExtractionRun[]> => s.decodeExtractions(rows),
    [caseId],
  );

/** M2: the trainee's reference tables (latest version of every record). */
export const useReference = <T extends Versioned>(kind: ReferenceKind) =>
  useLiveDecoded(
    (s) => s.rawReference(kind),
    (s, rows): Promise<T[]> => s.decodeReference<T>(kind, rows),
    [kind],
  );

export const useAlertAcks = (caseId: string) =>
  useLiveDecoded(
    (s) => s.rawAlertAcks(caseId),
    (s, rows): Promise<AlertAck[]> => s.decodeAlertAcks(rows),
    [caseId],
  );

export const useCausality = (caseId: string) =>
  useLiveDecoded(
    (s) => s.rawCausality(caseId),
    (s, rows): Promise<CausalityAssessment[]> => s.decodeCausality(rows),
    [caseId],
  );

/** M2: every calculation result of the case, oldest first (append-only). */
export const useCalcResults = (caseId: string) =>
  useLiveDecoded(
    (s) => s.rawCalcResults(caseId),
    (s, rows): Promise<CalcResult[]> => s.decodeCalcResults(rows),
    [caseId],
  );

/** The model's drafts for the case, latest version of every analysis (one per module run). */
export const useAnalyses = (caseId: string) =>
  useLiveDecoded(
    (s) => s.rawAnalyses(caseId),
    (s, rows): Promise<CaseAnalysis[]> => s.decodeAnalyses(rows),
    [caseId],
  );
