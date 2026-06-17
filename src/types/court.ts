export interface VerdictReasoningItem {
  step?: number;
  label: string;
  text: string;
}

export interface VerdictIndexes {
  hardMouth: number;
  grievance: number;
  coaxDifficulty: number;
  oldScoreRisk: number;
}

export interface VerdictRatio {
  plaintiff: number;
  defendant: number;
}

export interface Verdict {
  ratio: VerdictRatio;
  facts: string;
  focus: string[];
  reason: string;
  penalty: string;
  indices: VerdictIndexes;
  settlement: string;
  provider: string;
  model?: string;
  reasoning?: VerdictReasoningItem[];
}

export interface CourtCase {
  id: string;
  caseNumber: string;
  inviteCode: string;
  title: string;
  plaintiffName: string;
  defendantName: string;
  plaintiffStatement: string;
  defendantStatement: string;
  plaintiffAnswer: string;
  defendantAnswer: string;
  question: string;
  verdict: Verdict | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  archivedByUserId?: string | null;
  deletedAt?: string | null;
  deletedByUserId?: string | null;
}

export interface User {
  id: string;
  displayName: string;
  source: string;
  sourceKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaseParticipant {
  id: string;
  caseId: string;
  userId: string;
  role: UserRole;
  joinedAt: string;
  lastSeenAt: string;
}

export interface CaseStatement {
  id: string;
  caseId: string;
  userId: string;
  role: UserRole;
  title: string;
  plaintiffName: string;
  defendantName: string;
  plaintiffStatement: string;
  defendantStatement: string;
  plaintiffAnswer: string;
  defendantAnswer: string;
  updatedAt: string;
  createdAt: string;
  version: number;
}

export interface CaseAccessToken {
  id: string;
  caseId: string;
  token: string;
  purpose: 'invite';
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
  usedAt?: string | null;
  revokedAt?: string | null;
}

export interface VerdictRecord {
  id: string;
  caseId: string;
  createdByUserId: string;
  provider: string;
  model?: string;
  payload: Verdict;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = 'plaintiff' | 'defendant';

export interface CasePatch {
  title?: string;
  plaintiffName?: string;
  defendantName?: string;
  plaintiffStatement?: string;
  defendantStatement?: string;
  plaintiffAnswer?: string;
  defendantAnswer?: string;
}

export interface JoinCaseInput {
  caseId?: string;
  inviteCode?: string;
  role?: UserRole;
}

export interface CaseStatementPatch extends CasePatch {
  role?: UserRole;
}