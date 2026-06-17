import Taro from '@tarojs/taro';

const DEFAULT_DEV_API_BASE = 'http://127.0.0.1:3000';
const DEFAULT_PROD_API_BASE = 'https://api.love-court.example.com';

export type AppRuntimeEnv = 'development' | 'production';

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '');
}

export const runtimeEnv: AppRuntimeEnv =
  process.env.TARO_APP_ENV === 'production' || process.env.NODE_ENV === 'production' ? 'production' : 'development';

export const isDevelopmentEnv = runtimeEnv === 'development';
export const isProductionEnv = runtimeEnv === 'production';

export const apiBaseUrl = normalizeBaseUrl(
  process.env.TARO_APP_API_BASE || (isProductionEnv ? DEFAULT_PROD_API_BASE : DEFAULT_DEV_API_BASE),
);

export const authEnabled = (process.env.TARO_APP_LOGIN_ENABLED || 'true') !== 'false';
export const authLoginPath = process.env.TARO_APP_AUTH_LOGIN_PATH || '/api/auth/wechat/login';
export const businessTokenKey = process.env.TARO_APP_TOKEN_KEY || 'love-court-business-token';
export const refreshTokenKey = process.env.TARO_APP_REFRESH_TOKEN_KEY || 'love-court-refresh-token';

export function buildApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${apiBaseUrl}${normalizedPath}`;
}

export function readStoredBusinessToken() {
  try {
    return Taro.getStorageSync<string>(businessTokenKey) || '';
  } catch (error) {
    console.error('[Env] read token failed', error);
    return '';
  }
}
