const app = getApp();

Page({
  data: {
    toCompany: '光大环保能源(九江)有限公司',
    projectContent: '',
    projectCode: '项目编号：HBNY-GX-2025-15288',
    noProjectCode: false,
    date: '',
    loading: false,
    pdfUrl: '',
    fileID: ''
  },

  onLoad() {
    // Set default date to today
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    this.setData({
      date: `${y}-${m}-${d}`
    });
  },

  handleInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [field]: e.detail.value
    });
  },

  bindDateChange(e) {
    this.setData({
      date: e.detail.value
    });
  },

  toggleNoProjectCode() {
    this.setData({
      noProjectCode: !this.data.noProjectCode
    });
  },

  async generatePDF() {
    if (!this.data.toCompany || !this.data.projectContent || !this.data.date) {
      wx.showToast({
        title: '请填写完整信息',
        icon: 'none'
      });
      return;
    }

    this.setData({ loading: true, pdfUrl: '', fileID: '' });

    try {
      const res = await wx.cloud.callFunction({
        name: 'repairFunctions',
        data: {
          action: 'generatePerformanceLetter',
          data: {
            toCompany: this.data.toCompany,
            projectContent: this.data.projectContent,
            projectCode: this.data.noProjectCode ? '' : this.data.projectCode,
            date: this.data.date
          }
        }
      });

      if (res.result && res.result.success) {
        const fileID = res.result.fileID;
        this.setData({ fileID });

        wx.showLoading({ title: '下载中...' });

        wx.cloud.downloadFile({
          fileID: fileID,
          success: (downloadRes) => {
            const fs = wx.getFileSystemManager();
            const filePath = `${wx.env.USER_DATA_PATH}/履约能力确认函.pdf`;

            fs.saveFile({
              tempFilePath: downloadRes.tempFilePath,
              filePath: filePath,
              success: (saveRes) => {
                wx.openDocument({
                  filePath: saveRes.savedFilePath,
                  showMenu: true,
                  success: () => wx.hideLoading(),
                  fail: () => {
                    wx.hideLoading();
                    wx.showToast({ title: '打开文档失败', icon: 'none' });
                  }
                });
              },
              fail: (err) => {
                console.error('保存文件失败，尝试直接打开临时文件', err);
                wx.openDocument({
                  filePath: downloadRes.tempFilePath,
                  showMenu: true,
                  success: () => wx.hideLoading(),
                  fail: () => {
                    wx.hideLoading();
                    wx.showToast({ title: '打开文档失败', icon: 'none' });
                  }
                });
              }
            });
          },
          fail: (err) => {
            wx.hideLoading();
            wx.showToast({ title: '下载文件失败', icon: 'none' });
            console.error(err);
          }
        });

      } else {
        throw new Error(res.result?.error || '生成失败');
      }
    } catch (err) {
      console.error(err);
      wx.hideLoading();
      wx.showToast({
        title: '生成出错: ' + err.message,
        icon: 'none'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  openPDF() {},

  copyLink() {}
});
