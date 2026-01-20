const cloud = require('wx-server-sdk');
const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');
const axios = require('axios');

// --- DEEPSEEK CONFIG ---
// ⚠️ 请在此处填入您的 DeepSeek API Key
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

function extractJson(content) {
    if (!content || typeof content !== 'string') return null;
    let s = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    try {
        return JSON.parse(s);
    } catch (_) {}
    const tryBalanced = (str, open, close) => {
        const start = str.indexOf(open);
        if (start === -1) return null;
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let i = start; i < str.length; i++) {
            const ch = str[i];
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if (ch === '"' || ch === "'") {
                if (!inString) {
                    inString = ch;
                } else if (inString === ch) {
                    inString = false;
                }
            }
            if (inString) continue;
            if (ch === open) depth++;
            else if (ch === close) {
                depth--;
                if (depth === 0) {
                    const candidate = str.slice(start, i + 1);
                    try {
                        return JSON.parse(candidate);
                    } catch (_) {
                        return null;
                    }
                }
            }
        }
        return null;
    };
    return tryBalanced(s, '{', '}') || tryBalanced(s, '[', ']');
}

function parseTextFallback(text) {
    const normalize = (s) => {
        let t = String(s || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
        t = t.replace(/(\d)([^\d])/g, '$1 $2').replace(/([^\d])(\d)/g, '$1 $2');
        return t.replace(/\s+/g, ' ').trim();
    };
    const raw = normalize(text);
    const tokens = raw.split(' ').filter(Boolean);
    let vehicle = '';
    let repairUnit = '';
    let repairLocation = '';
    let date = '';
    for (let i = 0; i < tokens.length; i++) {
        const line = tokens[i];
        if (/(?:维修|承修|客户)单位[:：]?\s*(\S+)/.test(line)) {
            const m = line.match(/(?:维修|承修|客户)单位[:：]?\s*(\S+)/);
            if (m) repairUnit = m[1];
        }
        if (/(?:维修|承修|服务)地点[:：]?\s*(\S+)/.test(line)) {
            const m = line.match(/(?:维修|承修|服务)地点[:：]?\s*(\S+)/);
            if (m) repairLocation = m[1];
        }
        if (/日期/.test(line)) {
            const m = (line.match(/(\d{4}[-./]\d{1,2}[-./]\d{1,2})/) || tokens[i+1]?.match(/(\d{4}[-./]\d{1,2}[-./]\d{1,2})/));
            if (m && m[1]) date = m[1].replace(/[./]/g, '-');
        }
        if (/(?:维修)?车辆[:：]?\s*(\S+)/.test(line)) {
            const m = line.match(/(?:维修)?车辆[:：]?\s*(\S+)/);
            if (m) vehicle = m[1];
        } else if (/(?:维修)?车辆/.test(line) && i + 1 < tokens.length) {
            const nextLine = tokens[i+1];
            if (!/序号|日期/.test(nextLine)) {
                vehicle = nextLine.split(/\s+/)[0];
            }
        }
    }
    const units = ['个','组','根','套','台','件','支','条','盒','只','瓶','米','升','块','板','双','把','张','片','袋'];
    const isNum = (s) => {
        if (!s) return false;
        const n = parseFloat(s);
        return !isNaN(n) && isFinite(n);
    };
    const items = [];
    let cur = { seq:'', name:[], qty:'', unit:'', price:'', labor:'', spec:[] };
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (!t || /合计|Total/.test(t) || /维修项目/.test(t) || /序号/.test(t)) continue;
        if (isNum(t) && (!cur.name.length || (cur.qty && cur.unit && cur.price))) {
            if (cur.name.length) {
                items.push({
                    name: cur.name.join('') || '未命名',
                    quantity: String(cur.qty || ''),
                    unit: String(cur.unit || ''),
                    price: String(cur.price || ''),
                    laborCost: String(cur.labor || ''),
                    spec: cur.spec.join(' ')
                });
            }
            cur = { seq:t, name:[], qty:'', unit:'', price:'', labor:'', spec:[] };
            continue;
        }
        if (!cur.name.length && !isNum(t) && !units.includes(t)) {
            cur.name.push(t);
            continue;
        }
        if (!cur.qty && isNum(t)) { cur.qty = t; continue; }
        if (!cur.unit && units.includes(t)) { cur.unit = t; continue; }
        if (!cur.price && isNum(t)) { 
            const val = t;
            if (/^\d{5,}$/.test(val)) {
                const mid = Math.max(1, Math.floor(val.length/2));
                cur.price = val.slice(0, mid);
                cur.spec.push(val.slice(mid));
            } else {
                cur.price = val;
            }
            continue; 
        }
        if (!cur.labor && isNum(t)) { cur.labor = t; continue; }
        cur.spec.push(t);
    }
    if (cur.name.length) {
        items.push({
            name: cur.name.join('') || '未命名',
            quantity: String(cur.qty || ''),
            unit: String(cur.unit || ''),
            price: String(cur.price || ''),
            laborCost: String(cur.labor || ''),
            spec: cur.spec.join(' ')
        });
    }
    for (let k = 0; k < items.length; k++) {
        if (/工时/.test(items[k].name)) {
            items[k].laborCost = '0';
        }
    }
    if (!date) {
        const m = raw.match(/(\d{4}[-./年]\d{1,2}[-./月]\d{1,2}[日]?)/);
        if (m) date = m[1].replace(/[./年月]/g, '-').replace(/日/g, '');
    }
    return { vehicle, repairUnit, repairLocation, date, items };
}

function toNum(v) {
    const n = parseFloat(String(v || '').replace(/[^\d.]/g, ''));
    return isNaN(n) ? 0 : n;
}

function parseTotalFromText(text) {
    const m = String(text || '').match(/合计[:：]?\s*([0-9]+(?:\.[0-9]+)?)/);
    return m ? parseFloat(m[1]) : 0;
}

function reconcileTotals(items, rawText) {
    const total = parseTotalFromText(rawText);
    const partsSum = items.reduce((s, it) => s + toNum(it.price) * (toNum(it.quantity) || 1), 0);
    const laborSum = items.reduce((s, it) => s + toNum(it.laborCost), 0);
    const combined = partsSum + laborSum;
    const eps = 0.5;
    const debug = { totalFromText: total, sumParts: partsSum, sumLabor: laborSum, sumCombined: combined, adjusted: false };
    if (total > 0 && Math.abs(combined - total) > eps) {
        const half = Math.floor(items.length / 2);
        let newItems = items.map((it, idx) => {
            const reset = idx >= half || /工时/.test(String(it.name || ''));
            return Object.assign({}, it, { laborCost: reset ? '0' : it.laborCost });
        });
        const newLabor = newItems.reduce((s, it) => s + toNum(it.laborCost), 0);
        const newCombined = partsSum + newLabor;
        if (Math.abs(newCombined - total) <= eps) {
            debug.adjusted = true;
            return { items: newItems, debug };
        }
    }
    return { items, debug };
}

async function callDeepSeek(text) {
    if (!text || text.length < 10) return null;
    if (!DEEPSEEK_API_KEY) {
        console.warn('DeepSeek API Key not set.');
        return null;
    }

    const prompt = `
    你是维修单据解析器。根据提供文本提取如下字段并只输出合法JSON：
    vehicle, repairUnit, repairLocation, date(YYYY-MM-DD，可能在维修地点下方且无标签), items[].items包含：name, quantity, unit, price, laborCost, spec。
    只输出JSON，无任何多余文字或代码块。
    文本：
    ${text.substring(0, 2000)}
    `;

    try {
        const payload = {
            model: "deepseek-chat",
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: prompt }
            ],
            stream: false,
            temperature: 0,
            response_format: { type: "json_object" }
        };
        let response;
        const tryOnce = async () => axios.post(DEEPSEEK_API_URL, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            timeout: 45000
        });
        try {
            response = await tryOnce();
        } catch (e1) {
            response = await tryOnce();
        }

        const content = response?.data?.choices?.[0]?.message?.content || '';
        const parsed = extractJson(content);
        return { json: parsed || null, raw: content || '' };
    } catch (error) {
        let errMsg = '';
        if (error.response) {
            errMsg = `status=${error.response.status} body=${JSON.stringify(error.response.data || {})}`;
            console.error('DeepSeek API Error:', errMsg);
        } else {
            errMsg = error.message;
            console.error('DeepSeek API Error:', errMsg);
        }
        return { json: null, raw: '', error: errMsg };
    }
}

let PdfPrinter;
let printer;
let printerError = null;

try {
  PdfPrinter = require('pdfmake');
} catch (err) {
  printerError = err.message;
  console.error('Failed to load pdfmake:', err);
}

let pdfParse;
try {
  pdfParse = require('pdf-parse');
} catch (e) {}

let xlsx;
try {
    xlsx = require('node-xlsx');
} catch (e) {
    console.log('node-xlsx not found');
}

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const FILES_COLLECTION = 'app_files';

async function trackFiles(fileIds) {
    if (!fileIds) return;
    const ids = Array.isArray(fileIds) ? fileIds : [fileIds];
    const validIds = ids.filter(id => id && typeof id === 'string');
    if (validIds.length === 0) return;
    
    const now = new Date();
    // We do not await to avoid blocking main logic, just fire and forget or await if needed
    // But cloud functions might freeze background tasks, so best to await.
    const tasks = validIds.map(fileID => {
        return db.collection(FILES_COLLECTION).add({
            data: {
                fileID,
                createdAt: now
            }
        }).catch(err => console.error('Track file error:', err));
    });
    
    await Promise.all(tasks);
}

async function handleCleanFiles() {
    const ONE_DAY_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const _ = db.command;
    
    try {
        // Limit 100 per run to avoid timeout, can increase if needed
        const res = await db.collection(FILES_COLLECTION)
            .where({
                createdAt: _.lt(ONE_DAY_AGO)
            })
            .limit(100)
            .get();
            
        if (!res.data || res.data.length === 0) {
            return { success: true, deletedCount: 0 };
        }
        
        const filesToDelete = res.data.map(item => item.fileID);
        const idsToDelete = res.data.map(item => item._id);
        
        // Delete from storage
        const deleteRes = await cloud.deleteFile({
            fileList: filesToDelete
        });
        
        // Delete from DB
        await db.collection(FILES_COLLECTION).where({
            _id: _.in(idsToDelete)
        }).remove();
        
        return { success: true, deletedCount: filesToDelete.length, storageResult: deleteRes };
        
    } catch (err) {
        console.error('Cleanup error:', err);
        return { success: false, error: err.message };
    }
}

const fontPath = path.join(__dirname, 'simhei.ttf');
const simsunPath = path.join(__dirname, 'simsun.ttf');
const hasCustomFont = fs.existsSync(fontPath);
const hasSimSunFont = fs.existsSync(simsunPath);

const fonts = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};

if (hasCustomFont) {
  fonts.SimHei = {
    normal: fontPath,
    bold: fontPath,
    italics: fontPath,
    bolditalics: fontPath
  };
}
if (hasSimSunFont) {
  fonts.SimSun = {
    normal: simsunPath,
    bold: simsunPath,
    italics: simsunPath,
    bolditalics: simsunPath
  };
}

if (PdfPrinter) {
  try {
    printer = new PdfPrinter(fonts);
  } catch (err) {
    printerError = 'Failed to initialize PdfPrinter: ' + err.message;
    console.error(printerError);
  }
}

const generatePDF = (docDefinition) => {
  return new Promise((resolve, reject) => {
    if (printerError) {
      return reject(new Error('PDF环境初始化失败: ' + printerError));
    }
    if (!printer) {
      return reject(new Error('PDFPrinter 未初始化'));
    }
    if (docDefinition.defaultStyle && docDefinition.defaultStyle.font === 'SimSun' && !hasSimSunFont) {
       docDefinition.defaultStyle.font = hasCustomFont ? 'SimHei' : 'Roboto';
    }
    if (docDefinition.defaultStyle && docDefinition.defaultStyle.font === 'SimHei' && !hasCustomFont) {
       docDefinition.defaultStyle.font = 'Roboto';
    }

    try {
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks = [];
      pdfDoc.on('data', (chunk) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);
      pdfDoc.end();
    } catch (err) {
      reject(err);
    }
  });
};

