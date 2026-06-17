import React, { useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { courtApi } from '@/services/court';
import styles from './index.module.scss';

const LegalPage: React.FC = () => {
  const [deleting, setDeleting] = useState(false);

  const deleteMyData = async () => {
    const confirm = await Taro.showModal({
      title: '删除我的数据',
      content: '将软删除你在本设备/账号下的全部案件陈词与裁决，操作可在案卷中恢复（彻底删除需进入案件后再次操作）。是否继续？',
      confirmText: '确认删除',
      confirmColor: '#f53f3f',
    });
    if (!confirm.confirm) return;
    setDeleting(true);
    try {
      const result = await courtApi.deleteMyData();
      Taro.showToast({ title: `已删除 ${result.removed ?? 0} 条数据`, icon: 'success' });
    } catch (error) {
      console.error('[LegalPage] deleteMyData failed', error);
      Taro.showToast({ title: '删除失败，请稍后重试', icon: 'none' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View className={styles.container}>
      <View className={styles.header}>
        <Text className={styles.title}>隐私与协议</Text>
        <Text className={styles.desc}>本页汇总 Love Court 的隐私政策、用户协议、AI 内容说明与数据删除入口，供审核与用户查阅。</Text>
      </View>

      <View className={styles.sectionCard}>
        <Text className={styles.sectionTitle}>隐私政策</Text>
        <Text className={styles.sectionBody}>
          Love Court 是一款轻量娱乐向的情侣/朋友争议小程序，仅收集为生成娱乐裁决所必需的最少信息：
        </Text>
        <View className={styles.list}>
          <Text className={styles.listItem}>· 案件陈词、补充回答、昵称等用户输入文本，仅用于生成娱乐裁决；</Text>
          <Text className={styles.listItem}>· 客户端标识（client-id）或微信登录态，用于区分用户与隔离案件访问；</Text>
          <Text className={styles.listItem}>· 不收集身份证号、银行卡号、手机号等敏感个人信息；</Text>
          <Text className={styles.listItem}>· 服务端日志会进行脱敏处理，屏蔽 token、手机号、邮箱等敏感字段；</Text>
          <Text className={styles.listItem}>· 案件数据按参与关系做最小权限隔离，非参与者无法访问；</Text>
          <Text className={styles.listItem}>· 用户可随时通过本页“删除我的数据”入口软删除自己的案件。</Text>
        </View>
      </View>

      <View className={styles.sectionCard}>
        <Text className={styles.sectionTitle}>用户协议</Text>
        <Text className={styles.sectionBody}>
          使用 Love Court 即视为你已阅读并同意以下条款：
        </Text>
        <View className={styles.list}>
          <Text className={styles.listItem}>· 本应用仅供娱乐，裁决结果不构成法律、医疗、心理或投资建议；</Text>
          <Text className={styles.listItem}>· 请勿上传违法、暴力、色情、自伤自杀、人身攻击等内容，系统将拦截并拒绝；</Text>
          <Text className={styles.listItem}>· 不得利用本应用骚扰、威胁或诽谤他人；</Text>
          <Text className={styles.listItem}>· 你对自己输入的内容负责，因滥用造成的后果由你自行承担；</Text>
          <Text className={styles.listItem}>· 我们保留对违规内容进行拦截、删除或限制账号访问的权利。</Text>
        </View>
      </View>

      <View className={styles.sectionCard}>
        <Text className={styles.sectionTitle}>AI 内容说明</Text>
        <Text className={styles.sectionBody}>
          本应用的部分裁决由 AI 模型（如 DeepSeek）生成，部分由本地规则生成，来源会在裁决书中标注：
        </Text>
        <View className={styles.list}>
          <Text className={styles.listItem}>· AI 生成的裁决仅为娱乐性质，可能存在偏差或不准确，请勿作为严肃判断依据；</Text>
          <Text className={styles.listItem}>· AI 不会提供法律咨询、医疗诊断、危机干预或代码生成；</Text>
          <Text className={styles.listItem}>· 涉及危机（自伤、家暴等）内容会被拦截，请寻求专业帮助；</Text>
          <Text className={styles.listItem}>· 裁决书正面会标注“本裁决由 AI 模型生成”或“本裁决根据本地规则生成”。</Text>
        </View>
      </View>

      <View className={styles.dangerCard}>
        <Text className={styles.dangerTitle}>删除我的数据</Text>
        <Text className={styles.dangerDesc}>
          点击下方按钮将软删除你在本设备/账号下的全部案件陈词与裁决。软删除后案件在案卷中不再可见，如需彻底删除请进入具体案件后再次操作。
        </Text>
        <Button className={styles.deleteButton} hoverClass="none" loading={deleting} disabled={deleting} onClick={deleteMyData}>
          <View className={styles.buttonInner}>
            <Text className={styles.deleteButtonText}>删除我的数据</Text>
          </View>
        </Button>
      </View>

      <View className={styles.footer}>
        <Text className={styles.footerText}>Love Court · 仅限娱乐 · 请勿用于严肃判断</Text>
      </View>
    </View>
  );
};

export default LegalPage;
