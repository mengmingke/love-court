import Taro from '@tarojs/taro';

const OWNED_CASES_KEY = 'love-court-owned-cases';
const CURRENT_CASE_KEY = 'love-court-current-case';

// 表单校验常量
export const STATEMENT_MIN_LENGTH = 8;
export const TITLE_MAX_LENGTH = 220;
export const NAME_MAX_LENGTH = 220;
export const STATEMENT_MAX_LENGTH = 500;
export const ANSWER_MAX_LENGTH = 220;

export interface ValidationIssue {
  field: 'title' | 'plaintiffName' | 'defendantName' | 'plaintiffStatement' | 'defendantStatement';
  message: string;
}

export function getOwnedCases(): string[] {
  try {
    return Taro.getStorageSync<string[]>(OWNED_CASES_KEY) || [];
  } catch (error) {
    console.error('[Storage] getOwnedCases failed', error);
    return [];
  }
}

export function rememberOwnedCase(caseId: string) {
  const ownedCases = new Set(getOwnedCases());
  ownedCases.add(caseId);
  Taro.setStorageSync(OWNED_CASES_KEY, Array.from(ownedCases));
}

export function setCurrentCaseId(caseId: string) {
  Taro.setStorageSync(CURRENT_CASE_KEY, caseId);
}

export function getCurrentCaseId() {
  return Taro.getStorageSync<string>(CURRENT_CASE_KEY) || '';
}

export function getProviderLabel(provider?: string, model?: string) {
  if (provider === 'deepseek') {
    return `本裁决由${model || 'deepseek'} AI模型生成`;
  }
  return '本裁决根据本地规则生成';
}

export function trimInput(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}

// 校验案件信息字段，返回首个不通过的问题；通过返回 null
export function validateCaseInfo(input: {
  title?: string;
  plaintiffName?: string;
  defendantName?: string;
}): ValidationIssue | null {
  if (!input.title || !input.title.trim()) {
    return { field: 'title', message: '请填写案由' };
  }
  if (!input.plaintiffName || !input.plaintiffName.trim()) {
    return { field: 'plaintiffName', message: '请填写原告昵称' };
  }
  if (!input.defendantName || !input.defendantName.trim()) {
    return { field: 'defendantName', message: '请填写被告昵称' };
  }
  return null;
}

// 校验陈词字段，至少 STATEMENT_MIN_LENGTH 个字
export function validateStatement(field: ValidationIssue['field'], value: string | undefined): ValidationIssue | null {
  const text = (value || '').trim();
  if (!text) {
    return { field, message: '请填写陈词内容' };
  }
  if (text.length < STATEMENT_MIN_LENGTH) {
    return { field, message: `陈词至少 ${STATEMENT_MIN_LENGTH} 个字` };
  }
  return null;
}

// 弱网/断网状态订阅：返回取消订阅函数
export function subscribeNetworkStatus(callback: (isWeak: boolean) => void): () => void {
  let cancelled = false;
  const handler = (res: Taro.onNetworkStatusChange.CallbackResult) => {
    if (cancelled) return;
    const weakTypes: Array<typeof res.networkType> = ['2g', '3g', 'unknown', 'none'];
    callback(weakTypes.includes(res.networkType) || !res.isConnected);
  };
  Taro.onNetworkStatusChange(handler);
  // 初始触发一次当前网络状态
  Taro.getNetworkType()
    .then((res) => {
      if (cancelled) return;
      const weakTypes: Array<typeof res.networkType> = ['2g', '3g', 'unknown', 'none'];
      callback(weakTypes.includes(res.networkType));
    })
    .catch(() => {
      /* 忽略 */
    });
  return () => {
    cancelled = true;
    Taro.offNetworkStatusChange(handler);
  };
}

// 统一显示校验问题（toast），返回是否通过
export function showValidationIssue(issue: ValidationIssue | null): issue is null {
  if (issue) {
    Taro.showToast({ title: issue.message, icon: 'none' });
    return false;
  }
  return true;
}