function computeItemAmounts(item) {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.price) || 0;
  const rawLaborCost = Number(item.laborCost) || 0;
  const handCountRaw = item && item.handCount !== undefined && item.handCount !== null && item.handCount !== ''
    ? Number(item.handCount)
    : 0;
  const laborUnitRaw = item && item.laborUnitPrice !== undefined && item.laborUnitPrice !== null && item.laborUnitPrice !== ''
    ? Number(item.laborUnitPrice)
    : 0;
  const handCount = isNaN(handCountRaw) ? 0 : handCountRaw;
  const laborUnitPrice = isNaN(laborUnitRaw) ? 0 : laborUnitRaw;
  const laborTotal = handCount > 0 && laborUnitPrice > 0 ? handCount * laborUnitPrice : rawLaborCost;
  const subtotal = qty * price + laborTotal;
  return { qty, price, handCount, laborUnitPrice, laborTotal, subtotal };
}

function formatMoney(value) {
  const n = Number(value);
  if (!isFinite(n)) return '';
  return n.toFixed(2);
}

function formatCompact(value) {
  const n = Number(value);
  if (!isFinite(n)) return '';
  const rounded = Math.round(n * 1000000) / 1000000;
  let s = String(rounded);
  if (s.indexOf('.') >= 0) {
    s = s.replace(/\.?0+$/, '');
  }
  return s;
}
exports.main = async (event, context) => {
  // Handle Timer Trigger
  // Handle Timer Trigger
  if (event.Type === 'Timer' || event.type === 'timer') {
    return await handleCleanFiles();
  }

  const { action, data } = event;
  
  try {
    switch (action) {
      case 'test':
        return { success: true, message: 'Cloud function is working', hasFont: hasCustomFont, printerStatus: printer ? 'ready' : 'failed' };
      case 'generateList':
        return await handleGenerateList(data);
      case 'generateAcceptance':
        return await handleGenerateAcceptance(data);
      case 'parsePDF':
        return await handleParsePDF(data);
      case 'embedImages':
        return await handleEmbedImages(data);
      case 'cleanFiles':
        return await handleCleanFiles();
      case 'generatePerformanceLetter':
        return await handleGeneratePerformanceLetter(data);
      default:
        return { success: false, error: 'Unknown action' };
    }
  } catch (err) {
    console.error(err);
    return { success: false, error: err.message };
  }
};

const generatePDFFromDataV1 = async (title, data, options = {}) => {
  const { vehicle, repairUnit, repairLocation, date, items, excelHeader } = data;
  const { withSignatures } = options;
  const projectLabel = /维修/.test(title) ? '维修项目' : '保养项目';
  const headerNames = ['序号', projectLabel, '数量', '单位', '配件单价\n(元)', '手工\n(次)', '手工费单价\n(元/次)', '备注'];

  const tableBody = [
    headerNames.map(h => ({ text: h, style: 'tableHeader', verticalAlignment: 'middle' }))
  ];

  let total = 0;
  items.forEach((item, index) => {
    const amounts = computeItemAmounts(item || {});
    total += amounts.subtotal;

    tableBody.push([
      { text: (index + 1).toString(), alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: item.name || '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: String(amounts.qty || ''), alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: item.unit || '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: (item.price !== undefined && item.price !== null && Number(item.price) !== 0) ? String(item.price).trim() : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: amounts.handCount ? String(amounts.handCount) : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: (item.laborUnitPrice !== undefined && item.laborUnitPrice !== null && Number(item.laborUnitPrice) !== 0) ? String(item.laborUnitPrice).trim() : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: item.spec || '', alignment: 'center', verticalAlignment: 'middle', noWrap: true }
    ]);
  });

  // Ensure at least 15 rows
  const minRows = 15;
  const currentRows = items.length;
  if (currentRows < minRows) {
    for (let i = 0; i < (minRows - currentRows); i++) {
        tableBody.push([
            { text: '', alignment: 'center' },
            { text: '', alignment: 'left' },
            { text: '', alignment: 'center' },
            { text: '', alignment: 'center' },
            { text: '', alignment: 'center' },
            { text: '', alignment: 'center' },
            { text: '', alignment: 'center' },
            { text: '', alignment: 'center' }
        ]);
    }
  }

  // Nested Table Strategy for Layout
  // Outer Table: 2 Columns [SideHeader, MainTable]
  // This avoids rowSpan issues and ensures vertical centering
  
  const mainTable = {
      table: {
          headerRows: 1,
          widths: [30, '*', 30, 30, 40, 26, 60, 39],
          body: tableBody
      },
      layout: {
         hLineWidth: function (i, node) { return 0.5; },
         vLineWidth: function (i, node) { return 0.5; },
         hLineColor: function (i, node) { return 'black'; },
         vLineColor: function (i, node) { return 'black'; },
         paddingLeft: function(i, node) { return 2; },
         paddingRight: function(i, node) { return 2; },
         paddingTop: function(i, node) { return 8; },
         paddingBottom: function(i, node) { return 8; }
      }
  };
  
  // Create Side Header Content
  // It needs to match the height of the main table?
  // No, just one cell with vertical centering.
  
  const outerTableBody = [
      [
          { 
              text: projectLabel, 
              alignment: 'center', 
              verticalAlignment: 'middle', // This works perfectly in a single cell
              fontSize: 12,
              bold: true
          },
          mainTable
      ]
  ];

  // Footer Table (Separate)
  const footerTable = {
      table: {
          widths: ['*'],
          body: [
              [
                  { text: '合计：' + formatCompact(total) + '元', alignment: 'center', bold: true, border: [true, true, true, true] }
              ]
          ]
      },
      layout: 'noBorders',
      margin: [0, -1, 0, 0]
  };
  // Wait, Footer needs to look like part of the table.
  // Let's just append the footer row to tableBody as before?
  // If we use nested table, the footer must be part of the inner table OR the outer table needs to accommodate it.
  // If footer is part of inner table, it will be in the 2nd column.
  // But user wants "Total" to span across everything?
  // Previous code: Footer spans 9 columns (Side + 8 data).
  // If using nested, we can't easily span out of the nest.
  
  // Better approach:
  // Add footer to tableBody (Inner Table).
  // Inner Table has 8 columns.
  // Footer spans 8 columns.
  // But Side Header is column 0.
  // The Side Header should span (Rows + Footer)?
  // If so, just add footer to inner table.
  
  tableBody.push([
      { text: '合计：' + formatCompact(total) + '元', colSpan: 8, alignment: 'center', bold: true },
      {}, {}, {}, {}, {}, {}, {}
  ]);
  
  // Header Rows for Metadata (centered, full borders)
  const displayDate = date ? dayjs(date).format('YYYY-MM-DD') : '';
  const headerRows = [];
  headerRows.push([
    { text: '维修车辆:', alignment: 'center', bold: true, verticalAlignment: 'middle', margin: [0,6,0,6] },
    { text: vehicle || '', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }
  ]);
  headerRows.push([
    { text: '维修单位:', alignment: 'center', bold: true, verticalAlignment: 'middle', margin: [0,6,0,6] },
    { text: repairUnit || '', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }
  ]);
  headerRows.push([
    { text: '维修地点:', alignment: 'center', bold: true, verticalAlignment: 'middle', margin: [0,6,0,6] },
    { text: repairLocation || '', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }
  ]);
  if (displayDate) {
    headerRows.push([
      { text: '日期:', alignment: 'center', bold: true, verticalAlignment: 'middle', margin: [0,6,0,6] },
      { text: displayDate, alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }
    ]);
  }

  // Build a single outer table to keep title frame connected with body
  const outerBody = [];
  // Title row spanning both columns
  outerBody.push([
    { text: title, style: 'header', verticalAlignment: 'middle', colSpan: 2 },
    {}
  ]);
  // Metadata rows
  headerRows.forEach(r => outerBody.push(r));
  // Combined main table (left side column + 8 data columns), aligned row-by-row
  const dataRowCount = Math.max(items.length, minRows);
  const targetRowIndex = Math.ceil(dataRowCount / 2) - 1;
  const halfRowMargin = (dataRowCount % 2 === 0) ? 12 : 0;
  const combinedBody = [];
  // Header row
  combinedBody.push([
    { text: '', alignment: 'center', verticalAlignment: 'middle', border: [true, false, true, false] },
    ...headerNames.map(h => ({ text: h, style: 'tableHeader', verticalAlignment: 'middle' }))
  ]);
  let runningTotalOuter = 0;
  for (let r = 0; r < dataRowCount; r++) {
    const itemR = r < items.length ? items[r] : null;
    const amountsR = itemR ? computeItemAmounts(itemR) : null;
    if (amountsR) {
      runningTotalOuter += amountsR.subtotal;
    }
    combinedBody.push([
      { 
        text: r === targetRowIndex ? projectLabel : '', 
        alignment: 'center', 
        verticalAlignment: 'middle',
        border: [true, false, true, false],
        margin: r === targetRowIndex ? [0, halfRowMargin, 0, 0] : [0, 0, 0, 0],
        fontSize: r === targetRowIndex ? 12 : 10,
        bold: r === targetRowIndex ? true : false,
        noWrap: true
      },
      { 
        text: (itemR && String(itemR.name || '').trim()) ? (r + 1).toString() : '', 
        alignment: 'center', 
        verticalAlignment: 'middle',
        noWrap: true
      },
      { text: itemR ? (itemR.name || '') : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: itemR && amountsR ? String(amountsR.qty || '') : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: itemR ? (itemR.unit || '') : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: itemR && itemR.price && Number(itemR.price) !== 0 ? String(itemR.price).trim() : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: itemR && amountsR && amountsR.handCount ? String(amountsR.handCount) : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: itemR && itemR.laborUnitPrice && Number(itemR.laborUnitPrice) !== 0 ? String(itemR.laborUnitPrice).trim() : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: itemR ? (itemR.spec || '') : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true }
    ]);
  }
  combinedBody.push([
    { text: '合计：' + formatCompact(runningTotalOuter) + '元', colSpan: 9, alignment: 'center', bold: true, verticalAlignment: 'middle' },
    {}, {}, {}, {}, {}, {}, {}, {}
  ]);
  const combinedMainTable = {
    table: {
      headerRows: 1,
      widths: [80, 30, '*', 30, 30, 40, 45, 40, 50],
      body: combinedBody
    },
    layout: {
      hLineWidth: function (i, node) { return 0.5; },
      vLineWidth: function (i, node) { return 0.5; },
      hLineColor: function (i, node) { return 'black'; },
      vLineColor: function (i, node) { return 'black'; },
      paddingLeft: function(i, node) { return 2; },
      paddingRight: function(i, node) { return 2; },
      paddingTop: function(i, node) { return 8; },
      paddingBottom: function(i, node) { return 8; }
    }
  };
  outerBody.push([{ ...combinedMainTable, colSpan: 2 }, {}]);
  if (withSignatures) {
    outerBody.push([
      {
        colSpan: 2,
        table: {
          widths: [110, '*'],
          body: [[
            { text: '验收人:', alignment: 'left', verticalAlignment: 'middle', border: [true,true,true,true], margin: [6,6,0,6] },
            { text: '审核人:', alignment: 'center', verticalAlignment: 'middle', border: [true,true,true,true], margin: [6,6,0,6] }
          ]]
        },
        layout: {
          hLineWidth: function() { return 0; },
          vLineWidth: function() { return 0; },
          paddingLeft: function() { return 0; },
          paddingRight: function() { return 0; },
          paddingTop: function() { return 0; },
          paddingBottom: function() { return 0; }
        }
      },
      {}
    ]);
  }
  // Note row inside the same frame
  outerBody.push([{ text: '注: 总价包含1%增值税', colSpan: 2, alignment: 'center', verticalAlignment: 'middle' }, {}]);
  const content = [
    {
      table: {
        widths: [80, '*'],
        body: outerBody
      },
      layout: {
         hLineWidth: function (i, node) { return 0.5; },
         vLineWidth: function (i, node) { return 0.5; },
         hLineColor: function (i, node) { return 'black'; },
         vLineColor: function (i, node) { return 'black'; },
         paddingTop: function(i, node) { return 0; },
         paddingBottom: function(i, node) { return 0; },
         paddingLeft: function(i, node) { return 0; },
         paddingRight: function(i, node) { return 0; }
      }
    }
  ];

  // Removed outer-of-table signature columns per requirement

  const docDefinition = {
    content: content,

    defaultStyle: {
      font: hasSimSunFont ? 'SimSun' : (hasCustomFont ? 'SimHei' : 'Roboto'),
      fontSize: 10,
      alignment: 'center'
    },
    styles: {
      header: { fontSize: 18, bold: true },
      tableHeader: { bold: true, fontSize: 10, alignment: 'center' }
    }
  };
  // Restore stamp only for 维修清单
  const stampPath = path.join(__dirname, 'stamp.png');
  if (/维修清单/.test(title) && fs.existsSync(stampPath)) {
    docDefinition.background = function(currentPage, pageSize) {
      return {
        image: stampPath,
        width: 140,
        absolutePosition: {
          x: pageSize.width - 180,
          y: pageSize.height / 2 + 30
        },
        opacity: 0.8
      };
    };
  }

  return await generatePDF(docDefinition);
};

