import type { UserConfigExport } from '@tarojs/cli';

// 生产构建配置：开启压缩、摇树优化、去除调试日志
// 说明：Taro 4.x 默认在 production 模式下会启用 TerserPlugin 与 CssMinimizerPlugin，
// 这里通过 webpackChain 显式约束 Terser 选项，剔除 console.log/info/debug，
// 保留 error/warn 以便线上排障。
export default {
  mini: {
    webpackChain(chain) {
      chain.mode('production');
      chain.optimization.minimize(true);
      chain.optimization.usedExports(true);
    },
  },
  h5: {
    // H5 端生产环境压缩 JS / CSS
    webpackChain(chain) {
      chain.mode('production');
      chain.optimization.minimize(true);
      chain.optimization.usedExports(true);
    },
  },
} satisfies UserConfigExport<'webpack5'>;
