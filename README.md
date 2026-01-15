# 微信维修管理助手（WeChat Repair App）

微信维修管理助手是一款基于**微信小程序 + 云开发**的工具，主要用于：

- 快速录入维修 / 保养项目
- 一键生成标准化的 **维修清单 PDF** 和 **验收单 PDF**
- 从已有 PDF / Excel 中解析维修明细并再次编辑
- 在验收单 PDF 中批量嵌入现场图片

适用于车队管理、维修单位、设备维保等需要留痕和对账的场景。

---

## 功能模块

首页一共 5 个入口，对应 5 个模块：

1. **模块一 · 维修清单生成**（`/pages/module1`）
   - 录入：项目、数量、单位、单价、手工次数、手工单价、备注等
   - 自动计算每行小计与总计
   - 区分“维修清单 / 保养清单”
   - 生成版式固定的 PDF（含“手工(次)”“手工费单价(元/次)”等列）

2. **模块二 · 验收单生成**（`/pages/module2`）
   - 录入：维修单位、维修地点、维修日期、验收日期等
   - 录入验收项目金额
   - 生成“维修验收单 / 保养验收单” PDF
   - PDF 底部预留验收人、审核人签名区域

3. **模块三 · PDF 单据解析编辑**（`/pages/module3`）
   - 选择现有 PDF / Excel 维修单上传
   - 云函数解析出项目列表（使用 `pdf-parse`，可选接入 DeepSeek）
   - 前端以表格展示，可手动修正后再导出新的 PDF

4. **模块四 · 验收单图片嵌入**（`/pages/module4`）
   - 导入验收单 PDF
   - 上传 / 管理现场照片
   - 将图片按规则嵌入 PDF（可作为附页或拼版）

5. **模块五 · 预留扩展**（`/pages/module5`）
   - 用于后续增加：统计报表、绩效分析等功能

---

## 技术栈

- 前端：微信小程序原生
  - WXML / WXSS / JavaScript / JSON
  - 使用小程序自带路由与数据绑定

- 后端：微信云开发 CloudBase
  - 云函数：`cloudfunctions/repairFunctions`
    - 生成维修清单 / 验收单 PDF
    - 解析 PDF / Excel
    - 清理云端临时文件
  - 云数据库：记录生成的文件信息（如集合 `app_files`）
  - 云存储：保存生成的 PDF 和图片

- 主要第三方依赖（云函数中）：
  - `pdfmake`：生成 PDF
  - `pdf-parse`：解析 PDF 文本
  - `node-xlsx`：解析 Excel（可选）
  - `axios`：调用 DeepSeek 接口（可选）
  - `dayjs`：日期处理

---

## 目录结构

```bash
project/
├── cloudfunctions/
│   ├── repairFunctions/        # 核心业务云函数
│   │   ├── index.js            # 维修 / 验收 / 解析等主逻辑
│   │   ├── simhei.ttf          # 中文字体（可选）
│   │   ├── simsun.ttf          # 中文字体（可选）
│   │   └── stamp.png           # 维修清单印章（可选）
│   └── ...                     # 其他云函数（如有）
├── miniprogram/
│   ├── pages/
│   │   ├── index/              # 首页菜单
│   │   ├── module1/            # 模块一：维修清单生成
│   │   ├── module2/            # 模块二：验收单生成
│   │   ├── module3/            # 模块三：PDF 解析编辑
│   │   ├── module4/            # 模块四：图片嵌入
│   │   └── module5/            # 模块五：扩展功能
│   ├── app.js                  # 全局逻辑
│   ├── app.json                # 全局配置
│   └── app.wxss                # 全局样式
├── project.config.json         # 微信开发者工具项目配置
└── README.md                   # 本说明文件
```

---

## 快速开始

### 1. 准备环境

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 使用微信扫码登录

### 2. 导入项目

1. 打开微信开发者工具，选择“导入项目”
2. 目录选择本项目根目录（包含 `project.config.json` 的目录）
3. 使用你自己的小程序 `AppID`

### 3. 开通云开发

1. 在顶部工具栏点击“云开发”，创建或选择一个环境
2. 确认 `project.config.json` 中：
   - `"miniprogramRoot": "miniprogram/"`
   - `"cloudfunctionRoot": "cloudfunctions/"`

### 4. 部署云函数 `repairFunctions`

1. 在微信开发者工具的“云函数”面板中找到 `repairFunctions`
2. 右键 `repairFunctions` 目录，选择：
   - “上传并部署：云端安装依赖”
3. 部署成功后，即可在小程序内生成和解析 PDF

### 5. 运行与导出 PDF

1. 在模拟器中进入：
   - 模块一：录入维修项目，点击“导出 PDF”生成维修/保养清单
   - 模块二：录入验收信息，点击按钮生成验收单
2. 生成成功后，小程序会返回云文件 `fileID`，并调用 `wx.openDocument` 进行预览

---

## 字体与印章配置（可选）

为避免 PDF 出现中文方块或乱码，建议：

- 在 `cloudfunctions/repairFunctions/` 下放置：
  - `simsun.ttf` 或 `simhei.ttf`
- 云函数会自动选择可用的中文字体

若需要在“维修清单”右侧显示印章：

- 在同目录下放置 `stamp.png`
- 云函数会在标题包含“维修清单”时自动叠加该图片

---

## DeepSeek 接入说明（可选）

如果需要使用 DeepSeek 辅助解析复杂的 PDF 文本：

1. 在云开发控制台为 `repairFunctions` 设置环境变量：
   - `DEEPSEEK_API_KEY`：你的 DeepSeek 密钥
2. 云函数会自动检测该变量并启用智能解析；
3. 若未配置或密钥为空，则相关能力会被跳过，不影响其他功能。

---

## 常见问题

1. **改了云函数代码，导出的 PDF 样式没变？**
   - 确认是否重新执行了“上传并部署：云端安装依赖”
   - 部署成功后，重新在小程序里导出一次

2. **金额显示格式不对？**
   - 单价、手工单价可以配置为“按输入原样显示”或“格式化两位小数”
   - 合计金额当前采用紧凑格式，并在末尾追加“元”（例如 `合计：150元`）

3. **PDF 里中文显示为小方块？**
   - 确认 `repairFunctions` 目录下是否放置了 `simhei.ttf` 或 `simsun.ttf`
   - 部署云函数后重新导出 PDF

4. **如何微调表格列宽或印章位置？**
   - 在 `cloudfunctions/repairFunctions/index.js` 中：
     - 搜索 `widths: [...]` 调整各列宽度
     - 搜索 `stamp.png` 修改 `absolutePosition` 中的 `x` / `y`

---

## 二次开发建议

- 新增业务模块时，建议：
  - 在 `miniprogram/pages` 下增加对应页面
  - 在现有 `repairFunctions` 云函数中复用 PDF 生成/解析工具函数
- 如需对接企业内部系统，可增加：
  - 导出 Excel 报表
  - 将 PDF / 金额数据同步到后端服务

本 README 只保留与“维修管理”相关的内容，旧版“构型助手”描述已全部移除，方便后续维护。***