const generatePDFFromDataV2 = async (title, data, options = {}) => {
  const { vehicle, repairUnit, repairLocation, date, items, excelHeader } = data;
  const { withSignatures } = options;
  const projectLabel = /维修/.test(title) ? '维修项目' : '保养项目';
  
  const headerNames = ['序号', projectLabel, '数量', '单位', '单价', '配件总价', '手工总价', '规格型号'];
  const minRows = 15;
  const dataRowCount = Math.max(items.length, minRows);
  const targetRowIndex = Math.ceil(dataRowCount / 2) - 1;
  const halfRowMargin = (dataRowCount % 2 === 0) ? 12 : 0;
  const combinedBody = [];
  
  combinedBody.push([
    { text: '', alignment: 'center', verticalAlignment: 'middle', border: [true, false, true, false] },
    ...headerNames.map(h => ({ text: h, style: 'tableHeader', verticalAlignment: 'middle' }))
  ]);
  
  let runningTotalOuter = 0;
  for (let r = 0; r < dataRowCount; r++) {
    const itemR = r < items.length ? items[r] : null;
    const amountsR = itemR ? computeItemAmounts(itemR) : null;
    if (amountsR) {
      runningTotalOuter += amountsR.subtotal;
    }
    
    const matTotal = (amountsR && amountsR.qty && amountsR.price) ? (amountsR.qty * amountsR.price) : 0;
    
    combinedBody.push([
      { 
        text: r === targetRowIndex ? projectLabel : '', 
        alignment: 'center', 
        verticalAlignment: 'middle',
        border: [true, false, true, false],
        margin: r === targetRowIndex ? [0, halfRowMargin, 0, 0] : [0, 0, 0, 0],
        fontSize: r === targetRowIndex ? 12 : 10,
        bold: r === targetRowIndex ? true : false,
        noWrap: true
      },
      { 
        text: (itemR && String(itemR.name || '').trim()) ? (r + 1).toString() : '', 
        alignment: 'center', 
        verticalAlignment: 'middle',
        noWrap: true
      },
      { text: itemR ? (itemR.name || '') : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: itemR && amountsR ? String(amountsR.qty || '') : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: itemR ? (itemR.unit || '') : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: itemR && itemR.price && Number(itemR.price) !== 0 ? String(Math.floor(Number(itemR.price))) : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: matTotal ? String(Math.floor(matTotal)) : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: itemR && amountsR && amountsR.laborTotal ? String(Math.floor(amountsR.laborTotal)) : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true },
      { text: itemR ? (itemR.spec || '') : '', alignment: 'center', verticalAlignment: 'middle', noWrap: true }
    ]);
  }
  
  combinedBody.push([
    { text: '合计：' + formatCompact(runningTotalOuter) + '元', colSpan: 9, alignment: 'center', bold: true, verticalAlignment: 'middle' },
    {}, {}, {}, {}, {}, {}, {}, {}
  ]);

  const combinedMainTable = {
    table: {
      headerRows: 1,
      widths: [80, 30, '*', 30, 30, 40, 45, 40, 50],
      body: combinedBody
    },
    layout: {
      hLineWidth: function (i, node) { return 0.5; },
      vLineWidth: function (i, node) { return 0.5; },
      hLineColor: function (i, node) { return 'black'; },
      vLineColor: function (i, node) { return 'black'; },
      paddingLeft: function(i, node) { return 2; },
      paddingRight: function(i, node) { return 2; },
      paddingTop: function(i, node) { return 8; },
      paddingBottom: function(i, node) { return 8; }
    }
  };

  const displayDate = date ? dayjs(date).format('YYYY-MM-DD') : '';
  const headerRows = [];
  headerRows.push([
    { text: '维修车辆:', alignment: 'center', bold: true, verticalAlignment: 'middle', margin: [0,6,0,6] },
    { text: vehicle || '', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }
  ]);
  headerRows.push([
    { text: '维修单位:', alignment: 'center', bold: true, verticalAlignment: 'middle', margin: [0,6,0,6] },
    { text: repairUnit || '', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }
  ]);
  headerRows.push([
    { text: '维修地点:', alignment: 'center', bold: true, verticalAlignment: 'middle', margin: [0,6,0,6] },
    { text: repairLocation || '', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }
  ]);
  if (displayDate) {
    headerRows.push([
      { text: '日期:', alignment: 'center', bold: true, verticalAlignment: 'middle', margin: [0,6,0,6] },
      { text: displayDate, alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }
    ]);
  }

  const outerBody = [];
  outerBody.push([
    { text: title, style: 'header', verticalAlignment: 'middle', colSpan: 2 },
    {}
  ]);
  headerRows.forEach(r => outerBody.push(r));
  
  outerBody.push([{ ...combinedMainTable, colSpan: 2 }, {}]);
  
  if (withSignatures) {
    outerBody.push([
      {
        colSpan: 2,
        table: {
          widths: [110, '*'],
          body: [[
            { text: '验收人:', alignment: 'left', verticalAlignment: 'middle', border: [true,true,true,true], margin: [6,6,0,6] },
            { text: '审核人:', alignment: 'center', verticalAlignment: 'middle', border: [true,true,true,true], margin: [6,6,0,6] }
          ]]
        },
        layout: {
          hLineWidth: function() { return 0; },
          vLineWidth: function() { return 0; },
          paddingLeft: function() { return 0; },
          paddingRight: function() { return 0; },
          paddingTop: function() { return 0; },
          paddingBottom: function() { return 0; }
        }
      },
      {}
    ]);
  }
  
  outerBody.push([{ text: '注: 总价包含1%增值税', colSpan: 2, alignment: 'center', verticalAlignment: 'middle' }, {}]);
  
  const content = [
    {
      table: {
        widths: [80, '*'],
        body: outerBody
      },
      layout: {
         hLineWidth: function (i, node) { return 0.5; },
         vLineWidth: function (i, node) { return 0.5; },
         hLineColor: function (i, node) { return 'black'; },
         vLineColor: function (i, node) { return 'black'; },
         paddingTop: function(i, node) { return 0; },
         paddingBottom: function(i, node) { return 0; },
         paddingLeft: function(i, node) { return 0; },
         paddingRight: function(i, node) { return 0; }
      }
    }
  ];

  const docDefinition = {
    content: content,
    defaultStyle: {
      font: hasSimSunFont ? 'SimSun' : (hasCustomFont ? 'SimHei' : 'Roboto'),
      fontSize: 10,
      alignment: 'center'
    },
    styles: {
      header: { fontSize: 18, bold: true },
      tableHeader: { bold: true, fontSize: 10, alignment: 'center' }
    }
  };
  
  const stampPath = path.join(__dirname, 'stamp.png');
  if (/维修清单/.test(title) && fs.existsSync(stampPath)) {
    docDefinition.background = function(currentPage, pageSize) {
      return {
        image: stampPath,
        width: 140,
        absolutePosition: {
          x: pageSize.width - 180,
          y: pageSize.height / 2 + 30
        },
        opacity: 0.8
      };
    };
  }

  return await generatePDF(docDefinition);
};

const generatePDFFromData = async (title, data, options = {}) => {
    if (data.templateVersion === 'v2') {
        return await generatePDFFromDataV2(title, data, options);
    }
    return await generatePDFFromDataV1(title, data, options);
};

// Modified Handlers to return PDF
async function handleGenerateList(data) {
  const { type, vehicle, repairUnit, repairLocation, date, items, excelHeader, templateVersion } = data;
  const title = type === 'repair' ? '维修清单' : '保养清单';
  const displayDate = date || '';

  // Use PDF generation instead of Excel
  const pdfBuffer = await generatePDFFromData(title, {
      vehicle, repairUnit, repairLocation, date: displayDate, items, excelHeader, templateVersion
  }, { withSignatures: false });

  const uploadResult = await cloud.uploadFile({
      cloudPath: (() => {
        const plate = String(vehicle || '').replace(/[^0-9A-Za-z\u4e00-\u9fa5]/g, '');
        const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
        return `repair/${title}-${plate}-${letter}.pdf`;
      })(),
      fileContent: pdfBuffer
  });
  await trackFiles(uploadResult.fileID);
  const plate = String(vehicle || '').replace(/[^0-9A-Za-z\u4e00-\u9fa5]/g, '');
  const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const fileName = `${title}-${plate}-${letter}.pdf`;
  return { success: true, fileID: uploadResult.fileID, fileName };
}

async function handleGenerateAcceptance(data) {
  const { type, vehicle, repairUnit, repairLocation, repairDate, acceptanceDate, items, excelHeader, templateVersion } = data;
  const title = type === 'repair' ? '维修验收单' : '保养验收单';
  
  // Use PDF generation
  const pdfBuffer = await generatePDFFromData(title, {
      vehicle, 
      repairUnit, 
      repairLocation, 
      date: acceptanceDate || repairDate, // Use acceptance date as primary
      items,
      excelHeader,
      templateVersion
  }, { withSignatures: true });

  const uploadResult = await cloud.uploadFile({
      cloudPath: (() => {
        const plate = String(vehicle || '').replace(/[^0-9A-Za-z\u4e00-\u9fa5]/g, '');
        const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
        return `acceptance/${title}-${plate}-${letter}.pdf`;
      })(),
      fileContent: pdfBuffer
  });
  await trackFiles(uploadResult.fileID);
  const plate = String(vehicle || '').replace(/[^0-9A-Za-z\u4e00-\u9fa5]/g, '');
  const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const fileName = `${title}-${plate}-${letter}.pdf`;
  return { success: true, fileID: uploadResult.fileID, fileName };
}

