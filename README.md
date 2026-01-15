# 微信维修管理助手（WeChat Repair App）

微信维修管理助手是一款基于微信小程序和云开发的维修业务辅助工具，支持快速录入维修/保养项目、生成标准化 PDF 清单和验收单，并提供 PDF 单据解析与图片嵌入能力，适合车队、维修单位等场景使用。

---

## 功能模块概览

项目当前包含 5 个主要功能模块（对应首页菜单）：

1. **模块一：维修清单生成（/pages/module1）**
   - 录入维修/保养项目（项目、数量、单位、单价、手工次数、手工单价、备注等）
   - 自动计算每行小计与整体合计
   - 一键生成 **维修清单 / 保养清单 PDF**
   - PDF 表头与列宽已针对维修场景优化（含“手工(次)”“手工费单价(元/次)”等）

2. **模块二：验收单生成（/pages/module2）**
   - 录入维修单位、维修地点、维修日期、验收日期等基本信息
   - 录入验收项目及金额
   - 生成 **维修验收单 / 保养验收单 PDF**
   - 支持在 PDF 中预留验收人、审核人签字位置

3. **模块三：PDF 单据解析与编辑（/pages/module3）**
   - 导入已有 PDF 或 Excel 维修单
   - 后端通过 `pdf-parse` 与可选的 DeepSeek 接口进行智能解析
   - 将解析结果转换为可编辑的表格，用户可直接修改后重新导出

4. **模块四：验收单图片嵌入（/pages/module4）**
   - 导入验收单 PDF
   - 上传/管理现场照片
   - 在生成的 PDF 中按规则批量嵌入图片（例如作为附页或拼版）

5. **模块五：扩展功能（/pages/module5）**
   - 预留给后续扩展（如绩效统计、费用分析等）
   - 具体功能以代码为准，可根据业务自行扩展

---

## 技术栈

- 前端：微信小程序原生开发（WXML、WXSS、JavaScript、JSON）
- 后端：微信云开发 CloudBase
  - 云函数：主要为 `repairFunctions`，负责 PDF 生成、文件上传、自动清理等
  - 云数据库：存储上传文件信息、临时数据等
  - 云存储：保存生成的 PDF 文件和图片文件
  - 依赖库：`pdfmake`、`pdf-parse`、`node-xlsx`、`axios`、`dayjs` 等

---

## 目录结构（简要）

```bash
project/
├── cloudfunctions/                 # 云函数目录
│   ├── repairFunctions/            # 核心业务云函数
│   │   ├── index.js                # 维修/验收 PDF 生成、解析等主逻辑
│   │   ├── simhei.ttf              # 黑体字体（可选，用于中文 PDF）
│   │   ├── simsun.ttf              # 宋体字体（可选，用于中文 PDF）
│   │   └── stamp.png               # 维修清单印章图片（可选）
│   └── ...                         # 其他云函数（如有）
├── miniprogram/                    # 小程序端代码
│   ├── pages/
│   │   ├── index/                  # 首页
│   │   ├── module1/                # 模块一：维修清单生成
│   │   ├── module2/                # 模块二：验收单生成
│   │   ├── module3/                # 模块三：PDF 单据解析编辑
│   │   ├── module4/                # 模块四：图片嵌入
│   │   └── module5/                # 模块五：扩展功能
│   ├── app.js                      # 全局逻辑
│   ├── app.json                    # 全局配置
│   └── app.wxss                    # 全局样式
├── project.config.json             # 微信开发者工具项目配置
└── README.md                       # 项目说明文档（本文件）
```

---

## 核心流程说明

### 1. 维修清单 / 验收单生成

1. 在小程序前端录入：
   - 维修车辆、维修单位、维修地点、日期等信息
   - 每一行维修项目：项目名称、数量、单位、单价、手工次数、手工单价、备注等
2. 前端将数据提交给云函数 `repairFunctions`：
   - `action: 'generateList'` 用于生成维修/保养清单
   - `action: 'generateAcceptance'` 用于生成维修/保养验收单
