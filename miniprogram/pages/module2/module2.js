const app = getApp();

Page({
  data: {
    type: 'repair',
    vehicle: '',
    repairUnit: '九江星昂汽车服务有限公司',
    repairLocation: '九江市柴桑区美的国宾府2栋',
    repairDate: '',
    acceptanceDate: '',
    items: [],
    totalAmount: 0,
    unitOptions: ['个', '套', '桶', '组', '条', '副', '瓶', '次', '自定义']
  },

  onLoad() {
    this.addRow();
    // Set default dates
    const today = new Date().toISOString().split('T')[0];
    this.setData({ repairDate: today, acceptanceDate: today });
  },

  switchType(e) {
    this.setData({ type: e.currentTarget.dataset.type });
  },

  inputVehicle(e) { this.setData({ vehicle: e.detail.value }); },
  inputRepairUnit(e) { this.setData({ repairUnit: e.detail.value }); },
  inputRepairLocation(e) { this.setData({ repairLocation: e.detail.value }); },
  bindRepairDateChange(e) { this.setData({ repairDate: e.detail.value }); },
  bindAcceptanceDateChange(e) { this.setData({ acceptanceDate: e.detail.value }); },

  addRow() {
    const items = this.data.items;
    items.push({ name: '', quantity: 1, unit: '个', price: '', laborCost: '', spec: '', subtotal: 0, customUnitEnabled: false, customUnit: '' });
    this.setData({ items });
    this.calculateTotal();
  },

  deleteRow(e) {
    const index = e.currentTarget.dataset.index;
    const items = this.data.items;
    if (items.length > 1) {
      items.splice(index, 1);
      this.setData({ items });
      this.calculateTotal();
    }
  },

  onUnitChange(e) {
    const index = e.currentTarget.dataset.index;
    const valueIndex = e.detail.value;
    const items = this.data.items;
    const selected = this.data.unitOptions[valueIndex];
    if (selected === '自定义') {
      items[index].customUnitEnabled = true;
      items[index].unit = '';
    } else {
      items[index].customUnitEnabled = false;
      items[index].unit = selected;
    }
    this.setData({ items });
  },
 
  onUnitInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = e.detail.value;
    const items = this.data.items;
    items[index].customUnit = value;
    items[index].unit = value;
    this.setData({ items });
  },

  inputItem(e) {
    const index = e.currentTarget.dataset.index;
    const field = e.currentTarget.dataset.field;
    const items = this.data.items;
    items[index][field] = e.detail.value;
    
    const qty = parseFloat(items[index].quantity) || 0;
    const price = parseFloat(items[index].price) || 0;
    const labor = parseFloat(items[index].laborCost) || 0;
    items[index].subtotal = (qty * price + labor).toFixed(2);
    
    this.setData({ items });
    this.calculateTotal();
  },

  calculateTotal() {
    let total = 0;
    this.data.items.forEach(item => total += parseFloat(item.subtotal) || 0);
    this.setData({ totalAmount: total.toFixed(2) });
  },

  exportList() {
    if (!this.data.vehicle) return wx.showToast({ title: '请输入车辆', icon: 'none' });

    wx.showLoading({ title: '生成清单...' });
    wx.cloud.callFunction({
      name: 'repairFunctions',
      data: {
        action: 'generateList',
        data: {
          type: this.data.type,
          vehicle: this.data.vehicle,
          repairUnit: this.data.repairUnit,
          repairLocation: this.data.repairLocation,
          date: this.data.repairDate, // Use repair date for list
          items: this.data.items
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
        } else {
          wx.showModal({ title: '导出失败', content: res.result.error || '未知错误', showCancel: false });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        console.error(err);
        let errMsg = '调用失败';
        if (err.errCode === -504003) {
          errMsg = '生成超时。请在云开发控制台->云函数->repairFunctions->配置中，将超时时间设置为60秒。';
        } else {
            errMsg = '错误: ' + (err.message || JSON.stringify(err));
        }
        wx.showModal({ title: '调用失败', content: errMsg, showCancel: false });
      }
    });
  },

  exportAcceptance() {
    if (!this.data.vehicle) return wx.showToast({ title: '请输入车辆', icon: 'none' });
    
    wx.showLoading({ title: '生成验收单...' });
    wx.cloud.callFunction({
      name: 'repairFunctions',
      data: {
        action: 'generateAcceptance',
        data: {
          type: this.data.type,
          vehicle: this.data.vehicle,
          repairUnit: this.data.repairUnit,
          repairLocation: this.data.repairLocation,
          repairDate: this.data.repairDate,
          acceptanceDate: this.data.acceptanceDate,
          items: this.data.items
        }
      },
      success: (res) => {
        wx.hideLoading();
        if (res.result.success) {
          wx.cloud.downloadFile({
            fileID: res.result.fileID,
            success: (fileRes) => {
              const fs = wx.getFileSystemManager();
              const dst = `${wx.env.USER_DATA_PATH}/${res.result.fileName || '维修验收单.pdf'}`;
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
        } else {
          // Show specific error from backend
          wx.showModal({
            title: '导出失败',
            content: res.result.error || '未知错误',
            showCancel: false
          });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        console.error(err);
        let errMsg = '调用失败';
        if (err.errCode === -504003) {
          errMsg = '生成超时。请在云开发控制台->云函数->repairFunctions->配置中，将超时时间设置为60秒。';
        } else {
            errMsg = '错误: ' + (err.message || JSON.stringify(err));
        }
        wx.showModal({
          title: '调用失败',
          content: errMsg,
          showCancel: false
        });
      }
    });
  }
});
