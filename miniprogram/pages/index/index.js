Page({
  navTo(e) {
    const url = e.currentTarget.dataset.url;
    wx.navigateTo({
      url: url
    })
  }
})