3. 云函数使用 `pdfmake` 按固定模板生成 PDF：
   - 表头包括“序号、项目、数量、单位、配件单价(元)、手工(次)、手工费单价(元/次)、备注”等
   - 自动补齐至少 15 行，保证版面统一
   - 支持在“维修清单”中叠加 `stamp.png` 印章
4. 生成的 PDF 上传到云存储：
   - 返回 `fileID` 和生成的文件名给前端
   - 前端使用 `wx.openDocument` 等能力预览或转发

### 2. PDF 解析与编辑（模块三）

1. 用户选择 PDF/Excel 文件上传
2. 云函数使用 `pdf-parse`（可选 DeepSeek）解析文本
3. 将解析出的项目列表返回给前端，显示为可编辑表格
4. 用户调整后，可再次调用生成接口导出新的 PDF

---

## 部署与运行

### 1. 环境准备

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 使用微信扫码登录

### 2. 导入项目

1. 打开微信开发者工具，选择“导入项目”
2. 目录选择本项目根目录（包含 `project.config.json` 的目录）
3. 填写你自己的小程序 `AppID`

### 3. 开通云开发并配置

1. 在工具栏点击“云开发”按钮，创建或选择一个环境
2. 在项目配置中确认：
   - `miniprogramRoot` 为 `miniprogram/`
   - `cloudfunctionRoot` 为 `cloudfunctions/`
3. 在云函数列表中找到 `repairFunctions`：
   - 右键 `repairFunctions` 目录，选择环境
   - 点击“上传并部署：云端安装依赖”
4. 云数据库与云存储：
   - 按需要创建用于记录文件信息的集合（如 `app_files`）
   - 确保云存储有足够空间存放生成的 PDF 与图片

### 4. PDF 字体与印章配置（可选）

1. 若生成的 PDF 出现中文方块或乱码：
   - 在 `cloudfunctions/repairFunctions/` 下放置 `simhei.ttf` 或 `simsun.ttf`
   - 云函数会在存在 SimSun/SimHei 时自动切换中文字体
2. 若需要在维修清单上显示印章：
   - 在同目录下放置 `stamp.png`
   - 云函数会在标题中包含“维修清单”时自动叠加印章

### 5. DeepSeek 配置（可选）

若需要使用 DeepSeek 辅助解析复杂 PDF 文本，可在云函数环境变量中配置：

- `DEEPSEEK_API_KEY`：你的 DeepSeek API 密钥

未配置该变量时，相关功能会自动跳过，不影响其它业务。

---

## 常见问题（FAQ）

1. 修改了 PDF 模板但导出结果没变化？
   - 检查是否在微信开发者工具中对 `repairFunctions` 执行了“上传并部署：云端安装依赖”
   - 部署后重新生成 PDF 即可生效
2. 导出的金额格式不符合预期？
   - 明细行可配置为“按输入原样显示”或“格式化为两位小数”
   - 合计行当前使用紧凑显示（去掉多余 0），并追加“元”字，如：`合计：150元`
3. PDF 中中文不显示或显示为方块？
   - 请确认 `repairFunctions` 目录下存在 `simhei.ttf` 或 `simsun.ttf`
   - 部署云函数后重新生成 PDF
4. 如何调整印章位置或表格列宽？
   - 在 `cloudfunctions/repairFunctions/index.js` 中搜索：
     - `stamp.png` 可调整 `absolutePosition` 的 `x` / `y`
     - `widths: [...]` 可调整表格各列宽度

---

## 后续规划

- 扩展模块五能力：如维修记录统计、人员绩效统计、费用分析报表等
- 增强 PDF 模板配置能力（更多可视化布局、Logo、抬头自定义）
- 增加导出 Excel 报表功能，便于与财务系统对接

如需根据自己的业务进行二次开发，可在现有模块基础之上新增页面和云函数，复用 `repairFunctions` 中的 PDF 生成逻辑。
