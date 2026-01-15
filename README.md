# 微信维修管理助手

构型助手是一款基于微信小程序的团队协作工具，旨在让团队协作更轻松、高效。

## 简介

高效生成维修/保养清单与验收单，支持 PDF 导出、智能解析与图片嵌入，满足维修业务的标准化与留档需求。

## 功能模块

- 维修清单生成（模块一）  
  - 录入项目、数量、单位、单价、手工次数、手工单价、备注  
  - 一键导出标准 PDF 清单
- 验收单生成（模块二）  
  - 录入维修/验收日期与明细  
  - 导出标准验收单 PDF
- PDF 单据编辑（模块三）  
  - 导入 PDF/Excel 自动解析  
  - 支持字段修订与再导出
- 图片嵌入（模块四）  
  - 批量插入现场照片到验收单

## 关键特性

- PDF 表头与布局符合业务格式：列名、列宽、行高统一
- 数字显示规则：
  - 输入多少就显示多少（不强制两位小数）
  - 值为 0 的单元格留空
  - 合计采用紧凑格式并追加“元”
- 印章：仅在“维修清单”中显示，位置可按需微调
- 中文字体兼容：可选提供 SimHei/Song（simhei.ttf/simsun.ttf）

## 目录结构

```
xingang/
├── miniprogram/                  # 小程序端
│   ├── pages/
│   │   ├── index/                # 首页入口
│   │   ├── module1/              # 维修清单生成
│   │   ├── module2/              # 验收单生成
│   │   ├── module3/              # PDF单据编辑
│   │   └── module4/              # 图片嵌入
│   ├── app.js / app.json / app.wxss
│   └── ...
├── cloudfunctions/
│   └── repairFunctions/          # 核心云函数（PDF生成/清理等）
└── project.config.json           # 项目配置
```

核心文件参考：
- 云函数主入口与 PDF 生成逻辑：[index.js](file:///Users/macbookpro/Downloads/新建文件夹/xingang/cloudfunctions/repairFunctions/index.js)
- 维修清单页面：[module1.wxml](file:///Users/macbookpro/Downloads/新建文件夹/xingang/miniprogram/pages/module1/module1.wxml)
- 验收单页面：[module2.wxml](file:///Users/macbookpro/Downloads/新建文件夹/xingang/miniprogram/pages/module2/module2.wxml)
- 解析编辑页面：[module3.wxml](file:///Users/macbookpro/Downloads/新建文件夹/xingang/miniprogram/pages/module3/module3.wxml)

## 环境要求

- 微信开发者工具（最新稳定版）
- 开通微信云开发环境（数据库/云函数/存储）
- 可选：在云函数目录提供中文字体文件：
  - [simhei.ttf](file:///Users/macbookpro/Downloads/新建文件夹/xingang/cloudfunctions/repairFunctions/simhei.ttf)
  - [simsun.ttf](file:///Users/macbookpro/Downloads/新建文件夹/xingang/cloudfunctions/repairFunctions/simsun.ttf)

## 快速开始

1. 导入项目  
   - 打开微信开发者工具 → 导入 → 选择项目根目录
2. 开通云开发  
   - 点击“云开发” → 选择/创建环境
3. 部署云函数  
   - 右键 cloudfunctions/repairFunctions → 选择环境 → 上传并部署（云端安装依赖）
4. 运行与导出  
   - 进入模块一或模块二，填写信息后点击“导出 PDF”

## 使用说明（重点规则）

- 字段输入与显示
  - “单价”“手工单价”在 PDF 中按输入原样显示；输入为 0 时单元格留空
  - 合计采用紧凑格式（去除不必要的零），并在金额后追加“元”
- 布局与样式
  - 列宽：手工(次)更窄、手工费单价(元/次)更宽
  - 行高：统一内边距，确保视觉一致
  - 印章：维修清单中显示，位置可在云函数中数值调整

## 可选配置

- 中文字体  
  - 在 repairFunctions 目录放置 simhei.ttf/simsun.ttf，可提升中文渲染效果
- 智能解析（可选）  
  - 云函数中预留了智能解析接口（DeepSeek）；如需使用，请在云端安全地配置 API Key

## 常见问题

- 导出 PDF 表头或规则未生效  
  - 请确认已“上传并部署”最新云函数到云端
- PDF 中文显示异常  
  - 在云函数目录提供中文字体文件并重新部署
- 合计或数字显示格式不符合预期  
  - 规则见“使用说明（重点规则）”，如需个性化可调整云函数格式化逻辑

## 许可

本项目用于业务流程辅助与学习参考，许可与使用限制可根据实际需求补充。欢迎二次开发与定制。 
