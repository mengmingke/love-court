export default defineAppConfig({
  pages: ['pages/index/index', 'pages/archive/index', 'pages/share/index', 'pages/legal/index'],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#f7f2ff',
    navigationBarTitleText: 'Love Court',
    navigationBarTextStyle: 'black',
  },
  tabBar: {
    color: '#86909c',
    selectedColor: '#7c4dff',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '庭审',
      },
      {
        pagePath: 'pages/archive/index',
        text: '案卷',
      },
      {
        pagePath: 'pages/share/index',
        text: '分享',
      },
    ],
  },
});