async function handleParsePDF(data) {
  const { fileID } = data || {};
  if (!fileID) return { success: false, error: 'fileID missing' };
  await trackFiles(fileID);
  try {
    const dl = await cloud.downloadFile({ fileID });
    const debug = {};
    const buf = dl.fileContent;
    const extLower = String(fileID || '').toLowerCase();
    debug.fileIdExtXlsx = extLower.endsWith('.xlsx');
    const isZip = buf && buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4B; // 'PK'
    debug.zipSignaturePK = !!isZip;
    let hasXlsxMarkers = false;
    if (isZip) {
        try {
            const sample = buf.slice(0, Math.min(buf.length, 65536)).toString('utf8');
            hasXlsxMarkers = /\[Content_Types\]\.xml|xl\/|workbook\.xml/i.test(sample);
        } catch (_) {}
    }
    debug.xlsxMarkers = hasXlsxMarkers;
    let isExcel = debug.fileIdExtXlsx || (isZip && hasXlsxMarkers);
    let excelSheets = [];
    if (isExcel && xlsx) {
        try {
            excelSheets = xlsx.parse(buf);
            debug.excelSheetCount = excelSheets ? excelSheets.length : 0;
        } catch (e) {
            debug.xlsxParseError = String(e && e.message || e || '');
            isExcel = false;
        }
    } else {
        debug.excelSheetCount = 0;
    }

    if (isExcel) {
        // --- Excel Parsing Logic ---
        const sheet = excelSheets[0]; // Assume first sheet
        const rows = sheet.data;
        let items = [];
        let vehicle = '';
        let repairUnit = '';
        let repairLocation = '';
        let date = '';
        let excelHeader = [];
        
        // Find Header Row
        let headerRowIdx = -1;
        for(let i=0; i<rows.length; i++) {
            const rowStr = rows[i].join(' ');
            if (/序号/.test(rowStr) && (/维修项目/.test(rowStr) || /名称/.test(rowStr))) {
                headerRowIdx = i;
            }
            // Metadata
            if (/(?:维修|承修|客户)单位[:：]?\s*(\S+)/.test(rowStr)) {
                const m = rowStr.match(/(?:维修|承修|客户)单位[:：]?\s*(\S+)/);
                if (m) repairUnit = m[1];
            }
            if (/(?:维修|承修|服务)地点[:：]?\s*(\S+)/.test(rowStr)) {
                const m = rowStr.match(/(?:维修|承修|服务)地点[:：]?\s*(\S+)/);
                if (m) repairLocation = m[1];
            }
            if (/(?:日期|时间)[:：]?\s*(\S+)/.test(rowStr)) {
                 const m = rowStr.match(/(?:日期|时间)[:：]?\s*(\S+)/);
                 let rawDate = m[1];
                 // Check if rawDate is Excel serial (approx 40000-50000)
                 if (/^\d{5}(\.\d+)?$/.test(rawDate)) {
                     const num = parseFloat(rawDate);
                     if (num > 35000 && num < 60000) {
                         const dateObj = new Date(Math.round((num - 25569) * 86400 * 1000));
                         const y = dateObj.getFullYear();
                         const mon = dateObj.getMonth() + 1;
                         const d = dateObj.getDate();
                         date = `${y}-${mon < 10 ? '0'+mon : mon}-${d < 10 ? '0'+d : d}`;
                     } else {
                         // Normalize Chinese date chars to hyphens for better dayjs compatibility
                         date = rawDate.replace(/[年月]/g, '-').replace(/日/g, '');
                     }
                 } else {
                     date = rawDate.replace(/[年月]/g, '-').replace(/日/g, '');
                 }
            } else {
                 // Try to match date pattern YYYY-MM-DD or YYYY.MM.DD
                 const m = rowStr.match(/(\d{4}[-./年]\d{1,2}[-./月]\d{1,2}[日]?)/);
                 if (m && !/序号|合计/.test(rowStr)) {
                     date = m[1];
                 }
            }
            if (/(?:维修)?车辆[:：]?\s*(\S+)/.test(rowStr)) {
                const m = rowStr.match(/(?:维修)?车辆[:：]?\s*(\S+)/);
                if (m) vehicle = m[1];
            }
        }
        
        if (headerRowIdx !== -1) {
            // Identify Columns in Header
            const headerRow = rows[headerRowIdx];
            excelHeader = headerRow.map(c => String(c || '').trim());
            let idxName = -1, idxQty = -1, idxUnit = -1, idxPrice = -1, idxLabor = -1, idxSpec = -1;
            
            headerRow.forEach((cell, idx) => {
                const txt = String(cell).trim();
                if (/维修项目|名称/.test(txt)) idxName = idx;
                else if (/数量/.test(txt)) idxQty = idx;
                else if (/单位/.test(txt)) idxUnit = idx;
                else if (/单价/.test(txt)) idxPrice = idx;
                else if (/手工总价|工费|手工费单价/.test(txt)) idxLabor = idx;
                else if (/规格|备注/.test(txt)) idxSpec = idx;
            });
            
            // Extract Data
            for(let i=headerRowIdx+1; i<rows.length; i++) {
                const row = rows[i];
                if (!row || row.length === 0) continue;
                const rowStr = row.join('');
                if (/合计|Total/.test(rowStr)) break;
                // Strict check: Must have numeric quantity or price
                let hasNumber = false;
                row.forEach(c => {
                    if (typeof c === 'number' || (!isNaN(parseFloat(c)) && isFinite(c))) hasNumber = true;
                });
                if (!hasNumber) continue;

                let name = idxName !== -1 ? row[idxName] : '';
                let qty = idxQty !== -1 ? row[idxQty] : 1;
                let unit = idxUnit !== -1 ? row[idxUnit] : '个';
                let price = idxPrice !== -1 ? row[idxPrice] : 0;
                let labor = idxLabor !== -1 ? row[idxLabor] : 0;
                let spec = idxSpec !== -1 ? row[idxSpec] : '';
                
                // Fallback if Name is missing but row has content
                if (!name && row[1]) name = row[1]; // Guess column 1
                
                if (name) {
                    items.push({
                        name: String(name),
                        quantity: String(qty || 1),
                        unit: String(unit || '个'),
                        price: String(price || 0),
                        laborCost: String(labor || 0),
                        spec: String(spec || '')
                    });
                }
            }
        } else {
             // Fallback: Numeric Heuristic (User's pattern: Seq, Qty, Price, MatTotal, Labor)
             for(let i=0; i<rows.length; i++) {
                const row = rows[i];
                if (!row || row.length === 0) continue;
                
                // Skip rows that look like metadata
                const rowStr = row.join(' ');
                if (/维修单位|维修地点|维修车辆|日期|时间/.test(rowStr)) continue;
                if (/合计|Total/.test(rowStr)) continue;

                // Identify numeric columns in this row
                const numIndices = [];
                row.forEach((c, idx) => {
                    if (c !== null && c !== '' && (typeof c === 'number' || (!isNaN(parseFloat(c)) && isFinite(c)))) {
                         numIndices.push(idx);
                    }
                });
                
                if (numIndices.length >= 5) {
                     // 1st: Seq, 2nd: Qty, 3rd: Price, 4th: MatTotal (Ignore), 5th: Labor
                     const idxSeq = numIndices[0];
                     const idxQty = numIndices[1];
                     const idxPrice = numIndices[2];
                     const idxLabor = numIndices[4];
                     
                     const qty = row[idxQty];
                     const price = row[idxPrice];
                     const labor = row[idxLabor];
                     
                     // Unit: Between Qty and Price?
                     let unit = '个';
                     if (idxPrice > idxQty + 1) {
                         const u = row[idxQty + 1];
                         if (u) unit = u;
                     }
                     
                     // Name: Between Seq and Qty
                     let name = '';
                     if (idxQty > idxSeq + 1) {
                         // Join columns between Seq and Qty
                         name = row.slice(idxSeq + 1, idxQty).filter(Boolean).join('');
                     } else if (idxSeq > 0) {
                         // Or before Seq if Seq is not 0
                         name = row.slice(0, idxSeq).filter(Boolean).join('');
                     }
                     
                     // Spec: After Labor
                     let spec = '';
                     if (idxLabor + 1 < row.length) {
                         spec = row.slice(idxLabor + 1).filter(Boolean).join(' ');
                     }
                     
                     items.push({
                         name: String(name || '未命名'),
                         quantity: String(qty),
                         unit: String(unit),
                         price: String(price),
                         laborCost: String(labor),
                         spec: String(spec)
                     });
                }
             }
        }
        
        return { success: true, data: { vehicle, items, rawText: 'Excel Parsed', repairUnit, repairLocation, excelHeader, date, debug }, excelFileID: fileID };
    }

    // --- PDF Parsing Logic with DeepSeek AI ---
    let text = '';
    
    // 1. Extract Raw Text using pdf-parse
    if (pdfParse) {
        try {
            const pdfData = await pdfParse(dl.fileContent);
            text = pdfData.text;
        } catch(e) {
            console.error('PDF Parse failed', e);
        }
    }

    if (!text || text.trim().length === 0) {
        return { success: false, error: '无法识别PDF文本。该文件可能是纯图片扫描件，请使用“AI拍照识别”功能上传截图。' };
    }

    debug.textLength = (text || '').length;
    debug.textPreview = (text || '').slice(0, 400);

    // --- Optimization: Try Local Parsing First ---
    // If local parsing is perfect (Total matches sum of items), return immediately to save time/cost.
    const fastLocal = parseTextFallback(text);
    const fastRec = reconcileTotals(fastLocal.items || [], text);
    const fastTotal = fastRec.debug.totalFromText;
    const fastCalc = fastRec.debug.sumCombined;
    // Perfect match: Explicit Total found, Matches sum of items, and Items exist
    const isPerfectMatch = fastTotal > 0 && Math.abs(fastCalc - fastTotal) <= 0.5 && fastLocal.items.length > 0;

    if (isPerfectMatch) {
         return {
            success: true,
            data: {
                vehicle: fastLocal.vehicle || '',
                items: fastRec.items || [],
                rawText: text,
                repairUnit: fastLocal.repairUnit || '',
                repairLocation: fastLocal.repairLocation || '',
                excelHeader: [],
                date: fastLocal.date || '',
                debug: { ...debug, method: 'local_fast_path', totalCheck: fastRec.debug }
            }
        };
    }

    const aiResult = await callDeepSeek(text);
    debug.deepseekRawPreview = (aiResult && aiResult.raw) ? String(aiResult.raw).slice(0, 500) : '';
    debug.deepseekParsed = !!(aiResult && aiResult.json);
    debug.deepseekError = aiResult && aiResult.error ? String(aiResult.error) : '';
    
    if (aiResult && aiResult.json) {
        const rec = reconcileTotals(aiResult.json.items || [], text);
        debug.totalCheck = rec.debug;
        return { 
            success: true, 
            data: { 
                vehicle: aiResult.json.vehicle || '', 
                items: rec.items || [], 
                rawText: text, 
                repairUnit: aiResult.json.repairUnit || '', 
                repairLocation: aiResult.json.repairLocation || '', 
                excelHeader: [], 
                date: aiResult.json.date || '',
                debug
            }
        };
    } else {
        const localParsed = parseTextFallback(text);
        const hasLocalItems = Array.isArray(localParsed.items) && localParsed.items.length > 0;
        const vehicleOut = localParsed.vehicle || (aiResult && /Insufficient Balance/i.test(String(aiResult.error || '')) ? 'DeepSeek余额不足' : 'AI解析未配置或失败');
        const rec = reconcileTotals(hasLocalItems ? localParsed.items : [], text);
        debug.totalCheck = rec.debug;
        return {
            success: true,
            data: {
                vehicle: vehicleOut,
                items: hasLocalItems ? rec.items : [],
                rawText: text,
                repairUnit: localParsed.repairUnit || '',
                repairLocation: localParsed.repairLocation || '',
                excelHeader: [],
                date: localParsed.date || '',
                debug
            }
        };
    }

    // --- Legacy Parsing Logic (Unreachable now, but kept for reference if needed) ---
    /*
    let items = [];
    let vehicle = '';
    let repairUnit = '';
    let repairLocation = '';
    let date = '';

    if (pdfParse) {
        // Advanced PDF Parsing: Extract structured data using page render
        const render_page = async (pageData) => {
            let render_options = {
                normalizeWhitespace: false,
                disableCombineTextItems: false
            }
            return pageData.getTextContent(render_options)
            .then(function(textContent) {
                // Return items with transform data
                return JSON.stringify(textContent.items.map(item => ({
                    str: item.str,
                    x: item.transform[4],
                    y: item.transform[5]
                })));
            });
        }
        
        let options = {
            pagerender: render_page
        }

        try {
            let allItems = [];
            
            // Determine template file based on type
            let templateFilename = 'template.pdf';
            if (data.templateType === 'module5') {
                templateFilename = 'template_m5.pdf';
            } else if (data.templateType === 'module6') {
                templateFilename = 'template_m6.pdf';
            }
            
            const templatePath = path.join(__dirname, 'pdfTemplates', templateFilename);
            
            if (data.useTemplate && fs.existsSync(templatePath)) {
                 // Template-based Precise Parsing (Subtraction Mode)
                 const tplBuffer = fs.readFileSync(templatePath);
                 const tplRes = await pdfParse(tplBuffer, options);
                 const userRes = await pdfParse(dl.fileContent, options);
                 
                 const parseRawItems = (txt) => {
                     let items = [];
                     const pages = txt.split(/\n\n/);
                     for(const p of pages) {
                         try {
                             const clean = p.trim();
                             if(clean.startsWith('[') && clean.endsWith(']')) {
                                 items = items.concat(JSON.parse(clean));
                             }
                         } catch(e){}
                     }
                     return items;
                 };
                 
                 const tplItems = parseRawItems(tplRes.text);
                 const rawUserItems = parseRawItems(userRes.text);
                 
                 // --- OFFSET CORRECTION ---
                 // 1. Calculate Global Offset (Registration)
                 // Find matching items to determine shift
                 const xDiffs = {};
                 const yDiffs = {};
                 let matchCount = 0;

                 // Normalize text for comparison (ignore spaces, case)
                 const normalize = s => (s || '').replace(/\s+/g, '').toLowerCase();

                 // Sample items to find offset
                 for (const t of tplItems) {
                     const tStr = normalize(t.str);
                     if (tStr.length < 2) continue; // Skip short noise
                     
                     // Find matches in user items
                     const matches = rawUserItems.filter(u => normalize(u.str) === tStr);
                     
                     for (const m of matches) {
                         // Check if coordinates are somewhat close (within 50 units) to avoid false positives from repeated text
                         if (Math.abs(m.x - t.x) < 50 && Math.abs(m.y - t.y) < 50) {
                             const dx = Math.round(m.x - t.x);
                             const dy = Math.round(m.y - t.y);
                             xDiffs[dx] = (xDiffs[dx] || 0) + 1;
                             yDiffs[dy] = (yDiffs[dy] || 0) + 1;
                             matchCount++;
                         }
                     }
                 }

                 let offsetX = 0;
                 let offsetY = 0;
                 
                 const getMode = (diffs) => {
                     let mode = 0;
                     let max = 0;
                     for (const [k, v] of Object.entries(diffs)) {
                         if (v > max) {
                             max = v;
                             mode = parseInt(k);
                         }
                     }
                     return mode;
                 };

                 if (matchCount > 0) {
                     offsetX = getMode(xDiffs);
                     offsetY = getMode(yDiffs);
                     console.log(`Detected Offset: X=${offsetX}, Y=${offsetY} (Matches: ${matchCount})`);
                 } else {
                     console.log('No text matches found for offset calculation. Assuming zero offset.');
                 }

                 // Filter out items that exist in the template
                 allItems = rawUserItems.filter(u => {
                     if (!u.str || !u.str.trim()) return false;
                     const uStr = normalize(u.str);
                     
                     // Check against template items with Offset + Relaxed Tolerance
                     const isTemplateText = tplItems.some(t => {
                         if (normalize(t.str) !== uStr) return false;
                         
                         // Apply offset to template coords to match user coords
                         const targetX = t.x + offsetX;
                         const targetY = t.y + offsetY;
                         
                         // Relaxed tolerance (5 units)
                         return Math.abs(targetX - u.x) < 5 && Math.abs(targetY - u.y) < 5;
                     });
                     return !isTemplateText;
                 });
                 console.log('Template Mode: Filtered ' + (rawUserItems.length - allItems.length) + ' template items.');
                 
            } else {
                // Standard Parsing
                const res = await pdfParse(dl.fileContent, options);
                const pagesRaw = res.text.split(/\n\n/);
                for (const pageJson of pagesRaw) {
                    try {
                        const cleanJson = pageJson.trim();
                        if (cleanJson.startsWith('[') && cleanJson.endsWith(']')) {
                            const pageItems = JSON.parse(cleanJson);
                            allItems = allItems.concat(pageItems);
                        }
                    } catch (e) {
                        // Not JSON, maybe normal text?
                    }
                }
            }
            
            if (allItems.length > 0) {
                // --- STRUCTURED PARSING (Virtual Excel) ---
                
                // 1. Group by Y (Rows)
                // Y coordinates in PDF usually start from bottom-left (0,0) or top-left depending on transform.
                // Usually Y decreases as we go down.
                // We need to group items that have similar Y (within 2-3 units).
                
                const rowsMap = new Map();
                const tolerance = 5; // Vertical tolerance
                
                allItems.forEach(item => {
                    if (!item.str || !item.str.trim()) return;
                    
                    let foundRowY = null;
                    for (const y of rowsMap.keys()) {
                        if (Math.abs(y - item.y) < tolerance) {
                            foundRowY = y;
                            break;
                        }
                    }
                    
                    if (foundRowY !== null) {
                        rowsMap.get(foundRowY).push(item);
                    } else {
                        rowsMap.set(item.y, [item]);
                    }
                });
                
                // Sort rows by Y (Descending usually means Top-to-Bottom in PDF, but let's verify)
                // PDF coordinate system: (0,0) is usually bottom-left. So higher Y is higher on page.
                const sortedY = Array.from(rowsMap.keys()).sort((a, b) => b - a);
                
                // Process each row
                for (const y of sortedY) {
                    const rowItems = rowsMap.get(y);
                    // Sort by X (Left-to-Right)
                    rowItems.sort((a, b) => a.x - b.x);
                    
                    const rowStr = rowItems.map(i => i.str).join(' '); // For metadata regex
                    const cols = rowItems.map(i => i.str.trim()).filter(Boolean); // For data
                    
                    // Metadata Extraction
                    if (/(?:维修|承修|客户)单位[:：]?\s*(\S+)/.test(rowStr)) {
                         const m = rowStr.match(/(?:维修|承修|客户)单位[:：]?\s*(\S+)/);
                         if (m) repairUnit = m[1];
                    }
                    if (/(?:维修|承修|服务)地点[:：]?\s*(\S+)/.test(rowStr)) {
                         const m = rowStr.match(/(?:维修|承修|服务)地点[:：]?\s*(\S+)/);
                         if (m) repairLocation = m[1];
                    }
                    if (/(?:日期|时间)[:：]?\s*(\S+)/.test(rowStr)) {
                         const m = rowStr.match(/(?:日期|时间)[:：]?\s*(\S+)/);
                         if (m) date = m[1];
                    }
                    if (/(?:维修)?车辆[:：]?\s*(\S+)/.test(rowStr)) {
                         const m = rowStr.match(/(?:维修)?车辆[:：]?\s*(\S+)/);
                         if (m) vehicle = m[1];
                    }
                    
                    // Skip non-data rows
                    if (/序号/.test(rowStr) || /维修单位/.test(rowStr) || /维修地点/.test(rowStr) || /维修车辆/.test(rowStr)) continue;
                    if (/合计|Total/.test(rowStr)) continue;
                    
                    // Data Parsing Logic (Same as before but on cleaner cols)
                    // Try to identify numeric columns
                    const numIndices = [];
                    cols.forEach((c, idx) => {
                        // Remove commas for currency
                        const cleanC = c.replace(/,/g, '');
                        if (!isNaN(parseFloat(cleanC)) && isFinite(cleanC)) numIndices.push(idx);
                    });
                    
                    if (numIndices.length >= 5) {
                         let idxSeq = numIndices[0];
                         let idxQty = numIndices[1];
                         let idxPrice = numIndices[2];
                         // idxMatTotal = numIndices[3] (ignore)
                         let idxLabor = numIndices[4];
                         
                         let qty = cols[idxQty];
                         let price = cols[idxPrice];
                         let labor = cols[idxLabor];
                         
                         let unit = '个';
                         if (idxPrice > idxQty + 1) {
                             unit = cols[idxQty + 1];
                         }
                         
                         let name = '';
                         if (idxQty > idxSeq + 1) {
                             name = cols.slice(idxSeq + 1, idxQty).join('');
                         } else if (idxSeq > 0) {
                             name = cols.slice(0, idxSeq).join('');
                         }
                         
                         let spec = '';
                         if (idxLabor + 1 < cols.length) {
                             spec = cols.slice(idxLabor + 1).join(' ');
                         }
                         
                         items.push({ name, quantity: qty, unit, price, laborCost: labor, spec });
                    }
                }
                
                if (items.length > 0) {
                    return { success: true, data: { vehicle, items, rawText: 'PDF Grid Parsed', repairUnit, repairLocation } };
                }
            }
            
            // Fallback to text parsing if JSON parsing fails or no items found
            text = (await pdfParse(dl.fileContent)).text;
            
        } catch (e) {
            // If render fails, fall back to standard text
            text = (await pdfParse(dl.fileContent)).text;
        }
    }

    const lines = (text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    // 1. Find Header Line (Optional, just helps skip garbage)
    let headerIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/序号/.test(line) && (/维修项目/.test(line) || /名称/.test(line))) {
            headerIndex = i;
        }
        // Extract Metadata
        if (/(?:维修|承修|客户)单位[:：]?\s*(\S+)/.test(line)) {
            repairUnit = line.match(/(?:维修|承修|客户)单位[:：]?\s*(\S+)/)[1];
        }
        if (/(?:维修|承修|服务)地点[:：]?\s*(\S+)/.test(line)) {
            repairLocation = line.match(/(?:维修|承修|服务)地点[:：]?\s*(\S+)/)[1];
        }
        if (/(?:日期|时间)[:：]?\s*(\S+)/.test(line)) {
            date = line.match(/(?:日期|时间)[:：]?\s*(\S+)/)[1];
        }
        // Expanded Regex for Vehicle (Handles spaces, newlines, etc. roughly)
        // Look for "Vehicle" then capture next non-space token
        if (/(?:维修)?车辆[:：]?\s*(\S+)/.test(line)) {
            vehicle = line.match(/(?:维修)?车辆[:：]?\s*(\S+)/)[1];
        } else if (/(?:维修)?车辆/.test(line) && i + 1 < lines.length) {
            // Check next line if current line ends with label
            const nextLine = lines[i+1];
             if (!/序号|日期/.test(nextLine)) {
                 vehicle = nextLine.split(/\s+/)[0];
             }
        }
    }
    
    const startLine = headerIndex === -1 ? 0 : headerIndex + 1;

    for (let j = startLine; j < lines.length; j++) {
        const r = lines[j].trim();
        if (!r || /^合计/.test(r) || /Total/i.test(r)) break;
        if (/维修车辆/.test(r)) continue; 
        if (/维修单位/.test(r)) continue;
        if (/维修地点/.test(r)) continue;

        // Universal Parsing Logic (Failsafe)
        // Match standard format: Name (text) | Qty (num) | Unit (text) | Price (num) | [MatTotal] | Labor (num) | Spec (text/num)
        
        const cols = r.split(/\s+/).filter(Boolean);
        if (cols.length < 2) continue; // Skip noise

        let spec = '';
        let labor = '0';
        let price = '0';
        let unit = '个';
        let qty = '1';
        let name = '';
        
        // 1. Force Column Mapping Strategy (If columns count matches user expectation)
        // Expected: Name | Qty | Unit | Price | [MatTotal] | Labor | Spec
        // Columns could be: 6 or 7
        
        // Try to identify numeric columns first
        const numIndices = [];
        cols.forEach((c, idx) => {
            if (!isNaN(parseFloat(c)) && isFinite(c)) numIndices.push(idx);
        });

        // Heuristic: User specified exact mapping for numbers
        // 1st number: Sequence (Ignore)
        // 2nd number: Quantity
        // 3rd number: Price
        // 4th number: Material Total (Ignore/Verify)
        // 5th number: Labor Cost (Handwork Total)
        
        if (numIndices.length >= 5) {
             let idxSeq = numIndices[0];
             let idxQty = numIndices[1];
             let idxPrice = numIndices[2];
             let idxMatTotal = numIndices[3]; 
             let idxLabor = numIndices[4];
             
             qty = cols[idxQty];
             price = cols[idxPrice];
             labor = cols[idxLabor];
             
             // Unit: Usually between Qty and Price
             if (idxPrice > idxQty + 1) {
                 unit = cols[idxQty + 1];
             } else {
                 unit = '个';
             }

             // Name: Between Seq and Qty
             if (idxQty > idxSeq + 1) {
                 name = cols.slice(idxSeq + 1, idxQty).join('');
             } else if (idxSeq > 0) {
                 // Try before Seq
                 name = cols.slice(0, idxSeq).join('');
             } else if (idxSeq === 0 && idxQty > 1) {
                  // If Seq is first token, and Qty is later, Name is between.
                  // Handled by first if.
                  // If idxQty is 1 (adjacent to Seq), then name might be missing or merged?
                  // Try to see if there is text at 0 that wasn't parsed as number?
                  // But numIndices says idxSeq=0.
             }
             
             // Spec: After Labor
             if (idxLabor + 1 < cols.length) {
                 spec = cols.slice(idxLabor + 1).join(' ');
             }
             
             items.push({ name, quantity: qty, unit, price, laborCost: labor, spec });
             continue; 
        }
        
        // Fallback for lines with 4 numbers (Maybe Seq is missing, or Labor is missing?)
        // If 4 numbers:
        // Case A: Seq, Qty, Price, MatTotal (Labor missing)
        // Case B: Qty, Price, MatTotal, Labor (Seq missing)
        if (numIndices.length === 4) {
            // Check logic: Qty * Price = MatTotal
            // Test Case A (indices 1, 2, 3) -> val(1)*val(2) == val(3)
            let val1 = parseFloat(cols[numIndices[1]]);
            let val2 = parseFloat(cols[numIndices[2]]);
            let val3 = parseFloat(cols[numIndices[3]]);
            
            if (Math.abs(val1 * val2 - val3) < 1.0) {
                // Matches Case A: Seq(0), Qty(1), Price(2), MatTotal(3)
                // Labor is missing -> 0
                qty = cols[numIndices[1]];
                price = cols[numIndices[2]];
                labor = '0';
                
                // Name between Seq and Qty
                let idxSeq = numIndices[0];
                let idxQty = numIndices[1];
                 if (idxSeq === 0 && idxQty > 1) {
                     name = cols.slice(1, idxQty).join('');
                 }
                 
                 // Spec after MatTotal
                 if (numIndices[3] + 1 < cols.length) {
                     spec = cols.slice(numIndices[3] + 1).join(' ');
                 }
                 
                 items.push({ name, quantity: qty, unit, price, laborCost: labor, spec });
                 continue;
            }
            
            // Test Case B (indices 0, 1, 2) -> val(0)*val(1) == val(2)
            val1 = parseFloat(cols[numIndices[0]]);
            val2 = parseFloat(cols[numIndices[1]]);
            val3 = parseFloat(cols[numIndices[2]]);
            
            if (Math.abs(val1 * val2 - val3) < 1.0) {
                 // Matches Case B: Qty(0), Price(1), MatTotal(2), Labor(3)
                 qty = cols[numIndices[0]];
                 price = cols[numIndices[1]];
                 labor = cols[numIndices[3]];
                 
                 // Name is before Qty (idx 0)
                 if (numIndices[0] > 0) {
                     name = cols.slice(0, numIndices[0]).join('');
                 }
                 
                 // Spec after Labor
                 if (numIndices[3] + 1 < cols.length) {
                     spec = cols.slice(numIndices[3] + 1).join(' ');
                 }
                 
                 items.push({ name, quantity: qty, unit, price, laborCost: labor, spec });
                 continue;
            }
        }


        // Strategy: Anchor on Unit
        const commonUnits = ['个', '套', '桶', '组', '条', '副', '瓶', '升', 'L', 'ML', 'KG', '克', '米', 'M', 'CM', '只', '把', '箱', '盒', '台', '部', '辆'];
        let unitIndex = -1;
        
        // Find Unit Index
        for (let u = cols.length - 1; u >= 0; u--) {
            // Check if exact match to common units
            if (commonUnits.some(cu => cols[u].toLowerCase() === cu.toLowerCase())) {
                unitIndex = u;
                break;
            }
            // Heuristic: If it's a short non-numeric string surrounded by numbers?
            // Risk: "5L" might be parsed as "5" "L"? No, split by space.
        }

        if (unitIndex !== -1) {
            // --- Unit Anchor Strategy ---
            unit = cols[unitIndex];
            
            // Qty is immediately before Unit
            if (unitIndex > 0) {
                qty = cols[unitIndex - 1];
            }
            
            // Name is everything before Qty
            // Handle Seq at start
            let startName = 0;
            if (/^\d+$/.test(cols[0]) && unitIndex > 1) {
                startName = 1;
            }
            if (unitIndex > startName) {
                name = cols.slice(startName, unitIndex - 1).join('');
            }

            // Analyze columns AFTER Unit
            // Expect: Price ... [MatTotal?] ... Labor ... Spec?
            
            let afterUnit = cols.slice(unitIndex + 1);
            let numbersAfter = [];
            
            // Identify numbers after unit
            for(let k=0; k<afterUnit.length; k++) {
                if (!isNaN(parseFloat(afterUnit[k])) && isFinite(afterUnit[k])) {
                    numbersAfter.push({ val: parseFloat(afterUnit[k]), idx: k });
                }
            }

            if (numbersAfter.length > 0) {
                // First number is definitely Price
                price = afterUnit[numbersAfter[0].idx];
                
                // Determine remaining numbers (MatTotal vs Labor)
                if (numbersAfter.length >= 2) {
                    // We have at least 2 more numbers.
                    // Candidates: [MatTotal, Labor] or [Labor, Spec(num)]?
                    // Use CheckSum Strategy: MatTotal = Qty * Price
                    
                    let qVal = parseFloat(qty) || 0;
                    let pVal = parseFloat(price) || 0;
                    let expectedMatTotal = qVal * pVal;
                    
                    let secondNum = numbersAfter[1].val;
                    
                    // Check if second number is MatTotal
                    // Allow small tolerance (0.1)
                    if (Math.abs(secondNum - expectedMatTotal) < 1.0) {
                        // It IS MatTotal. Ignore it.
                        // Next number is Labor
                        if (numbersAfter.length >= 3) {
                             labor = afterUnit[numbersAfter[2].idx];
                        } else {
                             // MatTotal is present, but Labor is missing/0?
                             // Or maybe the line ends here.
                             labor = '0';
                        }
                    } else {
                        // Second number is NOT MatTotal. It must be Labor.
                        // (MatTotal column is missing in PDF)
                        labor = secondNum;
                    }
                } else {
                    // Only 1 number (Price). Labor is missing/0.
                    labor = '0';
                }
                
                // Spec is everything after the last consumed number?
                // Or just the last column if it wasn't consumed.
                // Let's take the text at the very end.
                let lastNumIdxInAfter = numbersAfter[numbersAfter.length - 1].idx;
                // But wait, if we skipped MatTotal, we need to know WHICH number was Labor.
                
                // Refined Spec Extraction:
                // If we identified Labor, everything after Labor is Spec.
                // If we didn't identify Labor (only Price), everything after Price is Spec.
                
                // Let's re-evaluate based on the Logic path:
                let lastConsumedIdx = numbersAfter[0].idx; // Price
                
                if (numbersAfter.length >= 2) {
                     let qVal = parseFloat(qty) || 0;
                     let pVal = parseFloat(price) || 0;
                     let expectedMatTotal = qVal * pVal;
                     let secondNum = numbersAfter[1].val;
                     
                     if (Math.abs(secondNum - expectedMatTotal) < 1.0) {
                         // Consumed MatTotal (idx 1)
                         lastConsumedIdx = numbersAfter[1].idx;
                         if (numbersAfter.length >= 3) {
                             // Consumed Labor (idx 2)
                             lastConsumedIdx = numbersAfter[2].idx;
                         }
                     } else {
                         // Consumed Labor (idx 1)
                         lastConsumedIdx = numbersAfter[1].idx;
                     }
                }
                
                // Spec is everything after lastConsumedIdx
                if (lastConsumedIdx + 1 < afterUnit.length) {
                    spec = afterUnit.slice(lastConsumedIdx + 1).join(' ');
                }
            } else {
                // No numbers after Unit? Price missing?
                // Unlikely for valid line.
            }
            
        } else {
            // --- Fallback: No Unit Found ---
            // Use Numeric Islands + CheckSum
            
            let numberIndices = [];
            for(let k=0; k<cols.length; k++) {
                if (!isNaN(parseFloat(cols[k])) && isFinite(cols[k])) {
                    numberIndices.push(k);
                }
            }
            
            if (numberIndices.length >= 2) {
                // Assume structure: ... Qty ... Price ... [MatTotal] ... [Labor] ...
                
                // Try to find a pair (Qty, Price) that predicts a subsequent number (MatTotal)
                // Iterate through pairs of numbers
                let foundPattern = false;
                
                for (let i = 0; i < numberIndices.length - 1; i++) {
                    let idx1 = numberIndices[i];
                    let idx2 = numberIndices[i+1];
                    
                    // Only consider if they are relatively close (maybe separated by Unit?)
                    if (idx2 - idx1 > 2) continue; 
                    
                    let qVal = parseFloat(cols[idx1]);
                    let pVal = parseFloat(cols[idx2]);
                    let expectedMatTotal = qVal * pVal;
                    
                    // Look for MatTotal in subsequent numbers
                    let matchIdx = -1;
                    for (let j = i + 2; j < numberIndices.length; j++) {
                         let idx3 = numberIndices[j];
                         let val3 = parseFloat(cols[idx3]);
                         if (Math.abs(val3 - expectedMatTotal) < 1.0) {
                             matchIdx = j;
                             break;
                         }
                    }
                    
                    if (matchIdx !== -1) {
                        // Found Qty, Price, MatTotal pattern!
                        qty = cols[idx1];
                        price = cols[idx2];
                        // MatTotal is at matchIdx (ignore)
                        
                        // Labor is the number AFTER MatTotal?
                        if (matchIdx + 1 < numberIndices.length) {
                            labor = cols[numberIndices[matchIdx + 1]];
                        }
                        
                        // Name is before Qty
                        let startName = 0;
                        if (/^\d+$/.test(cols[0]) && idx1 > 1) startName = 1;
                        if (idx1 > startName) name = cols.slice(startName, idx1).join(''); // Usually Unit is between Qty/Price?
                        
                        // Wait, if Unit is missing, Qty/Price might be adjacent.
                        // If Unit exists but wasn't in our list, it might be between idx1 and idx2.
                        if (idx2 - idx1 === 2) {
                            unit = cols[idx1 + 1];
                        }
                        
                        // Spec is after Labor (or after MatTotal if Labor missing)
                        let lastIdx = (matchIdx + 1 < numberIndices.length) ? numberIndices[matchIdx + 1] : numberIndices[matchIdx];
                        if (lastIdx + 1 < cols.length) {
                            spec = cols.slice(lastIdx + 1).join(' ');
                        }
                        
                        foundPattern = true;
                        break;
                    }
                }
                
                if (!foundPattern) {
                    // No CheckSum match. Assume standard order without MatTotal.
                    // ... Qty ... Unit ... Price ... Labor ... Spec
                    // Map from right to left using standard positions
                    
                    let ptr = cols.length - 1;
                    
                    // 1. Spec (if not number)
                    if (isNaN(parseFloat(cols[ptr]))) {
                        spec = cols[ptr];
                        ptr--;
                    }
                    
                    // 2. Labor (Number)
                    if (ptr >= 0 && !isNaN(parseFloat(cols[ptr]))) {
                        labor = cols[ptr];
                        ptr--;
                    }
                    
                    // 3. Price (Number)
                    if (ptr >= 0 && !isNaN(parseFloat(cols[ptr]))) {
                        price = cols[ptr];
                        ptr--;
                    }
                    
                    // 4. Unit (Text)
                    if (ptr >= 0) {
                        unit = cols[ptr];
                        ptr--;
                    }
                    
                    // 5. Qty (Number)
                    if (ptr >= 0 && !isNaN(parseFloat(cols[ptr]))) {
                        qty = cols[ptr];
                        ptr--;
                    }
                    
                    // 6. Name
                    let startName = 0;
                    if (/^\d+$/.test(cols[0])) startName = 1;
                    if (ptr >= startName) {
                        name = cols.slice(startName, ptr + 1).join('');
                    }
                }
            } else {
                // Less than 2 numbers. Hard to parse.
                // Just take whole line as name?
                name = cols.join(' ');
            }
        }

        if (name && name.length > 0) { 
             items.push({
              name: name,
              quantity: qty || '1',
              unit: unit || '个',
              price: price || '0',
              laborCost: labor || '0',
              spec: spec || ''
            });
        }
    }

    */
    return { success: true, data: { vehicle, items, rawText: text, repairUnit, repairLocation, date } };
  } catch (e) {
    return { success: true, data: { vehicle: '', items: [], rawText: '', repairUnit: '', repairLocation: '', date: '' } };
  }
}

