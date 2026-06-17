import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Text, Textarea, View } from '@tarojs/components';
import Taro, { useDidShow, useLoad, useShareAppMessage } from '@tarojs/taro';
import { courtApi } from '@/services/court';
import type { CasePatch, CourtCase, UserRole } from '@/types/court';
import {
  ANSWER_MAX_LENGTH,
  NAME_MAX_LENGTH,
  STATEMENT_MAX_LENGTH,
  STATEMENT_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  getCurrentCaseId,
  getProviderLabel,
  rememberOwnedCase,
  setCurrentCaseId,
  showValidationIssue,
  subscribeNetworkStatus,
  trimInput,
  validateCaseInfo,
  validateStatement,
} from '@/utils/court';
import styles from './index.module.scss';

const emptyCase: CourtCase = {
  id: '',
  caseNumber: '--',
  inviteCode: '--',
  title: '',
  plaintiffName: '',
  defendantName: '',
  plaintiffStatement: '',
  defendantStatement: '',
  plaintiffAnswer: '',
  defendantAnswer: '',
  question: '',
  verdict: null,
  createdAt: '',
  updatedAt: '',
};

const IndexPage: React.FC = () => {
  const [caseData, setCaseData] = useState<CourtCase>(emptyCase);
  const [role, setRole] = useState<UserRole>('plaintiff');
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [initError, setInitError] = useState<string>('');
  const [flipped, setFlipped] = useState(false);
  const [weakNetwork, setWeakNetwork] = useState(false);

  // 订阅弱网状态
  useEffect(() => {
    const unsubscribe = subscribeNetworkStatus(setWeakNetwork);
    return unsubscribe;
  }, []);

  const canVerdict = useMemo(() => {
    return Boolean(
      caseData.title &&
        caseData.plaintiffName &&
        caseData.defendantName &&
        caseData.plaintiffStatement.trim().length >= STATEMENT_MIN_LENGTH &&
        caseData.defendantStatement.trim().length >= STATEMENT_MIN_LENGTH,
    );
  }, [caseData]);

  const progressText = useMemo(() => {
    if (!caseData.id) return '正在创建案件房间';
    if (caseData.verdict) return '已宣判，可查看裁决书正反面';
    if (!caseData.title || !caseData.plaintiffName || !caseData.defendantName) return '请先补全案由和双方昵称';
    if (caseData.plaintiffStatement.trim().length < STATEMENT_MIN_LENGTH) return `等待原告陈词，至少 ${STATEMENT_MIN_LENGTH} 个字`;
    if (caseData.defendantStatement.trim().length < STATEMENT_MIN_LENGTH) return `等待被告陈词，至少 ${STATEMENT_MIN_LENGTH} 个字`;
    return '双方陈词已齐，可以追问或宣判';
  }, [caseData]);

  useLoad((options) => {
    const sharedCaseId = typeof options.case === 'string' ? options.case : '';
    const sharedRole = options.role === 'defendant' ? 'defendant' : 'plaintiff';
    const inviteCode = typeof options.inviteCode === 'string' ? options.inviteCode : '';
    if (sharedCaseId) {
      setRole(sharedRole);
      setCurrentCaseId(sharedCaseId);
      void joinAndLoadCase(sharedCaseId, sharedRole, inviteCode);
    }
  });

  useDidShow(() => {
    const currentCaseId = getCurrentCaseId();
    if (currentCaseId) {
      void loadCase(currentCaseId);
      return;
    }
    void createCase();
  });

  useShareAppMessage(() => ({
    title: `邀请你出庭：${caseData.title || '情侣法庭'}`,
    path: `/pages/index/index?case=${caseData.id}&role=defendant&inviteCode=${encodeURIComponent(caseData.inviteCode)}`,
  }));

  const patchCase = (patch: CasePatch) => {
    setCaseData((prev) => ({ ...prev, ...patch }));
  };

  const loadCase = async (caseId: string) => {
    if (!caseId) return;
    setInitializing(true);
    setInitError('');
    try {
      const payload = await courtApi.getCase(caseId);
      setCaseData(payload.case);
      setCurrentCaseId(payload.case.id);
      setFlipped(false);
    } catch (error) {
      console.error('[CourtPage] loadCase failed', error);
      setInitError('案件加载失败，请检查网络后重试');
      Taro.showToast({ title: '案件加载失败', icon: 'none' });
    } finally {
      setInitializing(false);
    }
  };

  const joinAndLoadCase = async (caseId: string, joinedRole: UserRole, inviteCode = '') => {
    if (!caseId) return;
    setInitializing(true);
    setInitError('');
    try {
      await courtApi.joinCase({ caseId, role: joinedRole, inviteCode });
    } catch (error) {
      console.warn('[CourtPage] joinCase failed', error);
    } finally {
      await loadCase(caseId);
    }
  };

  const createCase = async () => {
    setLoading(true);
    setInitError('');
    try {
      const payload = await courtApi.createCase();
      setCaseData(payload.case);
      setRole('plaintiff');
      rememberOwnedCase(payload.case.id);
      setCurrentCaseId(payload.case.id);
      setFlipped(false);
    } catch (error) {
      console.error('[CourtPage] createCase failed', error);
      setInitError('创建失败，请确认网络或后端服务');
      Taro.showToast({ title: '创建失败，请确认后端服务', icon: 'none' });
    } finally {
      setLoading(false);
      setInitializing(false);
    }
  };

  const saveCase = async (quiet = false) => {
    if (!caseData.id) return;
    // 表单校验：原告字段在原告身份下必填
    if (role === 'plaintiff') {
      const infoIssue = validateCaseInfo({
        title: caseData.title,
        plaintiffName: caseData.plaintiffName,
        defendantName: caseData.defendantName,
      });
      if (!showValidationIssue(infoIssue)) return;
    }
    setLoading(true);
    const plaintiffFields = {
      title: trimInput(caseData.title, TITLE_MAX_LENGTH),
      plaintiffName: trimInput(caseData.plaintiffName, NAME_MAX_LENGTH),
      defendantName: trimInput(caseData.defendantName, NAME_MAX_LENGTH),
      plaintiffStatement: trimInput(caseData.plaintiffStatement, STATEMENT_MAX_LENGTH),
      plaintiffAnswer: trimInput(caseData.plaintiffAnswer, ANSWER_MAX_LENGTH),
    };
    const defendantFields = {
      defendantStatement: trimInput(caseData.defendantStatement, STATEMENT_MAX_LENGTH),
      defendantAnswer: trimInput(caseData.defendantAnswer, ANSWER_MAX_LENGTH),
    };
    const patch: CasePatch & { role: UserRole } = {
      ...plaintiffFields,
      ...defendantFields,
      role,
    };
    try {
      const payload = await courtApi.updateCase(caseData.id, patch);
      setCaseData(payload.case);
      if (!quiet) Taro.showToast({ title: '已同步', icon: 'success' });
    } catch (error) {
      console.error('[CourtPage] saveCase failed', error);
      Taro.showToast({ title: '同步失败，请稍后重试', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  const askQuestion = async () => {
    // 校验：宣判前双方陈词必须齐
    const pIssue = validateStatement('plaintiffStatement', caseData.plaintiffStatement);
    if (!showValidationIssue(pIssue)) return;
    const dIssue = validateStatement('defendantStatement', caseData.defendantStatement);
    if (!showValidationIssue(dIssue)) return;
    await saveCase(true);
    setLoading(true);
    try {
      const payload = await courtApi.askQuestion(caseData.id);
      setCaseData(payload.case);
      Taro.showToast({ title: 'AI法官已追问', icon: 'success' });
    } catch (error) {
      console.error('[CourtPage] askQuestion failed', error);
      Taro.showToast({ title: '追问失败，请稍后重试', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  const buildVerdict = async () => {
    // 校验：宣判前双方陈词必须齐
    const pIssue = validateStatement('plaintiffStatement', caseData.plaintiffStatement);
    if (!showValidationIssue(pIssue)) return;
    const dIssue = validateStatement('defendantStatement', caseData.defendantStatement);
    if (!showValidationIssue(dIssue)) return;
    await saveCase(true);
    setLoading(true);
    try {
      const payload = await courtApi.buildVerdict(caseData.id);
      setCaseData(payload.case);
      setFlipped(false);
      Taro.showToast({ title: '已宣判', icon: 'success' });
    } catch (error) {
      console.error('[CourtPage] buildVerdict failed', error);
      Taro.showToast({ title: '宣判失败，请稍后重试', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  const copyInvite = async () => {
    if (!caseData.id) {
      Taro.showToast({ title: '案件尚未创建', icon: 'none' });
      return;
    }
    const path = `/pages/index/index?case=${caseData.id}&role=defendant&inviteCode=${encodeURIComponent(caseData.inviteCode)}`;
    try {
      await Taro.setClipboardData({ data: path });
      Taro.showToast({ title: '邀请路径已复制', icon: 'success' });
    } catch (error) {
      console.warn('[CourtPage] copyInvite failed', error);
      Taro.showToast({ title: '复制失败', icon: 'none' });
    }
  };

  const goShare = () => {
    if (!caseData.id) {
      Taro.showToast({ title: '案件尚未创建', icon: 'none' });
      return;
    }
    setCurrentCaseId(caseData.id);
    Taro.switchTab({ url: '/pages/share/index' });
  };

  const archiveCase = async () => {
    if (!caseData.id) return;
    setLoading(true);
    try {
      const payload = await courtApi.archiveCase(caseData.id);
      setCaseData(payload.case);
      Taro.showToast({ title: '已归档', icon: 'success' });
    } catch (error) {
      console.error('[CourtPage] archiveCase failed', error);
      Taro.showToast({ title: '归档失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  const restoreCase = async () => {
    if (!caseData.id) return;
    setLoading(true);
    try {
      const payload = await courtApi.restoreCase(caseData.id);
      setCaseData(payload.case);
      Taro.showToast({ title: '已恢复', icon: 'success' });
    } catch (error) {
      console.error('[CourtPage] restoreCase failed', error);
      Taro.showToast({ title: '恢复失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  const deleteCase = async () => {
    if (!caseData.id) return;
    const confirm = await Taro.showModal({ title: '删除案件', content: '确定删除该案件吗？可在案卷中恢复。', confirmText: '删除', confirmColor: '#f53f3f' });
    if (!confirm.confirm) return;
    setLoading(true);
    try {
      const payload = await courtApi.deleteCase(caseData.id);
      setCaseData(payload.case);
      Taro.showToast({ title: '已删除', icon: 'success' });
    } catch (error) {
      console.error('[CourtPage] deleteCase failed', error);
      Taro.showToast({ title: '删除失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  const purgeCase = async () => {
    if (!caseData.id) return;
    const confirm = await Taro.showModal({ title: '彻底删除', content: '彻底删除后无法恢复，是否继续？', confirmText: '彻底删除', confirmColor: '#f53f3f' });
    if (!confirm.confirm) return;
    setLoading(true);
    try {
      await courtApi.purgeCase(caseData.id);
      setCaseData(emptyCase);
      setCurrentCaseId('');
      Taro.showToast({ title: '已彻底删除', icon: 'success' });
    } catch (error) {
      console.error('[CourtPage] purgeCase failed', error);
      Taro.showToast({ title: '彻底删除失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };
  const frontClassName = flipped ? `${styles.verdictCard} ${styles.flipped}` : styles.verdictCard;
  const verdict = caseData.verdict;

  return (
    <View className={styles.container}>
      {weakNetwork ? (
        <View className={styles.networkHint}>
          <Text className={styles.networkHintText}>网络不稳定，操作可能失败，请耐心等待</Text>
        </View>
      ) : null}

      <View className={styles.hero}>
        <Text className={styles.badge}>AI 情侣法庭</Text>
        <Text className={styles.title}>开庭，别冷战</Text>
        <Text className={styles.desc}>双方陈词后生成娱乐裁决，正面看结果，背面看理由。</Text>
      </View>

      {initializing && !caseData.id ? (
        <View className={styles.loadingCard}>
          <Text className={styles.loadingText}>正在准备案件房间…</Text>
        </View>
      ) : initError && !caseData.id ? (
        <View className={styles.errorCard}>
          <Text className={styles.errorTitle}>{initError}</Text>
          <Button className={styles.primaryButtonSmall} hoverClass="none" loading={loading} onClick={createCase}>
            <View className={styles.buttonInner}>
              <Text className={styles.primaryButtonText}>重试</Text>
            </View>
          </Button>
        </View>
      ) : (
        <>
          <View className={styles.statusCard}>
            <Text className={styles.caseNo}>{caseData.caseNumber}号案件</Text>
            <Text className={styles.status}>{progressText}</Text>
            <View className={styles.roleRow}>
              <View className={role === 'plaintiff' ? styles.roleActive : styles.roleButton} onClick={() => setRole('plaintiff')}>
                <Text>原告</Text>
              </View>
              <View className={role === 'defendant' ? styles.roleActive : styles.roleButton} onClick={() => setRole('defendant')}>
                <Text>被告</Text>
              </View>
            </View>
          </View>

          <View className={styles.formCard}>
            <Text className={styles.sectionTitle}>案件信息</Text>
            <Input className={styles.input} disabled={role !== 'plaintiff'} maxlength={TITLE_MAX_LENGTH} placeholder="案由，例如：打游戏互相抱怨案" value={caseData.title} onInput={(event) => patchCase({ title: event.detail.value })} />
            <Input className={styles.input} disabled={role !== 'plaintiff'} maxlength={NAME_MAX_LENGTH} placeholder="原告昵称" value={caseData.plaintiffName} onInput={(event) => patchCase({ plaintiffName: event.detail.value })} />
            <Input className={styles.input} disabled={role !== 'plaintiff'} maxlength={NAME_MAX_LENGTH} placeholder="被告昵称" value={caseData.defendantName} onInput={(event) => patchCase({ defendantName: event.detail.value })} />
          </View>

          <View className={styles.formCard}>
            <Text className={styles.sectionTitle}>双方陈词</Text>
            <Textarea className={styles.textarea} disabled={role !== 'plaintiff'} maxlength={STATEMENT_MAX_LENGTH} placeholder={`原告陈词，至少 ${STATEMENT_MIN_LENGTH} 个字`} value={caseData.plaintiffStatement} onInput={(event) => patchCase({ plaintiffStatement: event.detail.value })} />
            <Textarea className={styles.textarea} disabled={role !== 'defendant'} maxlength={STATEMENT_MAX_LENGTH} placeholder={`被告陈词，至少 ${STATEMENT_MIN_LENGTH} 个字`} value={caseData.defendantStatement} onInput={(event) => patchCase({ defendantStatement: event.detail.value })} />
          </View>

          {caseData.question ? (
            <View className={styles.questionCard}>
              <Text className={styles.sectionTitle}>法官追问</Text>
              <Text className={styles.questionText}>{caseData.question}</Text>
              <Textarea className={styles.textarea} disabled={role !== 'plaintiff'} maxlength={ANSWER_MAX_LENGTH} placeholder="原告补充回答" value={caseData.plaintiffAnswer} onInput={(event) => patchCase({ plaintiffAnswer: event.detail.value })} />
              <Textarea className={styles.textarea} disabled={role !== 'defendant'} maxlength={ANSWER_MAX_LENGTH} placeholder="被告补充回答" value={caseData.defendantAnswer} onInput={(event) => patchCase({ defendantAnswer: event.detail.value })} />
            </View>
          ) : null}

          <View className={styles.actionGrid}>
            <Button className={styles.secondaryButton} hoverClass="none" loading={loading} onClick={() => saveCase(false)}>
              <View className={styles.buttonInner}>
                <Text className={styles.secondaryButtonText}>同步陈词</Text>
              </View>
            </Button>
            <Button className={styles.secondaryButton} hoverClass="none" disabled={!canVerdict || loading} onClick={askQuestion}>
              <View className={styles.buttonInner}>
                <Text className={styles.secondaryButtonText}>AI追问</Text>
              </View>
            </Button>
            <Button className={styles.primaryButton} hoverClass="none" disabled={!canVerdict || loading} loading={loading} onClick={buildVerdict}>
              <View className={styles.buttonInner}>
                <Text className={styles.primaryButtonText}>生成裁决</Text>
              </View>
            </Button>
            <Button className={styles.secondaryButton} hoverClass="none" openType="share" disabled={!caseData.id}>
              <View className={styles.buttonInner}>
                <Text className={styles.secondaryButtonText}>邀请被告</Text>
              </View>
            </Button>
            <Button className={styles.secondaryButton} hoverClass="none" disabled={!caseData.id} onClick={copyInvite}>
              <View className={styles.buttonInner}>
                <Text className={styles.secondaryButtonText}>复制路径</Text>
              </View>
            </Button>
            <Button className={styles.secondaryButton} hoverClass="none" onClick={createCase}>
              <View className={styles.buttonInner}>
                <Text className={styles.secondaryButtonText}>新案件</Text>
              </View>
            </Button>
          </View>

          <View className={styles.actionGrid}>
            <Button className={styles.secondaryButton} hoverClass="none" disabled={!caseData.id || loading} onClick={archiveCase}>
              <View className={styles.buttonInner}>
                <Text className={styles.secondaryButtonText}>归档</Text>
              </View>
            </Button>
            <Button className={styles.secondaryButton} hoverClass="none" disabled={!caseData.id || loading} onClick={restoreCase}>
              <View className={styles.buttonInner}>
                <Text className={styles.secondaryButtonText}>恢复</Text>
              </View>
            </Button>
            <Button className={styles.secondaryButton} hoverClass="none" disabled={!caseData.id || loading} onClick={deleteCase}>
              <View className={styles.buttonInner}>
                <Text className={styles.secondaryButtonText}>删除</Text>
              </View>
            </Button>
            <Button className={styles.secondaryButton} hoverClass="none" disabled={!caseData.id || loading} onClick={purgeCase}>
              <View className={styles.buttonInner}>
                <Text className={styles.secondaryButtonText}>彻底删除</Text>
              </View>
            </Button>
          </View>

          <View className={styles.actionGrid}>
            <Button className={styles.secondaryButton} hoverClass="none" onClick={() => Taro.navigateTo({ url: '/pages/legal/index' })}>
              <View className={styles.buttonInner}>
                <Text className={styles.secondaryButtonText}>隐私与协议</Text>
              </View>
            </Button>
          </View>

          <View className={frontClassName}>
            <View className={styles.cardFaceFront}>
              <Text className={styles.verdictTitle}>裁决书正面</Text>
              <Text className={styles.verdictCase}>{caseData.title || '等待案由'}</Text>
              {verdict ? (
                <View>
                  <Text className={styles.ratio}>{caseData.plaintiffName} {verdict.ratio.plaintiff}% / {caseData.defendantName} {verdict.ratio.defendant}%</Text>
                  <Text className={styles.reason}>{verdict.reason}</Text>
                  <Text className={styles.penalty}>{verdict.penalty}</Text>
                  <Text className={styles.provider}>{getProviderLabel(verdict.provider, verdict.model)}</Text>
                  <View className={styles.verdictActions}>
                    <Button className={styles.primaryButtonSmall} hoverClass="none" onClick={() => setFlipped(true)}>
                      <View className={styles.buttonInner}>
                        <Text className={styles.primaryButtonText}>查看裁决理由</Text>
                      </View>
                    </Button>
                    <Button className={styles.secondaryButtonSmall} hoverClass="none" onClick={goShare}>
                      <View className={styles.buttonInner}>
                        <Text className={styles.secondaryButtonText}>分享裁决</Text>
                      </View>
                    </Button>
                  </View>
                </View>
              ) : (
                <Text className={styles.reason}>双方陈词同步完成后，这里会生成责任比例、处罚和来源说明。</Text>
              )}
            </View>

            {verdict ? (
              <View className={styles.cardFaceBack}>
                <Text className={styles.verdictTitle}>裁决书背面</Text>
                <Text className={styles.backSubtitle}>事实认定</Text>
                <Text className={styles.backText}>{verdict.facts}</Text>
                <Text className={styles.backSubtitle}>推理步骤</Text>
                {(verdict.reasoning || []).map((item) => (
                  <View key={`${item.step || item.label}`} className={styles.reasonStep}>
                    <Text className={styles.stepTitle}>{item.step || ''}. {item.label}</Text>
                    <Text className={styles.backText}>{item.text}</Text>
                  </View>
                ))}
                <Text className={styles.backSubtitle}>适用规则</Text>
                <Text className={styles.backText}>{(verdict.focus || []).join('；') || '暂无'}</Text>
                <Text className={styles.backSubtitle}>和解建议</Text>
                <Text className={styles.backText}>{verdict.settlement}</Text>
                <Button className={styles.primaryButtonSmall} hoverClass="none" onClick={() => setFlipped(false)}>
                  <View className={styles.buttonInner}>
                    <Text className={styles.primaryButtonText}>返回正面</Text>
                  </View>
                </Button>
              </View>
            ) : null}
          </View>
        </>
      )}
    </View>
  );
};

export default IndexPage;
