import { useEffect } from 'react';
import { useDidHide, useDidShow } from '@tarojs/taro';
import { bootstrapBusinessSession } from '@/services/auth';
// 全局样式
import './app.scss';

function App(props) {
  useEffect(() => {
    bootstrapBusinessSession();
  }, []);

  // 对应 onShow
  useDidShow(() => {});

  // 对应 onHide
  useDidHide(() => {});

  return props.children;
}

export default App;