async function handleEmbedImages(data) {
  const { vehicle, date, items, description, imageFileIDs, excelHeader, repairUnit, repairLocation } = data || {};
  
  if (Array.isArray(imageFileIDs) && imageFileIDs.length > 0) {
      await trackFiles(imageFileIDs);
  }

  const images = [];
  
  // Safe Image Loading Strategy: Limit Total Size to prevent OOM
   const MAX_TOTAL_SIZE = 10 * 1024 * 1024; // 10MB Limit for safety
   let currentTotalSize = 0;

  if (Array.isArray(imageFileIDs)) {
    for (const fid of imageFileIDs) {
      try {
        const d = await cloud.downloadFile({ fileID: fid });
        if (d.fileContent) {
            const size = d.fileContent.length;
            if (currentTotalSize + size > MAX_TOTAL_SIZE) {
                console.warn('Skipping image due to size limit:', fid);
                continue; // Skip this image to save memory
            }
            currentTotalSize += size;
            const b64 = d.fileContent.toString('base64');
            images.push('data:image/jpeg;base64,' + b64);
        }
      } catch (e) {
        console.error('Image download failed:', e);
      }
    }
  }

  // Images Logic: Prepare grid to put INSIDE the Description cell
  const descriptionContent = [];
  const descText = (description || '').trim();
  if (descText) {
    descriptionContent.push({ text: descText, margin: [0, 0, 0, 10] });
  }

  if (images.length > 0) {
      const imageRows = [];
      let currentRow = [];
      const cols = 4; // 4 columns for compact layout
      
      images.forEach((img) => {
          currentRow.push({ 
              image: img, 
              fit: [95, 95],
              margin: [2, 5, 2, 5],
              alignment: 'center',
              verticalAlignment: 'middle'
          });
          if (currentRow.length === cols) {
              imageRows.push(currentRow);
              currentRow = [];
          }
      });
      if (currentRow.length > 0) {
          while (currentRow.length < cols) {
              currentRow.push({ text: '', alignment: 'center', verticalAlignment: 'middle' }); // Fill remaining cells
          }
          imageRows.push(currentRow);
      }
      
      // Chunk rows to avoid overly large single table
      const rowsPerTable = 6;
      for (let start = 0; start < imageRows.length; start += rowsPerTable) {
        const chunk = imageRows.slice(start, start + rowsPerTable);
        descriptionContent.push({
          table: {
            widths: ['*', '*', '*', '*'],
            body: chunk
          },
          layout: {
            hLineWidth: function () { return 0.5; },
            vLineWidth: function () { return 0.5; },
            hLineColor: function () { return 'black'; },
            vLineColor: function () { return 'black'; },
            paddingTop: function() { return 4; },
            paddingBottom: function() { return 4; },
            paddingLeft: function() { return 4; },
            paddingRight: function() { return 4; }
          }
        });
      }
  }

  if (descriptionContent.length === 0) {
    descriptionContent.push({ text: ' ', margin: [0, 0, 0, 10] });
  }

  const headerNames = ['序号', '维修项目', '数量', '单位', '配件单价\n(元)', '手工\n(次)', '手工费单价\n(元/次)', '备注'];
  const tableBody = [
    headerNames.map(h => ({ text: h, style: 'tableHeader', verticalAlignment: 'middle' }))
  ];
  let total = 0;
  (items || []).forEach((item, index) => {
    const amounts = computeItemAmounts(item || {});
    total += amounts.subtotal;
    tableBody.push([
      { text: (index + 1).toString(), alignment: 'center', verticalAlignment: 'middle' },
      { text: item.name || '', alignment: 'center', verticalAlignment: 'middle' },
      { text: String(amounts.qty || ''), alignment: 'center', verticalAlignment: 'middle' },
      { text: item.unit || '', alignment: 'center', verticalAlignment: 'middle' },
      { text: formatMoney(amounts.price), alignment: 'center', verticalAlignment: 'middle' },
      { text: amounts.handCount ? String(amounts.handCount) : '', alignment: 'center', verticalAlignment: 'middle' },
      { text: formatMoney(amounts.laborUnitPrice), alignment: 'center', verticalAlignment: 'middle' },
      { text: item.spec || '', alignment: 'center', verticalAlignment: 'middle' }
    ]);
  });
  const minRows = 15;
  const currentRows = (items || []).length;
  if (currentRows < minRows) {
    for (let i = 0; i < (minRows - currentRows); i++) {
      tableBody.push([
        { text: '', alignment: 'center', verticalAlignment: 'middle' },
        { text: '', alignment: 'center', verticalAlignment: 'middle' },
        { text: '', alignment: 'center', verticalAlignment: 'middle' },
        { text: '', alignment: 'center', verticalAlignment: 'middle' },
        { text: '', alignment: 'center', verticalAlignment: 'middle' },
        { text: '', alignment: 'center', verticalAlignment: 'middle' },
        { text: '', alignment: 'center', verticalAlignment: 'middle' },
        { text: '', alignment: 'center', verticalAlignment: 'middle' }
      ]);
    }
  }
  tableBody.push([{ text: '合计：' + formatCompact(total) + '元', colSpan: 8, alignment: 'center', bold: true, verticalAlignment: 'middle' }, {}, {}, {}, {}, {}, {}, {}]);
  const mainTable = {
    table: { headerRows: 1, widths: [30, '*', 30, 30, 40, 28, 55, 42], body: tableBody },
    layout: {
      hLineWidth: function (i, node) { return 0.5; },
      vLineWidth: function (i, node) { return 0.5; },
      hLineColor: function (i, node) { return 'black'; },
      vLineColor: function (i, node) { return 'black'; },
      paddingLeft: function(i, node) { return 2; },
      paddingRight: function(i, node) { return 2; },
      paddingTop: function(i, node) { return 8; },
      paddingBottom: function(i, node) { return 8; }
    }
  };
  const outerTableBody = [[{ text: '维修项目', alignment: 'center', verticalAlignment: 'middle', fontSize: 12, bold: true }, mainTable]];
  // Build single outer table: title + metadata + main table + description in one frame
  const outerBody = [];
  outerBody.push([{ text: '维修验收单', style: 'header', alignment: 'center', verticalAlignment: 'middle', colSpan: 2 }, {}]);
  outerBody.push([{ text: '维修车辆', style: 'tableHeader', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }, { text: vehicle || '', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }]);
  outerBody.push([{ text: '维修单位', style: 'tableHeader', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }, { text: (repairUnit || ''), alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }]);
  outerBody.push([{ text: '维修地点', style: 'tableHeader', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }, { text: (repairLocation || ''), alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }]);
  const displayDateAcc = date ? dayjs(date).format('YYYY-MM-DD') : '';
  if (displayDateAcc) {
      outerBody.push([{ text: '日期', style: 'tableHeader', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }, { text: displayDateAcc, alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }]);
  }
  const headerNamesAcc = ['序号', '维修项目', '数量', '单位', '配件单价\n(元)', '手工\n(次)', '手工费单价\n(元/次)', '备注'];
  const dataRowCountAcc = Math.max((items || []).length, 15);
  const targetRowIndexAcc = Math.ceil(dataRowCountAcc / 2) - 1;
  const halfRowMarginAcc = (dataRowCountAcc % 2 === 0) ? 12 : 0;
  const combinedBodyAcc = [];
  combinedBodyAcc.push([
    { text: '', alignment: 'center', verticalAlignment: 'middle', border: [true, false, true, false] },
    ...headerNamesAcc.map(h => ({ text: h, style: 'tableHeader', verticalAlignment: 'middle' }))
  ]);
  let runningTotalAcc = 0;
  for (let r = 0; r < dataRowCountAcc; r++) {
    const ir = r < (items || []).length ? items[r] : null;
    const amountsAcc = ir ? computeItemAmounts(ir) : null;
    if (amountsAcc) {
      runningTotalAcc += amountsAcc.subtotal;
    }
    combinedBodyAcc.push([
      { 
        text: r === targetRowIndexAcc ? '维修项目' : '', 
        alignment: 'center', 
        verticalAlignment: 'middle',
        border: [true, false, true, false],
        margin: r === targetRowIndexAcc ? [0, halfRowMarginAcc, 0, 0] : [0, 0, 0, 0],
        fontSize: r === targetRowIndexAcc ? 12 : 10,
        bold: r === targetRowIndexAcc ? true : false
      },
      { 
        text: (ir && String(ir.name || '').trim()) ? (r + 1).toString() : '', 
        alignment: 'center', 
        verticalAlignment: 'middle' 
      },
      { text: ir ? (ir.name || '') : '', alignment: 'center', verticalAlignment: 'middle' },
      { text: ir && amountsAcc ? String(amountsAcc.qty || '') : '', alignment: 'center', verticalAlignment: 'middle' },
      { text: ir ? (ir.unit || '') : '', alignment: 'center', verticalAlignment: 'middle' },
      { text: ir && amountsAcc ? formatMoney(amountsAcc.price) : '', alignment: 'center', verticalAlignment: 'middle' },
      { text: ir && amountsAcc && amountsAcc.handCount ? String(amountsAcc.handCount) : '', alignment: 'center', verticalAlignment: 'middle' },
      { text: ir && amountsAcc ? formatMoney(amountsAcc.laborUnitPrice) : '', alignment: 'center', verticalAlignment: 'middle' },
      { text: ir ? (ir.spec || '') : '', alignment: 'center', verticalAlignment: 'middle' }
    ]);
  }
  // Add Total row per request
  combinedBodyAcc.push([{ text: '总计：' + formatMoney(runningTotalAcc), colSpan: 9, alignment: 'center', bold: true, verticalAlignment: 'middle' }, {}, {}, {}, {}, {}, {}, {}, {}]);
  
  // Add signatures to the last row of the table - REMOVED per request to move it to outer table


  const combinedMainTableAcc = {
    table: { headerRows: 1, widths: [80, 30, '*', 30, 30, 40, 28, 55, 42], body: combinedBodyAcc },
    layout: {
      hLineWidth: function (i, node) { return 0.5; },
      vLineWidth: function (i, node) { return 0.5; },
      hLineColor: function (i, node) { return 'black'; },
      vLineColor: function (i, node) { return 'black'; },
      paddingLeft: function(i, node) { return 2; },
      paddingRight: function(i, node) { return 2; },
      paddingTop: function(i, node) { return 8; },
      paddingBottom: function(i, node) { return 8; }
    }
  };
  outerBody.push([{ ...combinedMainTableAcc, colSpan: 2 }, {}]);
  // Removed separate signature table as it is now inside the main table
  
  outerBody.push([{ text: '验收情况说明：', style: 'tableHeader', alignment: 'center', verticalAlignment: 'middle' }, { stack: descriptionContent, alignment: 'center', verticalAlignment: 'middle' }]);
  // Add signatures to the last row of the outer table (below description)
  outerBody.push([{
    colSpan: 2,
    table: {
      widths: [110, '*'],
      body: [[
        { text: '验收人:', alignment: 'left', verticalAlignment: 'middle', border: [false,false,true,false], margin: [6,6,0,6] },
        { text: '审核人:', alignment: 'center', verticalAlignment: 'middle', border: [false,false,false,false], margin: [6,6,0,6] }
      ]]
    },
    layout: {
      hLineWidth: function() { return 0; },
      vLineWidth: function() { return 0; },
      paddingLeft: function() { return 0; },
      paddingRight: function() { return 0; },
      paddingTop: function() { return 0; },
      paddingBottom: function() { return 0; }
    }
  }, {}]);
  // Removed Note row per request
  const content = [
    {
      table: { widths: [80, '*'], body: outerBody },
      layout: {
        hLineWidth: function (i, node) { return 0.5; },
        vLineWidth: function (i, node) { return 0.5; },
        hLineColor: function (i, node) { return 'black'; },
        vLineColor: function (i, node) { return 'black'; },
        paddingTop: function(i, node) { return 0; },
        paddingBottom: function(i, node) { return 0; },
        paddingLeft: function(i, node) { return 0; },
        paddingRight: function(i, node) { return 0; }
      }
    }
  ];
  const docDefinition = {
    content,
    defaultStyle: {
      font: hasSimSunFont ? 'SimSun' : (hasCustomFont ? 'SimHei' : 'Roboto'),
      fontSize: 10
    },
    styles: {
      header: { fontSize: 18, bold: true },
      tableHeader: { bold: true, fontSize: 10, alignment: 'center' }
    }
  };
  let pdfBuffer;
  try {
    pdfBuffer = await generatePDF(docDefinition);
  } catch (e1) {
    const imgsA = images.slice(0, 8); // Retry with fewer images (8)
    const imageRowsA = [];
    let currentRowA = [];
    const colsA = 4;
    imgsA.forEach((img) => {
      currentRowA.push({ image: img, fit: [85, 85], margin: [2,5,2,5], alignment: 'center', verticalAlignment: 'middle' });
      if (currentRowA.length === colsA) {
        imageRowsA.push(currentRowA);
        currentRowA = [];
      }
    });
    if (currentRowA.length > 0) {
      while (currentRowA.length < colsA) currentRowA.push({ text: '', alignment: 'center', verticalAlignment: 'middle' });
      imageRowsA.push(currentRowA);
    }
    const descriptionContentA = [];
    const descTextA = (description || '').trim();
    if (descTextA) descriptionContentA.push({ text: descTextA, margin: [0,0,0,10] });
    if (imageRowsA.length > 0) {
      descriptionContentA.push({
        table: { widths: ['*','*','*','*'], body: imageRowsA },
        layout: { hLineWidth: function(){return 0.5;}, vLineWidth: function(){return 0.5;}, hLineColor: function(){return 'black';}, vLineColor: function(){return 'black';}, paddingTop: function(){return 4;}, paddingBottom: function(){return 4;}, paddingLeft: function(){return 4;}, paddingRight: function(){return 4;} }
      });
    }
    if (descriptionContentA.length === 0) {
      descriptionContentA.push({ text: ' ', margin: [0,0,0,10] });
    }
    const outerBodyA = [];
    outerBodyA.push([{ text: '维修验收单', style: 'header', alignment: 'center', verticalAlignment: 'middle', colSpan: 2 }, {}]);
    outerBodyA.push([{ text: '维修车辆', style: 'tableHeader', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }, { text: vehicle || '', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }]);
    outerBodyA.push([{ text: '维修单位', style: 'tableHeader', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }, { text: (repairUnit || ''), alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }]);
    outerBodyA.push([{ text: '维修地点', style: 'tableHeader', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }, { text: (repairLocation || ''), alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }]);
    const displayDateAccA = date ? dayjs(date).format('YYYY-MM-DD') : '';
    if (displayDateAccA) {
        outerBodyA.push([{ text: '日期', style: 'tableHeader', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }, { text: displayDateAccA, alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }]);
    }
    outerBodyA.push([{ ...combinedMainTableAcc, colSpan: 2 }, {}]);
    // Removed duplicate signatures
    outerBodyA.push([{ text: '验收情况说明：', style: 'tableHeader', alignment: 'center', verticalAlignment: 'middle' }, { stack: descriptionContentA, alignment: 'center', verticalAlignment: 'middle' }]);
    // Add signatures to the last row of the outer table (below description)
    outerBodyA.push([{
      colSpan: 2,
      table: {
        widths: [110, '*'],
        body: [[
          { text: '验收人:', alignment: 'left', verticalAlignment: 'middle', border: [false,false,true,false], margin: [6,6,0,6] },
          { text: '审核人:', alignment: 'center', verticalAlignment: 'middle', border: [false,false,false,false], margin: [6,6,0,6] }
        ]]
      },
      layout: {
        hLineWidth: function() { return 0; },
        vLineWidth: function() { return 0; },
        paddingLeft: function() { return 0; },
        paddingRight: function() { return 0; },
        paddingTop: function() { return 0; },
        paddingBottom: function() { return 0; }
      }
    }, {}]);
    // Removed duplicate note
    const contentA = [{ table: { widths: [80, '*'], body: outerBodyA }, layout: { hLineWidth: function(i,node){return 0.5;}, vLineWidth: function(i,node){return 0.5;}, hLineColor: function(i,node){return 'black';}, vLineColor: function(i,node){return 'black';}, paddingTop: function(i,node){return 0;}, paddingBottom: function(i,node){return 0;}, paddingLeft: function(i,node){return 0;}, paddingRight: function(i,node){return 0;} } }];
    const docDefinitionA = { content: contentA, defaultStyle: { font: hasSimSunFont ? 'SimSun' : (hasCustomFont ? 'SimHei' : 'Roboto'), fontSize: 10 }, styles: { header: { fontSize: 18, bold: true }, tableHeader: { bold: true, fontSize: 10, alignment: 'center' } } };
    try {
      pdfBuffer = await generatePDF(docDefinitionA);
    } catch (e2) {
      const imgsB = images.slice(0, 2); // Final retry with minimal images (2)
      const imageRowsB = [];
      let currentRowB = [];
      const colsB = 4;
      imgsB.forEach((img) => {
        currentRowB.push({ image: img, fit: [85, 85], margin: [2,5,2,5], alignment: 'center', verticalAlignment: 'middle' });
        if (currentRowB.length === colsB) {
          imageRowsB.push(currentRowB);
          currentRowB = [];
        }
      });
      if (currentRowB.length > 0) {
        while (currentRowB.length < colsB) currentRowB.push({ text: '', alignment: 'center', verticalAlignment: 'middle' });
        imageRowsB.push(currentRowB);
      }
      const descriptionContentB = [];
      const descTextB = (description || '').trim();
      if (descTextB) descriptionContentB.push({ text: descTextB, margin: [0,0,0,10] });
      if (imageRowsB.length > 0) {
        descriptionContentB.push({
          table: { widths: ['*','*','*','*'], body: imageRowsB },
          layout: { hLineWidth: function(){return 0.5;}, vLineWidth: function(){return 0.5;}, hLineColor: function(){return 'black';}, vLineColor: function(){return 'black';}, paddingTop: function(){return 4;}, paddingBottom: function(){return 4;}, paddingLeft: function(){return 4;}, paddingRight: function(){return 4;} }
        });
      }
      if (descriptionContentB.length === 0) {
        descriptionContentB.push({ text: ' ', margin: [0,0,0,10] });
      }
      const outerBodyB = [];
      outerBodyB.push([{ text: '维修验收单', style: 'header', alignment: 'center', verticalAlignment: 'middle', colSpan: 2 }, {}]);
      outerBodyB.push([{ text: '维修车辆', style: 'tableHeader', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }, { text: vehicle || '', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }]);
      outerBodyB.push([{ text: '维修单位', style: 'tableHeader', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }, { text: (repairUnit || ''), alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }]);
      outerBodyB.push([{ text: '维修地点', style: 'tableHeader', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }, { text: (repairLocation || ''), alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }]);
      const displayDateAccB = date ? dayjs(date).format('YYYY-MM-DD') : '';
      if (displayDateAccB) {
          outerBodyB.push([{ text: '日期', style: 'tableHeader', alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }, { text: displayDateAccB, alignment: 'center', verticalAlignment: 'middle', margin: [0,6,0,6] }]);
      }
      outerBodyB.push([{ ...combinedMainTableAcc, colSpan: 2 }, {}]);
      // Removed duplicate signatures
      outerBodyB.push([{ text: '验收情况说明：', style: 'tableHeader', alignment: 'center', verticalAlignment: 'middle' }, { stack: descriptionContentB, alignment: 'center', verticalAlignment: 'middle' }]);
      // Add signatures to the last row of the outer table (below description)
      outerBodyB.push([{
        colSpan: 2,
        table: {
          widths: [110, '*'],
          body: [[
            { text: '验收人:', alignment: 'left', verticalAlignment: 'middle', border: [false,false,true,false], margin: [6,6,0,6] },
            { text: '审核人:', alignment: 'center', verticalAlignment: 'middle', border: [false,false,false,false], margin: [6,6,0,6] }
          ]]
        },
        layout: {
          hLineWidth: function() { return 0; },
          vLineWidth: function() { return 0; },
          paddingLeft: function() { return 0; },
          paddingRight: function() { return 0; },
          paddingTop: function() { return 0; },
          paddingBottom: function() { return 0; }
        }
      }, {}]);
      // Removed duplicate note
      const contentB = [{ table: { widths: [80, '*'], body: outerBodyB }, layout: { hLineWidth: function(i,node){return 0.5;}, vLineWidth: function(i,node){return 0.5;}, hLineColor: function(i,node){return 'black';}, vLineColor: function(i,node){return 'black';}, paddingTop: function(i,node){return 0;}, paddingBottom: function(i,node){return 0;}, paddingLeft: function(i,node){return 0;}, paddingRight: function(i,node){return 0;} } }];
      const docDefinitionB = { content: contentB, defaultStyle: { font: hasSimSunFont ? 'SimSun' : (hasCustomFont ? 'SimHei' : 'Roboto'), fontSize: 10 }, styles: { header: { fontSize: 18, bold: true }, tableHeader: { bold: true, fontSize: 10, alignment: 'center' } } };
      pdfBuffer = await generatePDF(docDefinitionB);
    }
  }
  const uploadResult = await cloud.uploadFile({
    cloudPath: (() => {
      const docTitle = '维修验收单';
      const plate = String(vehicle || '').replace(/[^0-9A-Za-z\u4e00-\u9fa5]/g, '');
      const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
      return `embed/${docTitle}-${plate}-${letter}.pdf`;
    })(),
    fileContent: pdfBuffer
  });
  await trackFiles(uploadResult.fileID);
  const docTitle = '维修验收单';
  const plate = String(vehicle || '').replace(/[^0-9A-Za-z\u4e00-\u9fa5]/g, '');
  const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const fileName = `${docTitle}-${plate}-${letter}.pdf`;
  return { success: true, fileID: uploadResult.fileID, fileName };
}

