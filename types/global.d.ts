/// <reference types="@tarojs/taro" />

declare module '*.png';
declare module '*.gif';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.svg';
declare module '*.css';
declare module '*.less';
declare module '*.scss';
declare module '*.sass';
declare module '*.styl';

declare namespace NodeJS {
  interface ProcessEnv {
    /** NODE 内置环境变量, 会影响到最终构建生成产物 */
    NODE_ENV: 'development' | 'production';
    /** 当前构建的平台 */
    TARO_ENV: 'weapp' | 'swan' | 'alipay' | 'h5' | 'rn' | 'tt' | 'quickapp' | 'qq' | 'jd';
    /** 当前构建的小程序 appid */
    TARO_APP_ID: string;
    /** 当前构建模式 */
    TARO_APP_ENV?: 'development' | 'production';
    /** 小程序正式/测试 API 基础地址 */
    TARO_APP_API_BASE?: string;
    /** 微信登录后端换取业务 token 的接口路径 */
    TARO_APP_AUTH_LOGIN_PATH?: string;
    /** 是否启用微信登录换取业务 token */
    TARO_APP_LOGIN_ENABLED?: string;
    /** 业务 token 的本地缓存 key */
    TARO_APP_TOKEN_KEY?: string;
    /** 刷新 token 的本地缓存 key */
    TARO_APP_REFRESH_TOKEN_KEY?: string;
  }
}
