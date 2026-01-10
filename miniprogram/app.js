App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloudbase-5gq7alw957688328', // REPLACE WITH YOUR ENV ID
        traceUser: true,
      });
    }
  },
  globalData: {
    // No longer needed baseUrl
  }
})
