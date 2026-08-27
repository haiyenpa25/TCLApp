/**
 * Database Utils — Tiệm Của Lá v3.4 (Optimized Engine)
 * Encoding: UTF-8
 * 
 * Áp dụng các quy tắc tối ưu hiệu năng Google Apps Script:
 * 1. Batch Write: Ghi toàn bộ hàng bằng setValues() 1 lần duy nhất thay vì setValue() từng ô.
 * 2. In-memory processing: Xử lý dữ liệu trong RAM trước khi tương tác với Spreadsheet.
 * 3. Smart Cache Invalidation: Tự động xóa cache tương ứng sau khi write.
 */

// ── Sheet Name Constants ───────────────────────────────────────────────────────
const SHEETS = {
  PRODUCTS:        'Products',
  TOPPINGS:        'Toppings',
  ORDERS:          'Orders',
  ORDER_DETAILS:   'Order_Details',
  TABLES:          'Tables',
  EXPENSES:        'Expenses',
  CUSTOMERS:       'Customers',
  STAFF:           'Staff',
  TASK_TEMPLATES:  'TaskTemplates',
  TASK_INSTANCES:  'TaskInstances',
  PAYMENTS:        'Payments',
  POINT_LEDGER:    'CustomerPointLedger',
  TABLE_SESSIONS:  'TableSessions',
};

const DB_CACHE_TIMEOUT = 300; // 5 phút (seconds)

const SPREADSHEET_ID = '1co9xhrZFdYi649Dl1OrWDuRAwbs4HsCoPTlt6i9QYw4';

function getSpreadsheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss && ss.getId()) return ss;
  } catch (e) {}
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * Lấy Sheet object theo tên.
 * @param {string} sheetName - Tên sheet (nên dùng SHEETS.XXX)
 * @returns {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
function getSheet(sheetName) {
  return getSpreadsheet().getSheetByName(sheetName);
}

/**
 * Đọc toàn bộ dữ liệu của một sheet thành mảng object.
 * Hàng đầu tiên là header, các hàng tiếp theo là data.
 * @param {string} sheetName - Tên sheet
 * @param {boolean} useCache - Có dùng cache không (mặc định: true)
 * @returns {Object[]} Mảng các row object
 */
function getSheetData(sheetName, useCache = true) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'TCL_DB_' + sheetName;

  if (useCache) {
    const cachedData = cache.get(cacheKey);
    if (cachedData) return JSON.parse(cachedData);
  }

  const sheet = getSheet(sheetName);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; // Chỉ có header hoặc rỗng

  const headers = data[0];
  const tz = Session.getScriptTimeZone();
  const result = data.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, i) => {
      var val = row[i];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, tz, 'yyyy-MM-dd HH:mm:ss');
      } else if (typeof val === 'string' && /^\d{1,3}(\.\d{3})+$/.test(val.trim())) {
        val = parseFloat(val.replace(/\./g, ''));
      }
      obj[header] = val;
    });
    return obj;
  });

  if (useCache) {
    try {
      const jsonStr = JSON.stringify(result);
      if (jsonStr.length < 95000) {
        cache.put(cacheKey, jsonStr, DB_CACHE_TIMEOUT);
      }
    } catch (e) {
      Logger.log('[Cache Warning] ' + e.message);
    }
  }
  return result;
}

/**
 * Thêm 1 hàng mới vào sheet, tự map theo header.
 * @param {string} sheetName - Tên sheet
 * @param {Object} dataObj - Dữ liệu cần thêm (key = tên cột)
 */
function appendRowToSheet(sheetName, dataObj) {
  const sheet = getSheet(sheetName);
  if (!sheet) throw new Error('Sheet không tìm thấy: ' + sheetName);

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rowData = headers.map(header => dataObj[header] !== undefined ? dataObj[header] : '');
  sheet.appendRow(rowData);
  invalidateCache(sheetName);
}

/**
 * Thêm nhiều hàng mới vào sheet trong 1 lần gọi setValues duy nhất (Batch Insert).
 * @param {string} sheetName - Tên sheet
 * @param {Object[]} dataObjects - Danh sách đối tượng cần thêm
 */
function appendRowsToSheet(sheetName, dataObjects) {
  if (!dataObjects || dataObjects.length === 0) return;
  const sheet = getSheet(sheetName);
  if (!sheet) throw new Error('Sheet không tìm thấy: ' + sheetName);

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rowsData = dataObjects.map(obj => 
    headers.map(header => obj[header] !== undefined ? obj[header] : '')
  );

  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, rowsData.length, headers.length).setValues(rowsData);
  invalidateCache(sheetName);
}

/**
 * TỐI ƯU P0: Cập nhật 1 hàng trong sheet theo ID bằng 1 lần setValues() duy nhất.
 * Không gọi setValue() trong vòng lặp từng cột.
 * @param {string} sheetName - Tên sheet
 * @param {string} idColumnName - Tên cột ID để tìm
 * @param {*} idValue - Giá trị ID cần tìm
 * @param {Object} updateObj - Các field cần cập nhật
 * @returns {boolean} true nếu tìm thấy và cập nhật thành công
 */
function updateRowInSheet(sheetName, idColumnName, idValue, updateObj) {
  const sheet = getSheet(sheetName);
  if (!sheet) throw new Error('Sheet không tìm thấy: ' + sheetName);

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return false;

  const headers = data[0];
  const idIndex = headers.indexOf(idColumnName);
  if (idIndex === -1) throw new Error('Cột ID không tìm thấy: ' + idColumnName);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIndex]) === String(idValue)) {
      // Tạo toàn bộ dòng mới trong RAM
      const updatedRow = headers.map((header, colIndex) => {
        if (updateObj[header] !== undefined) {
          return updateObj[header];
        }
        return data[i][colIndex];
      });

      // Ghi lại 1 lần duy nhất bằng setValues([updatedRow])
      sheet.getRange(i + 1, 1, 1, updatedRow.length).setValues([updatedRow]);
      invalidateCache(sheetName);
      return true;
    }
  }
  return false;
}

/**
 * Xóa 1 hàng trong sheet theo ID.
 * @param {string} sheetName - Tên sheet
 * @param {string} idColumnName - Tên cột ID
 * @param {*} idValue - Giá trị ID cần xóa
 * @returns {boolean} true nếu tìm thấy và xóa thành công
 */
function deleteRowFromSheet(sheetName, idColumnName, idValue) {
  const sheet = getSheet(sheetName);
  if (!sheet) throw new Error('Sheet không tìm thấy: ' + sheetName);

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return false;

  const idCol = data[0].indexOf(idColumnName);
  if (idCol === -1) throw new Error('Cột ID không tìm thấy: ' + idColumnName);

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idCol]) === String(idValue)) {
      sheet.deleteRow(i + 1);
      invalidateCache(sheetName);
      return true;
    }
  }
  return false;
}

/**
 * Xóa cache của 1 sheet (gọi sau khi write).
 * @param {string} sheetName - Tên sheet cần xóa cache
 */
function invalidateCache(sheetName) {
  try {
    CacheService.getScriptCache().remove('TCL_DB_' + sheetName);
  } catch (e) {
    Logger.log('[Cache Invalidate Warning] ' + e.message);
  }
}
