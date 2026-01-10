const app = getApp();

Page({
  data: {
    parsedData: null,
    vehicle: '',
    date: '',
    items: [],
    description: '',
    images: [],
    repairUnit: '',
    repairLocation: '',
    excelHeader: []
  },

  choosePdf() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['pdf', 'xls', 'xlsx'],
      success: (res) => {
        const file = res.tempFiles[0];
        wx.showLoading({ title: '解析中...' });
        
        wx.cloud.uploadFile({
          cloudPath: `temp/${Date.now()}.${file.name.split('.').pop()}`,
          filePath: file.path,
          success: (uploadRes) => {
            wx.cloud.callFunction({
              name: 'repairFunctions',
              data: {
                action: 'parsePDF',
                data: { fileID: uploadRes.fileID }
              },
              success: (funcRes) => {
                wx.hideLoading();
                const { vehicle, items, excelHeader, repairUnit, repairLocation, date } = funcRes.result.data;
                this.setData({
                  parsedData: true,
                  vehicle: vehicle || '未识别',
                  items: items,
                  date: date || new Date().toLocaleDateString(),
                  repairUnit: repairUnit || '',
                  repairLocation: repairLocation || '',
                  excelHeader: excelHeader || []
                });
              },
              fail: () => {
                wx.hideLoading();
                wx.showToast({ title: '解析失败', icon: 'none' });
              }
            });
          }
        });
      }
    });
  },

  inputDesc(e) {
    this.setData({ description: e.detail.value });
  },

  chooseImages() {
    wx.chooseImage({
      count: 9, // Increase single selection limit
      success: (res) => {
        this.setData({
          images: this.data.images.concat(res.tempFilePaths)
        });
      }
    });
  },
  
  deleteImage(e) {
    const index = e.currentTarget.dataset.index;
    const images = this.data.images.slice();
    if (index >= 0 && index < images.length) {
      images.splice(index, 1);
      this.setData({ images });
    }
  },

  submitEmbed() {
    if (this.data.images.length === 0) {
      return wx.showToast({ title: '请至少上传一张图片', icon: 'none' });
    }
    
    wx.showLoading({ title: '生成中...' });
    
    // Parallel Upload
    const uploadPromises = this.data.images.map((filePath, index) => {
        return new Promise((resolve, reject) => {
             const cloudPath = `temp/img-${Date.now()}-${index}.jpg`;
             wx.cloud.uploadFile({
                cloudPath: cloudPath,
                filePath: filePath,
                success: (res) => resolve(res.fileID),
                fail: () => resolve(null) // Skip failed
             });
        });
    });

    Promise.all(uploadPromises).then(results => {
        const imageFileIDs = results.filter(id => id !== null);
        if (imageFileIDs.length === 0) {
            wx.hideLoading();
            return wx.showToast({ title: '图片上传失败', icon: 'none' });
        }
        
        wx.cloud.callFunction({
            name: 'repairFunctions',
            data: {
              action: 'embedImages',
              data: {
                vehicle: this.data.vehicle,
                date: this.data.date,
                items: this.data.items,
                description: this.data.description,
                repairUnit: this.data.repairUnit,
                repairLocation: this.data.repairLocation,
                imageFileIDs: imageFileIDs,
                excelHeader: this.data.excelHeader
              }
            },
            success: (res) => {
              wx.hideLoading();
              if (res.result.success) {
                wx.cloud.downloadFile({
                  fileID: res.result.fileID,
                  success: (f) => {
                    const fs = wx.getFileSystemManager();
                    const dst = `${wx.env.USER_DATA_PATH}/${res.result.fileName || '维修验收单.pdf'}`;
                    try {
                      fs.saveFile({
                        tempFilePath: f.tempFilePath,
                        filePath: dst,
                        success: () => wx.openDocument({ filePath: dst, showMenu: true }),
                        fail: () => wx.openDocument({ filePath: f.tempFilePath, showMenu: true })
                      });
                    } catch (e) {
                      wx.openDocument({ filePath: f.tempFilePath, showMenu: true });
                    }
                  }
                });
              } else {
                wx.showToast({ title: '生成失败', icon: 'none' });
              }
            },
            fail: () => {
              wx.hideLoading();
              wx.showToast({ title: '请求失败', icon: 'none' });
            }
        });
    });
  }
});