async function handleGeneratePerformanceLetter(data) {
    const { toCompany, projectContent, projectCode, date } = data || {};
    
    // Default values if not provided (though frontend validates)
    const company = toCompany || '光大环保能源(九江)有限公司';
    // Remove hardcoded project code from default content as it's now handled separately
    const contentText = projectContent || '2026年度叉车、装载机、自卸车维护保养服务';
    const codeStr = projectCode ? `(${projectCode})` : '';

    const dateStr = date || dayjs().format('YYYY-MM-DD');

    const year = dateStr.split(/[-./]/)[0];
    const month = dateStr.split(/[-./]/)[1];
    const day = dateStr.split(/[-./]/)[2];
    const formattedDate = `${year}年${month}月${day}日`;

    const stampPath = path.join(__dirname, 'stamp.png');
    const hasStamp = fs.existsSync(stampPath);

    const signatureStack = [
        { text: '九江星晶汽车服务有限公司', alignment: 'right', fontSize: 14, margin: [0, 0, 20, 10] }, // Adjusted company name based on image "九江星晶..."
        { text: formattedDate, alignment: 'right', fontSize: 14, margin: [0, 0, 20, 0] }
    ];
    
    // Append stamp directly to content flow but with negative margin to overlap
    if (hasStamp) {
        signatureStack.push({
            image: stampPath,
            width: 140,
            alignment: 'right',
            opacity: 0.8,
            margin: [0, -80, 20, 0] // Move up to overlap date
        });
    }

    const docDefinition = {
        content: [
            { text: '履约能力确认函', style: 'header', alignment: 'center', margin: [0, 0, 0, 30] },
            { text: `${company}:`, fontSize: 14, margin: [0, 0, 0, 10] },
            { 
                text: [
                    { text: '占位', color: 'white', opacity: 0 }, // Hidden placeholder for indentation
                    `很荣幸能参加贵单位组织的${contentText}${codeStr}，我方已收到贵司发送的《履约能力确认函》，我方确认并有能力承诺，将严格按照招标文件服务内容开展该项目。`
                ],
                fontSize: 14, 
                lineHeight: 2,
                margin: [0, 0, 0, 50]
            },
            {
                stack: signatureStack,
                alignment: 'right'
            }
        ],
        defaultStyle: {
            font: hasSimSunFont ? 'SimSun' : (hasCustomFont ? 'SimHei' : 'Roboto'),
            fontSize: 12
        },
        styles: {
            header: {
                fontSize: 22,
                bold: true
            }
        }
    };

    const pdfBuffer = await generatePDF(docDefinition);

    // Fallback to Cloud Storage upload because direct Base64 return exceeds 1MB limit
    const fileName = `履约能力确认函.pdf`;
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const cloudPath = `performance/履约能力确认函_${timestamp}_${randomStr}.pdf`;
    
    const uploadResult = await cloud.uploadFile({
        cloudPath: cloudPath,
        fileContent: pdfBuffer
    });
    
    await trackFiles(uploadResult.fileID);

    return { success: true, fileID: uploadResult.fileID, fileName };
}

exports.computeItemAmounts = computeItemAmounts;
