const app = getApp();

Page({
  data: {
    parsedData: false,
    vehicle: '',
    repairUnit: '',
    repairLocation: '',
    date: '',
    items: [],
    rawText: '',
    excelHeader: []
  },

  choosePdf() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['pdf', 'xls', 'xlsx'],
      success: (res) => {
        const file = res.tempFiles[0];
        this.uploadPdf(file);
      }
    });
  },

  uploadPdf(file) {
    wx.showLoading({ title: '解析中...' });
    
    // 1. Upload to Cloud Storage
    const cloudPath = `temp/upload-${Date.now()}.${file.name.split('.').pop()}`;
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: file.path,
      success: (uploadRes) => {
        // 2. Call Cloud Function to parse
        wx.cloud.callFunction({
          name: 'repairFunctions',
          data: {
            action: 'parsePDF',
            data: {
              fileID: uploadRes.fileID
            }
          },
          success: (res) => {
            wx.hideLoading();
            if (res.result.success) {
              const data = res.result.data;
              this.setData({
                parsedData: true,
                vehicle: data.vehicle || '',
                repairUnit: data.repairUnit || '',
                repairLocation: data.repairLocation || '',
                date: data.date || '',
                items: data.items.length ? data.items : [{ name: '', quantity: 1, price: 0, laborCost: 0, spec: '' }],
                rawText: data.rawText,
                excelHeader: data.excelHeader || []
              });
              wx.showToast({ title: '解析完成', icon: 'success' });
            } else {
              wx.showToast({ title: '解析失败', icon: 'none' });
            }
          },
          fail: (err) => {
            wx.hideLoading();
            wx.showToast({ title: '解析调用失败', icon: 'none' });
            console.error(err);
          }
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  inputVehicle(e) { this.setData({ vehicle: e.detail.value }); },
  inputRepairUnit(e) { this.setData({ repairUnit: e.detail.value }); },
  inputRepairLocation(e) { this.setData({ repairLocation: e.detail.value }); },

  inputItem(e) {
    const index = e.currentTarget.dataset.index;
    const field = e.currentTarget.dataset.field;
    const items = this.data.items;
    items[index][field] = e.detail.value;
    this.setData({ items });
  },

  addRow() {
    const items = this.data.items;
    items.push({ name: '', quantity: 1, price: 0, laborCost: 0, spec: '' });
    this.setData({ items });
  },
  
  deleteRow(e) {
    const index = e.currentTarget.dataset.index;
    const items = this.data.items;
    if (items.length > 1) {
      items.splice(index, 1);
      this.setData({ items });
    }
  },

  submitUpdate() {
    wx.showLoading({ title: '生成中...' });
    wx.cloud.callFunction({
      name: 'repairFunctions',
      data: {
        action: 'generateList', // Reusing generate logic
        data: {
          type: 'repair',
          vehicle: this.data.vehicle,
          repairUnit: this.data.repairUnit,
          repairLocation: this.data.repairLocation,
          date: this.data.date,
          items: this.data.items,
          excelHeader: this.data.excelHeader
        }
      },
      success: (res) => {
        wx.hideLoading();
        if (res.result.success) {
           wx.cloud.downloadFile({
            fileID: res.result.fileID,
            success: (fileRes) => {
              const fs = wx.getFileSystemManager();
              const dst = `${wx.env.USER_DATA_PATH}/${res.result.fileName || '维修清单.pdf'}`;
              try {
                fs.saveFile({
                  tempFilePath: fileRes.tempFilePath,
                  filePath: dst,
                  success: () => wx.openDocument({ filePath: dst, showMenu: true }),
                  fail: () => wx.openDocument({ filePath: fileRes.tempFilePath, showMenu: true })
                });
              } catch (e) {
                wx.openDocument({ filePath: fileRes.tempFilePath, showMenu: true });
              }
            }
          });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        console.error(err);
      }
    });
  }
});
