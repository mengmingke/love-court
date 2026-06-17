import React, { useEffect, useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { courtApi } from '@/services/court';
import type { CourtCase } from '@/types/court';
import { setCurrentCaseId, subscribeNetworkStatus } from '@/utils/court';
import styles from './index.module.scss';

type LoadState = 'idle' | 'loading' | 'empty' | 'error' | 'success';

const ArchivePage: React.FC = () => {
  const [cases, setCases] = useState<CourtCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [weakNetwork, setWeakNetwork] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeNetworkStatus(setWeakNetwork);
    return unsubscribe;
  }, []);

  useDidShow(() => {
    loadArchive(1);
  });

  usePullDownRefresh(async () => {
    await loadArchive(1);
    Taro.stopPullDownRefresh();
  });

  const loadArchive = async (nextPage = page) => {
    setLoading(true);
    if (nextPage === 1) setLoadState('loading');
    try {
      const payload = await courtApi.listCases(nextPage, pageSize);
      const list = payload.cases || [];
      setCases(list);
      setPage(payload.page || nextPage);
      setTotalPages(payload.totalPages || 1);
      setLoadState(list.length === 0 ? 'empty' : 'success');
      setErrorMessage('');
    } catch (error) {
      console.error('[ArchivePage] loadArchive failed', error);
      setErrorMessage('案卷读取失败，请检查网络后重试');
      setLoadState(cases.length === 0 ? 'error' : 'success');
      Taro.showToast({ title: '案卷读取失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  const openCase = (caseId: string) => {
    if (!caseId) {
      Taro.showToast({ title: '案件 ID 异常', icon: 'none' });
      return;
    }
    setCurrentCaseId(caseId);
    Taro.switchTab({ url: '/pages/index/index' });
  };

  const goCreate = () => {
    Taro.switchTab({ url: '/pages/index/index' });
  };

  return (
    <View className={styles.container}>
      {weakNetwork ? (
        <View className={styles.networkHint}>
          <Text className={styles.networkHintText}>网络不稳定，加载可能较慢</Text>
        </View>
      ) : null}

      <View className={styles.header}>
        <Text className={styles.title}>案卷</Text>
        <Text className={styles.desc}>查看已经创建的案件，继续庭审或回看裁决结果。</Text>
        <Button className={styles.refreshButton} hoverClass="none" loading={loading} onClick={() => loadArchive(1)}>
          <View className={styles.buttonInner}>
            <Text className={styles.refreshButtonText}>刷新案卷</Text>
          </View>
        </Button>
      </View>

      {loadState === 'loading' && cases.length === 0 ? (
        <View className={styles.loadingCard}>
          <Text className={styles.loadingText}>正在读取案卷…</Text>
        </View>
      ) : null}

      {loadState === 'error' && cases.length === 0 ? (
        <View className={styles.errorCard}>
          <Text className={styles.errorTitle}>{errorMessage}</Text>
          <Button className={styles.retryButton} hoverClass="none" loading={loading} onClick={() => loadArchive(1)}>
            <View className={styles.buttonInner}>
              <Text className={styles.retryButtonText}>重试</Text>
            </View>
          </Button>
        </View>
      ) : null}

      {loadState === 'empty' ? (
        <View className={styles.emptyCard}>
          <Text className={styles.emptyTitle}>暂无案卷</Text>
          <Text className={styles.emptyText}>回到庭审页创建第一个案件。</Text>
          <Button className={styles.retryButton} hoverClass="none" onClick={goCreate}>
            <View className={styles.buttonInner}>
              <Text className={styles.retryButtonText}>去创建案件</Text>
            </View>
          </Button>
        </View>
      ) : null}

      {cases.length > 0 ? (
        <>
          {cases.map((item) => (
            <View key={item.id} className={styles.caseCard} onClick={() => openCase(item.id)}>
              <View className={styles.caseHeader}>
                <Text className={styles.caseNo}>{item.caseNumber}号</Text>
                <Text className={item.verdict ? styles.doneTag : styles.pendingTag}>{item.verdict ? '已宣判' : '庭审中'}</Text>
              </View>
              <Text className={styles.caseTitle}>{item.title || '未命名案件'}</Text>
              <Text className={styles.caseMeta}>原告：{item.plaintiffName || '-'}　被告：{item.defendantName || '-'}</Text>
              <Text className={styles.caseResult}>
                {item.verdict
                  ? `责任比例：${item.plaintiffName} ${item.verdict.ratio.plaintiff}% / ${item.defendantName} ${item.verdict.ratio.defendant}%`
                  : '双方陈词完成后即可宣判'}
              </Text>
            </View>
          ))}
          {totalPages > page ? (
            <Button className={styles.refreshButton} hoverClass="none" loading={loading} onClick={() => loadArchive(page + 1)}>
              <View className={styles.buttonInner}>
                <Text className={styles.refreshButtonText}>加载下一页</Text>
              </View>
            </Button>
          ) : cases.length > 0 ? (
            <View className={styles.listEnd}>
              <Text className={styles.listEndText}>没有更多案卷了</Text>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
};

export default ArchivePage;
