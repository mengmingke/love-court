import Taro from '@tarojs/taro';
import { authEnabled, authLoginPath, buildApiUrl, businessTokenKey, refreshTokenKey, readStoredBusinessToken } from '@/config/env';

export interface BusinessSession {
  token: string;
  refreshToken?: string;
  userId?: string;
  openId?: string;
  unionId?: string;
  expiresAt?: string;
}

const SESSION_STORAGE_KEY = 'love-court-business-session';
const CLIENT_ID_STORAGE_KEY = 'love-court-client-id';

function readSession() {
  try {
    return Taro.getStorageSync<BusinessSession>(SESSION_STORAGE_KEY) || null;
  } catch (error) {
    console.error('[Auth] read session failed', error);
    return null;
  }
}

function persistSession(session: BusinessSession) {
  Taro.setStorageSync(SESSION_STORAGE_KEY, session);
  Taro.setStorageSync(businessTokenKey, session.token);
  if (session.refreshToken) {
    Taro.setStorageSync(refreshTokenKey, session.refreshToken);
  }
}

function getOrCreateClientId() {
  try {
    const existing = Taro.getStorageSync<string>(CLIENT_ID_STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const clientId = `client-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
    Taro.setStorageSync(CLIENT_ID_STORAGE_KEY, clientId);
    return clientId;
  } catch (error) {
    console.error('[Auth] client id failed', error);
    return `client-${Date.now().toString(36)}`;
  }
}

async function exchangeWechatCode(code: string) {
  const response = await Taro.request<{ session?: BusinessSession; token?: string; refreshToken?: string; data?: BusinessSession }>({
    url: buildApiUrl(authLoginPath),
    method: 'POST',
    data: { code },
    header: {
      'Content-Type': 'application/json',
    },
  });

  const payload = (response.data?.session || response.data?.data || (response.data?.token ? (response.data as BusinessSession) : null)) as BusinessSession | undefined;
  if (payload?.token) {
    persistSession(payload);
  }
  return payload;
}

export function getBusinessToken() {
  return readSession()?.token || readStoredBusinessToken();
}

export function getBusinessAuthHeader() {
  const token = getBusinessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getClientIdentityHeader() {
  return { 'X-Love-Court-Client-Id': getOrCreateClientId() };
}

export function clearBusinessSession() {
  Taro.removeStorageSync(SESSION_STORAGE_KEY);
  Taro.removeStorageSync(businessTokenKey);
  Taro.removeStorageSync(refreshTokenKey);
}

export async function bootstrapBusinessSession() {
  if (!authEnabled || process.env.TARO_ENV !== 'weapp') {
    return getBusinessToken();
  }

  const existingToken = getBusinessToken();
  if (existingToken) {
    return existingToken;
  }

  try {
    const loginResult = await Taro.login();
    if (!loginResult.code) {
      return '';
    }

    const session = await exchangeWechatCode(loginResult.code);
    return session?.token || '';
  } catch (error) {
    console.warn('[Auth] bootstrap session failed', error);
    return getBusinessToken();
  }
}
