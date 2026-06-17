import React, { useEffect, useState } from 'react';
import { Button, Image, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useShareAppMessage } from '@tarojs/taro';
import { courtApi } from '@/services/court';
import type { CourtCase } from '@/types/court';
import { getCurrentCaseId, getProviderLabel, subscribeNetworkStatus } from '@/utils/court';
import styles from './index.module.scss';

type LoadState = 'loading' | 'empty' | 'error' | 'success';

const SharePage: React.FC = () => {
  const [caseData, setCaseData] = useState<CourtCase | null>(null);
  const [loading, setLoading] = useState(false);
  const [posterLoading, setPosterLoading] = useState(false);
  const [posterPath, setPosterPath] = useState<string>('');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [weakNetwork, setWeakNetwork] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeNetworkStatus(setWeakNetwork);
    return unsubscribe;
  }, []);

  useDidShow(() => {
    loadCurrentCase();
  });

  useShareAppMessage(() => ({
    title: `裁决书：${caseData?.title || '情侣法庭'}`,
    path: `/pages/index/index?case=${caseData?.id || ''}&role=defendant`,
  }));

  const loadCurrentCase = async () => {
    const caseId = getCurrentCaseId();
    if (!caseId) {
      setLoadState('empty');
      setErrorMessage('');
      return;
    }
    setLoading(true);
    setLoadState('loading');
    try {
      const payload = await courtApi.getCase(caseId);
      setCaseData(payload.case);
      setPosterPath('');
      setLoadState(payload.case?.verdict ? 'success' : 'empty');
      setErrorMessage('');
    } catch (error) {
      console.error('[SharePage] loadCurrentCase failed', error);
      setErrorMessage('裁决读取失败，请检查网络后重试');
      setLoadState('error');
      Taro.showToast({ title: '裁决读取失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  const copyVerdict = async () => {
    if (!caseData?.verdict) {
      Taro.showToast({ title: '请先生成裁决', icon: 'none' });
      return;
    }
    const verdict = caseData.verdict;
    const content = [
      '爱情法庭裁决书',
      `${caseData.caseNumber}号案件`,
      `案由：${caseData.title}`,
      `责任比例：${caseData.plaintiffName} ${verdict.ratio.plaintiff}% / ${caseData.defendantName} ${verdict.ratio.defendant}%`,
      `判决结果：${verdict.penalty}`,
      getProviderLabel(verdict.provider, verdict.model),
    ].join('\n');
    try {
      await Taro.setClipboardData({ data: content });
      Taro.showToast({ title: '裁决文字已复制', icon: 'success' });
    } catch (error) {
      console.warn('[SharePage] copyVerdict failed', error);
      Taro.showToast({ title: '复制失败', icon: 'none' });
    }
  };

  const generatePoster = async () => {
    if (!caseData?.id || !caseData?.verdict) {
      Taro.showToast({ title: '请先生成裁决', icon: 'none' });
      return;
    }
    if (caseData.id.startsWith('local-')) {
      Taro.showToast({ title: '本地案件暂不支持海报，请连接后端', icon: 'none' });
      return;
    }
    setPosterLoading(true);
    try {
      const tempPath = await courtApi.downloadShareImage(caseData.id);
      setPosterPath(tempPath);
      await Taro.previewImage({ urls: [tempPath], current: tempPath });
    } catch (error) {
      console.error('[SharePage] generatePoster failed', error);
      const message = error instanceof Error ? error.message : '海报生成失败，请稍后重试';
      Taro.showToast({ title: message, icon: 'none' });
    } finally {
      setPosterLoading(false);
    }
  };

  const savePosterToAlbum = async () => {
    if (!posterPath) {
      Taro.showToast({ title: '请先生成海报', icon: 'none' });
      return;
    }
    try {
      // 兼容旧版微信：先检查相册权限
      const setting = await Taro.getSetting();
      if (setting.authSetting['scope.writePhotosAlbum'] === false) {
        Taro.showToast({ title: '请在设置中开启相册权限', icon: 'none' });
        return;
      }
      await Taro.saveImageToPhotosAlbum({ filePath: posterPath });
      Taro.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (error) {
      console.warn('[SharePage] savePosterToAlbum failed', error);
      Taro.showToast({ title: '保存失败，请确认相册权限', icon: 'none' });
    }
  };

  const goCourt = () => {
    Taro.switchTab({ url: '/pages/index/index' });
  };

  const verdict = caseData?.verdict;

  return (
    <View className={styles.container}>
      {weakNetwork ? (
        <View className={styles.networkHint}>
          <Text className={styles.networkHintText}>网络不稳定，海报生成可能较慢</Text>
        </View>
      ) : null}

      <View className={styles.header}>
        <Text className={styles.title}>分享裁决</Text>
        <Text className={styles.desc}>复制裁决文字或使用微信右上角转发给对方。</Text>
        <Button className={styles.refreshButton} hoverClass="none" loading={loading} onClick={loadCurrentCase}>
          <View className={styles.buttonInner}>
            <Text className={styles.refreshButtonText}>刷新裁决</Text>
          </View>
        </Button>
      </View>

      {loadState === 'loading' ? (
        <View className={styles.loadingCard}>
          <Text className={styles.loadingText}>正在读取裁决…</Text>
        </View>
      ) : null}

      {loadState === 'error' ? (
        <View className={styles.errorCard}>
          <Text className={styles.errorTitle}>{errorMessage}</Text>
          <Button className={styles.refreshButton} hoverClass="none" loading={loading} onClick={loadCurrentCase}>
            <View className={styles.buttonInner}>
              <Text className={styles.refreshButtonText}>重试</Text>
            </View>
          </Button>
        </View>
      ) : null}

      {loadState === 'empty' ? (
        <View className={styles.emptyCard}>
          <Text className={styles.emptyTitle}>暂无可分享裁决</Text>
          <Text className={styles.emptyText}>回到庭审页完成双方陈词并生成裁决。</Text>
          <Button className={styles.refreshButton} hoverClass="none" onClick={goCourt}>
            <View className={styles.buttonInner}>
              <Text className={styles.refreshButtonText}>去庭审页</Text>
            </View>
          </Button>
        </View>
      ) : null}

      {caseData && verdict ? (
        <View className={styles.posterCard}>
          <Text className={styles.brand}>Love Court</Text>
          <Text className={styles.caseNo}>{caseData.caseNumber}号案件</Text>
          <Text className={styles.caseTitle}>{caseData.title}</Text>
          <View className={styles.ratioBox}>
            <Text className={styles.ratio}>{caseData.plaintiffName} {verdict.ratio.plaintiff}%</Text>
            <Text className={styles.vs}>VS</Text>
            <Text className={styles.ratio}>{caseData.defendantName} {verdict.ratio.defendant}%</Text>
          </View>
          <Text className={styles.reason}>{verdict.reason}</Text>
          <Text className={styles.penalty}>{verdict.penalty}</Text>
          <Text className={styles.provider}>{getProviderLabel(verdict.provider, verdict.model)}</Text>
          <Button className={styles.primaryButton} hoverClass="none" loading={posterLoading} disabled={posterLoading} onClick={generatePoster}>
            <View className={styles.buttonInner}>
              <Text className={styles.primaryButtonText}>生成裁决海报</Text>
            </View>
          </Button>
          {posterPath ? (
            <View className={styles.posterPreview}>
              <Image className={styles.posterImage} src={posterPath} mode="widthFix" />
              <Button className={styles.secondaryButton} hoverClass="none" onClick={savePosterToAlbum}>
                <View className={styles.buttonInner}>
                  <Text className={styles.secondaryButtonText}>保存到相册</Text>
                </View>
              </Button>
            </View>
          ) : null}
          <Button className={styles.secondaryButton} hoverClass="none" onClick={copyVerdict}>
            <View className={styles.buttonInner}>
              <Text className={styles.secondaryButtonText}>复制裁决文字</Text>
            </View>
          </Button>
          <Button className={styles.secondaryButton} hoverClass="none" openType="share">
            <View className={styles.buttonInner}>
              <Text className={styles.secondaryButtonText}>转发给对方</Text>
            </View>
          </Button>
        </View>
      ) : null}
    </View>
  );
};

export default SharePage;
