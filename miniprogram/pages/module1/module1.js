const app = getApp();

Page({
  data: {
    type: 'repair',
    templateVersion: 'v1',
    vehicle: '',
    repairUnit: '九江星昂汽车服务有限公司',
    repairLocation: '九江市柴桑区美的国宾府2栋',
    date: '',
    items: [],
    totalAmount: 0,
    unitOptions: ['个', '套', '桶', '组', '条', '副', '瓶', '次', '自定义']
  },

  onLoad() {
    // Initialize with 1 row
    this.addRow();
    // Set default date
    const today = new Date().toISOString().split('T')[0];
    this.setData({ date: today });
  },

  switchTemplate() {
    const currentVersion = this.data.templateVersion;
    const nextVersion = currentVersion === 'v1' ? 'v2' : 'v1';
    const items = this.data.items;

    // Data migration logic
    items.forEach(item => {
      if (currentVersion === 'v1' && nextVersion === 'v2') {
        // V1 -> V2: Migrate calculated labor to laborCost field if empty
        const hc = parseFloat(item.handCount) || 0;
        const up = parseFloat(item.laborUnitPrice) || 0;
        const v1Labor = (hc > 0 && up > 0) ? hc * up : 0;
        const v2Labor = parseFloat(item.laborCost) || 0;
        
        if (v2Labor === 0 && v1Labor > 0) {
          item.laborCost = v1Labor.toFixed(2);
        }
      } else if (currentVersion === 'v2' && nextVersion === 'v1') {
        // V2 -> V1: Migrate laborCost to handCount/Price if empty
        const v2Labor = parseFloat(item.laborCost) || 0;
        const hc = parseFloat(item.handCount) || 0;
        const up = parseFloat(item.laborUnitPrice) || 0;
        const v1Labor = (hc > 0 && up > 0) ? hc * up : 0;

        if (v1Labor === 0 && v2Labor > 0) {
          item.handCount = 1;
          item.laborUnitPrice = v2Labor.toFixed(2);
        }
      }
    });

    this.setData({ 
      templateVersion: nextVersion,
      items: items
    });
    this.recalculateAll();
  },

  recalculateAll() {
    const items = this.data.items;
    const isV2 = this.data.templateVersion === 'v2';
    let total = 0;
    items.forEach(item => {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.price) || 0;
      let labor = 0;
      if (isV2) {
         labor = parseFloat(item.laborCost) || 0;
      } else {
         const hc = parseFloat(item.handCount) || 0;
         const up = parseFloat(item.laborUnitPrice) || 0;
         labor = (hc > 0 && up > 0) ? hc * up : 0;
      }
      item.subtotal = (qty * price + labor).toFixed(2);
      total += parseFloat(item.subtotal);
    });
    this.setData({ items, totalAmount: total.toFixed(2) });
  },

  switchType(e) {
    this.setData({ type: e.currentTarget.dataset.type });
    wx.setNavigationBarTitle({
      title: e.currentTarget.dataset.type === 'repair' ? '维修清单' : '保养清单'
    });
  },

  inputVehicle(e) { this.setData({ vehicle: e.detail.value }); },
  inputRepairUnit(e) { this.setData({ repairUnit: e.detail.value }); },
  inputRepairLocation(e) { this.setData({ repairLocation: e.detail.value }); },
  bindDateChange(e) { this.setData({ date: e.detail.value }); },


  addRow() {
    const items = this.data.items;
    items.push({
      name: '',
      quantity: 1,
      unit: '个',
      price: '',
      handCount: '',
      laborUnitPrice: '',
      laborCost: '',
      spec: '',
      subtotal: '0.00',
      customUnitEnabled: false,
      customUnit: ''
    });
    this.setData({ items });
    this.recalculateAll();
  },

  deleteRow(e) {
    const index = e.currentTarget.dataset.index;
    const items = this.data.items;
    if (items.length > 1) {
      items.splice(index, 1);
      this.setData({ items });
      this.recalculateAll();
    } else {
      wx.showToast({ title: '至少保留一行', icon: 'none' });
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
    const value = e.detail.value;
    const items = this.data.items;
    
    items[index][field] = value;
    
    // Update local data first
    this.setData({ items });
    
    // Recalculate totals based on template version
    this.recalculateAll();
  },

  calculateTotal() {
    const items = this.data.items;
    let total = 0;
    items.forEach(item => {
      total += parseFloat(item.subtotal) || 0;
    });
    this.setData({ totalAmount: total.toFixed(2) });
  },

  submitForm() {
    if (!this.data.vehicle) {
      return wx.showToast({ title: '请输入车辆信息', icon: 'none' });
    }

    wx.showLoading({ title: '生成中...' });

    wx.cloud.callFunction({
      name: 'repairFunctions',
      data: {
        action: 'generateList',
        data: {
          type: this.data.type,
          vehicle: this.data.vehicle,
          repairUnit: this.data.repairUnit,
          repairLocation: this.data.repairLocation,
          date: '',
          templateVersion: this.data.templateVersion,
          items: this.data.items
        }
      },
      success: (res) => {
        wx.hideLoading();
        if (res.result.success) {
          wx.showToast({ title: '生成成功', icon: 'success' });
          // Download and Open
          wx.cloud.downloadFile({
            fileID: res.result.fileID,
            success: (fileRes) => {
              const fs = wx.getFileSystemManager();
              const dst = `${wx.env.USER_DATA_PATH}/${res.result.fileName || '清单.pdf'}`;
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
          wx.showToast({ title: '生成失败: ' + res.result.error, icon: 'none' });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        console.error(err);
        let errMsg = '调用失败';
        if (err.errCode === -504003) {
          errMsg = '生成超时。请在云开发控制台->云函数->repairFunctions->配置中，将超时时间设置为60秒。';
        } else if (err.errMsg && err.errMsg.includes('timeout')) {
            errMsg = '请求超时。请检查网络或增加云函数超时时间。';
        } else {
            errMsg = '错误: ' + (err.message || JSON.stringify(err));
        }

        wx.showModal({
          title: '导出失败',
          content: errMsg,
          showCancel: false
        });
      }
    });
  }
});
