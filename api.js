/**
 * API v3.4 (Optimized Engine) — Tiệm Của Lá Full POS
 * 
 * Áp dụng các tối ưu hiệu năng cao:
 * 1. O(N+M) Map Hash Indexing: Gom nhóm chi tiết đơn hàng bằng Map thay cho .filter() quét lồng nhau.
 * 2. Targeted Lock Concurrency: Sử dụng LockService với tryLock(2500) và try/finally bảo vệ giao dịch ghi.
 * 3. Batch Writes: Dùng appendRowsToSheet và setValues() hàng loạt.
 * 4. Entity Returns: Trả về đối tượng vừa lưu giúp Frontend cập nhật State 0ms (Optimistic UI).
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Tạo ID duy nhất với prefix. */
function genId(prefix) {
  return prefix + '-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000);
}

/**
 * Wrapper DRY cho try/catch — bắt lỗi và trả JSON chuẩn.
 * @param {Function} fn - Hàm thuần logic, trả về data
 * @returns {{ success: boolean, data?: any, error?: string }}
 */
function withErrorHandling(fn) {
  try {
    var result = fn();
    return result !== undefined ? result : { success: true };
  } catch (e) {
    Logger.log('[API Error] ' + e.message + '\n' + (e.stack || ''));
    return { success: false, error: String(e && e.message ? e.message : e) };
  }
}

/**
 * Lấy toàn bộ dữ liệu khởi động ứng dụng trong 1 lần gọi duy nhất (Single RPC Roundtrip).
 * Tối ưu theo tiêu chuẩn GGSheet-QLHT: Không gửi nhiều request lẻ gây lock contention trên Google Apps Script.
 */
function getInitialData() {
  return withErrorHandling(function() {
    var menuRes = getMenu();
    var tablesRes = getTables();
    var activeOrdersRes = getActiveOrders();
    var tasksRes = getTasksForToday();
    var expensesRes = getExpenses();
    var staffRes = getStaff();
    var customersRes = getCustomers();
    var settingsRes = getSettings();
    var reportRes = getReport('today');

    var expList = [];
    if (expensesRes && expensesRes.data) {
      if (Array.isArray(expensesRes.data.expenses)) {
        expList = expensesRes.data.expenses;
      } else if (Array.isArray(expensesRes.data)) {
        expList = expensesRes.data;
      }
    }

    return {
      success: true,
      data: {
        menu: (menuRes && menuRes.data) ? menuRes.data : { products: [], toppings: [], categories: [] },
        tables: (tablesRes && tablesRes.data) ? tablesRes.data : [],
        activeOrders: (activeOrdersRes && activeOrdersRes.data) ? activeOrdersRes.data : [],
        tasks: (tasksRes && tasksRes.data) ? tasksRes.data : [],
        expenses: expList,
        staff: (staffRes && staffRes.data) ? staffRes.data : [],
        customers: (customersRes && customersRes.data) ? customersRes.data : [],
        settings: (settingsRes && settingsRes.data) ? settingsRes.data : {},
        report: (reportRes && reportRes.data) ? reportRes.data : null
      }
    };
  });
}

/**
 * Helper gom nhóm mảng Order_Details theo OrderID bằng Map trong 1 lần duyệt O(M).
 * @param {Object[]} details - Danh sách chi tiết món
 * @returns {Map<string, Object[]>}
 */
function _groupDetailsByOrderId(details) {
  var map = new Map();
  if (!details || details.length === 0) return map;
  for (var i = 0; i < details.length; i++) {
    var d = details[i];
    var oId = d.OrderID;
    if (!map.has(oId)) {
      map.set(oId, []);
    }
    map.get(oId).push(d);
  }
  return map;
}

/**
 * Xử lý chuỗi tiền tệ linh hoạt (hỗ trợ số thuần hoặc chuỗi định dạng "12.000" / "415.000").
 * @param {any} val - Giá trị số hoặc chuỗi
 * @returns {number}
 */
function _parseCurrency(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  var str = String(val).trim().replace(/\./g, '').replace(/,/g, '');
  var num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * Chuẩn hóa giá trị ngày tháng từ nhiều định dạng trong Google Sheets thành YYYY-MM-DD.
 * @param {any} val - Giá trị ngày tháng
 * @returns {string} Chuỗi YYYY-MM-DD
 */
function _extractDateStr(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  }
  var s = String(val).trim();
  if (s.startsWith('Date(')) {
    var parts = s.replace('Date(', '').replace(')', '').split(',');
    if (parts.length >= 3) {
      var y = parts[0].trim();
      var m = String(parseInt(parts[1].trim(), 10) + 1).padStart(2, '0');
      var d = String(parseInt(parts[2].trim(), 10)).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }
  }
  return s.substring(0, 10);
}

// ── AUTH ──────────────────────────────────────────────────────────────────────

/** Xác minh PIN admin. */
function verifyPin(pin) {
  return withErrorHandling(function() {
    var stored = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '1234';
    return { success: true, valid: String(pin) === stored };
  });
}

/** Đổi PIN admin. */
function changePin(oldPin, newPin) {
  return withErrorHandling(function() {
    var stored = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '1234';
    if (String(oldPin) !== stored) return { success: false, error: 'PIN cũ không đúng' };
    PropertiesService.getScriptProperties().setProperty('ADMIN_PIN', String(newPin));
    return { success: true };
  });
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────

function getSettings() {
  return withErrorHandling(function() {
    var cache = CacheService.getScriptCache();
    var hit   = cache.get('settings');
    if (hit) return { success: true, data: JSON.parse(hit) };
    var p = PropertiesService.getScriptProperties();
    var data = {
      shopName:    p.getProperty('SHOP_NAME')    || 'Tiệm Của Lá',
      slogan:      p.getProperty('SHOP_SLOGAN')  || 'Ngồi bên Lá quên vội vã',
      phone:       p.getProperty('SHOP_PHONE')   || '0877 11 58 36',
      facebook:    p.getProperty('SHOP_FB')      || 'https://facebook.com/tiem.cua.la.417',
      bankId:      p.getProperty('BANK_ID')      || '971025',
      accountNo:   p.getProperty('ACCOUNT_NO')   || 'PSP2612215800000207',
      accountName: p.getProperty('ACCOUNT_NAME') || 'TRƯƠNG HOÀI DINH',
    };
    try { cache.put('settings', JSON.stringify(data), 1800); } catch(e) {}
    return { success: true, data: data };
  });
}

function saveSettings(data) {
  return withErrorHandling(function() {
    var p = PropertiesService.getScriptProperties();
    if (data.shopName)    p.setProperty('SHOP_NAME',    data.shopName);
    if (data.slogan)      p.setProperty('SHOP_SLOGAN',  data.slogan);
    if (data.phone)       p.setProperty('SHOP_PHONE',   data.phone);
    if (data.facebook)    p.setProperty('SHOP_FB',      data.facebook);
    if (data.bankId)      p.setProperty('BANK_ID',      data.bankId);
    if (data.accountNo)   p.setProperty('ACCOUNT_NO',   data.accountNo);
    if (data.accountName) p.setProperty('ACCOUNT_NAME', data.accountName);
    CacheService.getScriptCache().remove('settings');
    return { success: true, data: data };
  });
}

// ── MENU (Customer) ───────────────────────────────────────────────────────────

function getMenu() {
  return withErrorHandling(function() {
    var cache = CacheService.getScriptCache();
    var hit   = cache.get('menu_pub');
    if (hit) return { success: true, data: JSON.parse(hit) };
    var products   = getSheetData(SHEETS.PRODUCTS).filter(function(p) { return p.Status !== 'INACTIVE' && p.Status !== 'HIDDEN'; });
    var toppings   = getSheetData(SHEETS.TOPPINGS).filter(function(t) { return t.Status !== 'INACTIVE' && t.Status !== 'HIDDEN'; });
    var categories = [...new Set(products.map(function(p) { return p.Category; }))];
    var data = { products: products, toppings: toppings, categories: categories };
    try { cache.put('menu_pub', JSON.stringify(data), 300); } catch(e) {}
    return { success: true, data: data };
  });
}

// ── PRODUCTS CRUD (Admin) ─────────────────────────────────────────────────────

function getMenuAdmin() {
  return withErrorHandling(function() {
    var cache = CacheService.getScriptCache();
    var hit   = cache.get('menu_admin');
    if (hit) return { success: true, data: JSON.parse(hit) };
    var products   = getSheetData(SHEETS.PRODUCTS, false);
    var toppings   = getSheetData(SHEETS.TOPPINGS, false);
    var categories = [...new Set(products.map(function(p) { return p.Category; }))];
    var data = { products: products, toppings: toppings, categories: categories };
    try { cache.put('menu_admin', JSON.stringify(data), 300); } catch(e) {}
    return { success: true, data: data };
  });
}

function addProduct(data) {
  return withErrorHandling(function() {
    var id = 'P-' + new Date().getTime();
    var item = {
      ID: id, Name: data.name, Category: data.category,
      Price: Number(data.price), Image: data.image || '',
      HasSize: !!data.hasSize, HasIce: !!data.hasIce, HasSugar: !!data.hasSugar, Status: 'ACTIVE'
    };
    appendRowToSheet(SHEETS.PRODUCTS, item);
    CacheService.getScriptCache().removeAll(['menu_pub', 'menu_admin']);
    return { success: true, id: id, data: item };
  });
}

function updateProduct(id, data) {
  return withErrorHandling(function() {
    var updates = {};
    if (data.name     !== undefined) updates.Name     = data.name;
    if (data.category !== undefined) updates.Category = data.category;
    if (data.price    !== undefined) updates.Price    = Number(data.price);
    if (data.image    !== undefined) updates.Image    = data.image;
    if (data.hasSize  !== undefined) updates.HasSize  = !!data.hasSize;
    if (data.hasIce   !== undefined) updates.HasIce   = !!data.hasIce;
    if (data.hasSugar !== undefined) updates.HasSugar = !!data.hasSugar;
    if (data.status   !== undefined) updates.Status   = data.status;
    var ok = updateRowInSheet(SHEETS.PRODUCTS, 'ID', id, updates);
    CacheService.getScriptCache().removeAll(['menu_pub', 'menu_admin']);
    return { success: ok, id: id, data: updates };
  });
}

function deleteProduct(id) {
  return withErrorHandling(function() {
    deleteRowFromSheet(SHEETS.PRODUCTS, 'ID', id);
    CacheService.getScriptCache().removeAll(['menu_pub', 'menu_admin']);
    return { success: true, id: id };
  });
}

// ── TOPPINGS CRUD ─────────────────────────────────────────────────────────────

function addTopping(data) {
  return withErrorHandling(function() {
    var id = 'T-' + new Date().getTime();
    var item = { ID: id, Name: data.name, Price: Number(data.price), Status: 'ACTIVE' };
    appendRowToSheet(SHEETS.TOPPINGS, item);
    CacheService.getScriptCache().removeAll(['menu_pub', 'menu_admin']);
    return { success: true, id: id, data: item };
  });
}

function updateTopping(id, data) {
  return withErrorHandling(function() {
    var updates = {};
    if (data.name   !== undefined) updates.Name   = data.name;
    if (data.price  !== undefined) updates.Price  = Number(data.price);
    if (data.status !== undefined) updates.Status = data.status;
    var ok = updateRowInSheet(SHEETS.TOPPINGS, 'ID', id, updates);
    CacheService.getScriptCache().removeAll(['menu_pub', 'menu_admin']);
    return { success: ok, id: id, data: updates };
  });
}

function deleteTopping(id) {
  return withErrorHandling(function() {
    deleteRowFromSheet(SHEETS.TOPPINGS, 'ID', id);
    CacheService.getScriptCache().removeAll(['menu_pub', 'menu_admin']);
    return { success: true, id: id };
  });
}

/**
 * Tải ảnh sản phẩm lên Google Drive và tạo direct link.
 * @param {string} base64Data - Dữ liệu base64 (có thể có tiền tố data:image/...)
 * @param {string} fileName - Tên file
 * @returns {{ success: boolean, url?: string, fileId?: string, error?: string }}
 */
function uploadProductImage(base64Data, fileName) {
  return withErrorHandling(function() {
    if (!base64Data) return { success: false, error: 'Dữ liệu ảnh rỗng' };

    var contentType = 'image/jpeg';
    var rawBase64 = base64Data;
    if (base64Data.indexOf(';base64,') > -1) {
      var parts = base64Data.split(';base64,');
      contentType = parts[0].replace('data:', '');
      rawBase64 = parts[1];
    }

    var decoded = Utilities.base64Decode(rawBase64);
    var blob = Utilities.newBlob(decoded, contentType, fileName || ('menu-' + new Date().getTime() + '.jpg'));

    var folderName = 'TCL_Menu_Images';
    var folders = DriveApp.getFoldersByName(folderName);
    var folder;
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder(folderName);
    }

    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileId = file.getId();
    var directUrl = 'https://lh3.googleusercontent.com/d/' + fileId;

    return { success: true, url: directUrl, fileId: fileId };
  });
}

// ── ORDERS ────────────────────────────────────────────────────────────────────

/** Tạo các hàng chi tiết đơn hàng (dùng chung cho submitOrder và editOrder). */
function _buildOrderDetailRows(orderId, items, detSheet) {
  var headers = detSheet.getRange(1, 1, 1, detSheet.getLastColumn()).getValues()[0];
  return items.map(function(item, i) {
    var obj = {
      ID:          orderId + '-D' + (i + 1),
      OrderID:     orderId,
      ProductID:   item.productId   || '',
      ProductName: item.productName,
      Size:        item.size        || '',
      Ice:         item.ice         || '',
      Sugar:       item.sugar       || '',
      Toppings:    Array.isArray(item.toppings) ? item.toppings.join(', ') : (item.toppings || ''),
      Quantity:    item.quantity,
      Price:       item.price,
      Subtotal:    item.price * item.quantity,
    };
    return headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; });
  });
}

/** Tối ưu submitOrder với LockService và Batch appendRowsToSheet */
function submitOrder(payload) {
  return withErrorHandling(function() {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) {
      return { success: false, error: 'Hệ thống đang xử lý đơn khác, vui lòng thử lại sau giây lát.' };
    }

    try {
      var orderId    = 'ORD-' + new Date().getTime();
      var orderType  = payload.orderType || 'DINE_IN';
      var pts        = Math.floor((payload.totalAmount || 0) / 10000);
      var customerId = payload.customerId || '';

      // Tạo hồ sơ khách hàng mới nếu chưa có (chưa cộng điểm khi đơn chưa thanh toán)
      if (!customerId && payload.customerPhone) {
        var existingCust = getSheetData(SHEETS.CUSTOMERS, false).find(function(c) { return String(c.Phone) === String(payload.customerPhone); });
        if (existingCust) {
          customerId = existingCust.ID;
        } else {
          customerId = 'CUS-' + new Date().getTime();
          appendRowToSheet(SHEETS.CUSTOMERS, {
            ID: customerId, Name: payload.customerName || 'Khách hàng',
            Phone: payload.customerPhone || '', Type: 'Cá nhân', Company: '',
            Address: payload.deliveryAddress || '', Email: '',
            Points: 0, TotalSpent: 0,
            CreatedAt: new Date().toISOString(), Note: '',
          });
          invalidateCache(SHEETS.CUSTOMERS);
        }
      }

      var newOrder = {
        ID: orderId, TableID: payload.tableId || '',
        TotalAmount: payload.totalAmount, Status: 'NEW',
        Source: payload.source || 'ONLINE', OrderType: orderType,
        CustomerID: customerId, CustomerName: payload.customerName || '',
        CustomerPhone: payload.customerPhone || '',
        DeliveryAddress: payload.deliveryAddress || '',
        CreatedAt: new Date().toISOString(), Note: payload.note || '',
      };

      appendRowToSheet(SHEETS.ORDERS, newOrder);

      if (payload.tableId && orderType === 'DINE_IN') {
        updateRowInSheet(SHEETS.TABLES, 'ID', payload.tableId, { Status: 'OCCUPIED' });
      }

      // Batch Insert Order Details
      var detSheet = getSheet(SHEETS.ORDER_DETAILS);
      var rows     = _buildOrderDetailRows(orderId, payload.items, detSheet);
      if (rows.length > 0) {
        detSheet.getRange(detSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
        invalidateCache(SHEETS.ORDER_DETAILS);
      }

      var fullOrderData = Object.assign({}, newOrder, { items: payload.items || [] });
      return { success: true, orderId: orderId, data: fullOrderData };
    } finally {
      lock.releaseLock();
    }
  });
}

/** TỐI ƯU P0: getOrders() dùng Map Grouping O(N+M) thay vì .filter() lồng O(N*M) */
function getOrders() {
  return withErrorHandling(function() {
    var orders     = getSheetData(SHEETS.ORDERS, false);
    var details    = getSheetData(SHEETS.ORDER_DETAILS, false);
    var detailsMap = _groupDetailsByOrderId(details);

    var active = orders.filter(function(o) { 
      return ['NEW','PREPARING','PACKING','SERVING'].includes(o.Status); 
    });

    var result = active.map(function(o) {
      return Object.assign({}, o, { items: detailsMap.get(o.ID) || [] });
    });
    result.sort(function(a, b) { return new Date(b.CreatedAt) - new Date(a.CreatedAt); });
    return { success: true, data: result };
  });
}

function getOrderStatus(orderId) {
  return withErrorHandling(function() {
    var order = getSheetData(SHEETS.ORDERS, false).find(function(o) { return o.ID === orderId; });
    if (!order) return { success: false, error: 'Không tìm thấy đơn' };
    var details = getSheetData(SHEETS.ORDER_DETAILS, false);
    var items = details.filter(function(d) { return d.OrderID === orderId; });
    return { success: true, data: Object.assign({}, order, { items: items }) };
  });
}

/** TỐI ƯU P0: getOrderHistory() dùng Map Grouping và tính toán trong 1 lượt duyệt */
function getOrderHistory(params) {
  return withErrorHandling(function() {
    var orders  = getSheetData(SHEETS.ORDERS, false);
    var details = getSheetData(SHEETS.ORDER_DETAILS, false);
    var detailsMap = _groupDetailsByOrderId(details);

    var from, to;
    if (typeof params === 'string' || !params) {
      from = to = params || new Date().toISOString().split('T')[0];
    } else {
      from = params.dateFrom || params.date || new Date().toISOString().split('T')[0];
      to   = params.dateTo   || from;
    }

    var byDay = {};
    var totalRevenue = 0;
    var filtered = [];

    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (!o.CreatedAt) continue;
      var d = o.CreatedAt.substring(0, 10);
      if (d >= from && d <= to && ['COMPLETED','CANCELLED'].includes(o.Status)) {
        filtered.push(Object.assign({}, o, { items: detailsMap.get(o.ID) || [] }));
        if (o.Status === 'COMPLETED') {
          var amt = _parseCurrency(o.TotalAmount);
          totalRevenue += amt;
          if (!byDay[d]) byDay[d] = { date: d, revenue: 0, orders: 0 };
          byDay[d].revenue += amt;
          byDay[d].orders  += 1;
        }
      }
    }

    filtered.sort(function(a, b) { return new Date(b.CreatedAt) - new Date(a.CreatedAt); });
    var dailyData = Object.values(byDay).sort(function(a, b) { return a.date > b.date ? 1 : -1; });

    return { 
      success: true, 
      data: filtered, 
      meta: { dailyData: dailyData, totalRevenue: totalRevenue, dateFrom: from, dateTo: to } 
    };
  });
}

function updateOrderStatus(orderId, newStatus) {
  return withErrorHandling(function() {
    var orders = getSheetData(SHEETS.ORDERS, false);
    var order  = orders.find(function(o) { return o.ID === orderId; });
    if (!order) return { success: false, error: 'Không tìm thấy đơn' };

    // Hoàn điểm khi hủy đơn có khách hàng
    if (newStatus === 'CANCELLED' && order.Status !== 'CANCELLED' && order.CustomerID) {
      var customer = getSheetData(SHEETS.CUSTOMERS, false).find(function(c) { return c.ID === order.CustomerID; });
      if (customer) {
        updateRowInSheet(SHEETS.CUSTOMERS, 'ID', order.CustomerID, {
          Points:     Math.max(0, (Number(customer.Points)     || 0) - (Number(order.TotalAmount) || 0)),
          TotalSpent: Math.max(0, (Number(customer.TotalSpent) || 0) - (Number(order.TotalAmount) || 0)),
        });
        invalidateCache(SHEETS.CUSTOMERS);
      }
    }

    var ok = updateRowInSheet(SHEETS.ORDERS, 'ID', orderId, { Status: newStatus });

    // Giải phóng bàn khi đơn hoàn thành/hủy và không còn đơn active khác
    if (ok && ['COMPLETED','CANCELLED'].includes(newStatus) && order.TableID) {
      var others = orders.filter(function(o) {
        return o.TableID === order.TableID && o.ID !== orderId &&
               ['NEW','PREPARING','PACKING','SERVING'].includes(o.Status);
      });
      if (others.length === 0) {
        updateRowInSheet(SHEETS.TABLES, 'ID', order.TableID, { Status: 'FREE' });
      }
    }
    return { success: ok, orderId: orderId, newStatus: newStatus };
  });
}

/** Tối ưu editOrder với Lock và Batch update details */
function editOrder(payload) {
  return withErrorHandling(function() {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(2500)) return { success: false, error: 'Hệ thống đang bận, vui lòng thử lại.' };

    try {
      var orderId = payload.orderId;
      var orders  = getSheetData(SHEETS.ORDERS, false);
      var order   = orders.find(function(o) { return o.ID === orderId; });
      if (!order) return { success: false, error: 'Không tìm thấy đơn hàng' };
      if (!['NEW','PREPARING','PACKING'].includes(order.Status)) {
        return { success: false, error: 'Chỉ có thể sửa đơn MỚI, ĐANG PHA hoặc ĐÓNG GÓI' };
      }

      var diff = (payload.totalAmount || 0) - (order.TotalAmount || 0);
      if (order.CustomerID && diff !== 0) {
        var customer = getSheetData(SHEETS.CUSTOMERS, false).find(function(c) { return c.ID === order.CustomerID; });
        if (customer) {
          updateRowInSheet(SHEETS.CUSTOMERS, 'ID', order.CustomerID, {
            Points:     Math.max(0, (Number(customer.Points)     || 0) + diff),
            TotalSpent: Math.max(0, (Number(customer.TotalSpent) || 0) + diff),
          });
          invalidateCache(SHEETS.CUSTOMERS);
        }
      }

      updateRowInSheet(SHEETS.ORDERS, 'ID', orderId, {
        TotalAmount: payload.totalAmount || 0,
        Note: payload.note || ''
      });

      // Tối ưu Batch: Lọc lại Order_Details trong RAM và ghi lại toàn bộ bảng
      var detSheet = getSheet(SHEETS.ORDER_DETAILS);
      var detData = detSheet.getDataRange().getValues();
      var headers = detData[0];
      var orderIdCol = headers.indexOf('OrderID');

      // Giữ lại các dòng không thuộc order này
      var remainingRows = detData.slice(1).filter(function(r) { return r[orderIdCol] !== orderId; });
      
      // Tạo các dòng mới
      var newRows = _buildOrderDetailRows(orderId + '-E', payload.items, detSheet);
      var combined = remainingRows.concat(newRows);

      // Xóa và ghi lại theo lô
      detSheet.clearContents();
      detSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      if (combined.length > 0) {
        detSheet.getRange(2, 1, combined.length, headers.length).setValues(combined);
      }
      invalidateCache(SHEETS.ORDER_DETAILS);

      return { success: true, orderId: orderId };
    } finally {
      lock.releaseLock();
    }
  });
}

// ── TABLES ────────────────────────────────────────────────────────────────────

function getTables() {
  return withErrorHandling(function() {
    var tables = getSheetData(SHEETS.TABLES, false);
    var orders = getSheetData(SHEETS.ORDERS, false);
    
    // Đếm active orders bằng Map O(N+M)
    var countByTable = {};
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (o.TableID && ['NEW','PREPARING','PACKING','SERVING'].includes(o.Status)) {
        countByTable[o.TableID] = (countByTable[o.TableID] || 0) + 1;
      }
    }

    var data = tables.map(function(t) {
      return Object.assign({}, t, {
        ActiveOrderCount: countByTable[t.ID] || 0
      });
    });
    return { success: true, data: data };
  });
}

function resetTable(tableId) {
  return withErrorHandling(function() {
    return { success: updateRowInSheet(SHEETS.TABLES, 'ID', tableId, { Status: 'FREE' }) };
  });
}

function addTable(data) {
  return withErrorHandling(function() {
    var existing = getSheetData(SHEETS.TABLES, false);
    var id = 'TBL' + String(existing.length + 1).padStart(2, '0');
    var item = {
      ID: id, Name: data.name || ('Bàn ' + (existing.length + 1)),
      Status: 'FREE', Capacity: data.capacity || 4, QR_URL: '',
    };
    appendRowToSheet(SHEETS.TABLES, item);
    return { success: true, id: id, data: item };
  });
}

function deleteTable(id) {
  return withErrorHandling(function() {
    deleteRowFromSheet(SHEETS.TABLES, 'ID', id);
    return { success: true, id: id };
  });
}

function switchTable(fromTableId, toTableId) {
  return withErrorHandling(function() {
    if (!fromTableId || !toTableId) return { success: false, error: 'Thiếu thông tin bàn chuyển' };
    if (fromTableId === toTableId) return { success: false, error: 'Bàn chuyển và bàn nhận phải khác nhau' };

    var orders = getSheetData(SHEETS.ORDERS, false);
    var activeFrom = orders.filter(function(o) {
      return o.TableID === fromTableId && ['NEW','PREPARING','PACKING','SERVING'].includes(o.Status);
    });

    if (activeFrom.length === 0) {
      return { success: false, error: 'Bàn nguồn không có đơn hàng đang phục vụ' };
    }

    // Chuyển toàn bộ đơn active sang bàn mới
    for (var i = 0; i < activeFrom.length; i++) {
      updateRowInSheet(SHEETS.ORDERS, 'ID', activeFrom[i].ID, { TableID: toTableId });
    }

    // Cập nhật trạng thái 2 bàn
    updateRowInSheet(SHEETS.TABLES, 'ID', fromTableId, { Status: 'FREE' });
    updateRowInSheet(SHEETS.TABLES, 'ID', toTableId, { Status: 'OCCUPIED' });

    invalidateCache(SHEETS.ORDERS);
    invalidateCache(SHEETS.TABLES);

    return { success: true, fromTableId: fromTableId, toTableId: toTableId, movedCount: activeFrom.length };
  });
}

function getAppUrl() {
  return withErrorHandling(function() {
    return { success: true, data: ScriptApp.getService().getUrl() };
  });
}

// ── EXPENSES ──────────────────────────────────────────────────────────────────

function addExpense(data) {
  return withErrorHandling(function() {
    var id   = 'EXP-' + new Date().getTime();
    var date = data.date || new Date().toISOString().split('T')[0];
    var item = {
      ID: id, Date: date, Category: data.category || 'Khác',
      Description: data.description, Amount: Number(data.amount),
      Note: data.note || '', FundingSource: data.fundingSource || 'Tiền quán',
      PerformedBy: data.performedBy || '', PerformedByName: data.performedByName || ''
    };
    appendRowToSheet(SHEETS.EXPENSES, item);
    return { success: true, id: id, data: item };
  });
}

function getExpenses(date) {
  return withErrorHandling(function() {
    var all      = getSheetData(SHEETS.EXPENSES, false);
    var today    = date || new Date().toISOString().split('T')[0];
    var filtered = all.filter(function(e) { return String(e.Date).startsWith(today); });
    var total    = filtered.reduce(function(s, e) { return s + (Number(e.Amount) || 0); }, 0);
    filtered.sort(function(a, b) { return new Date(b.Date) - new Date(a.Date); });
    return { success: true, data: { expenses: filtered, total: total } };
  });
}

function deleteExpense(id) {
  return withErrorHandling(function() {
    deleteRowFromSheet(SHEETS.EXPENSES, 'ID', id);
    return { success: true, id: id };
  });
}

function updateExpense(id, data) {
  return withErrorHandling(function() {
    var updates = {};
    if (data.category        !== undefined) updates.Category        = data.category;
    if (data.description     !== undefined) updates.Description     = data.description;
    if (data.amount          !== undefined) updates.Amount          = Number(data.amount);
    if (data.note            !== undefined) updates.Note            = data.note;
    if (data.fundingSource   !== undefined) updates.FundingSource   = data.fundingSource;
    if (data.performedBy     !== undefined) updates.PerformedBy     = data.performedBy;
    if (data.performedByName !== undefined) updates.PerformedByName = data.performedByName;
    var ok = updateRowInSheet(SHEETS.EXPENSES, 'ID', id, updates);
    return { success: ok, id: id, data: updates };
  });
}

function getExpenseSummary(params) {
  return withErrorHandling(function() {
    var all      = getSheetData(SHEETS.EXPENSES, false);
    var from     = params && params.dateFrom ? params.dateFrom : new Date().toISOString().split('T')[0];
    var to       = params && params.dateTo   ? params.dateTo   : from;

    var filtered = all.filter(function(e) {
      var d = String(e.Date).substring(0, 10);
      return d >= from && d <= to;
    });

    var byCat = {};
    var grandTotal = 0;
    for (var i = 0; i < filtered.length; i++) {
      var e = filtered[i];
      var cat = e.Category || 'Khác';
      var amt = _parseCurrency(e.Amount);
      grandTotal += amt;
      if (!byCat[cat]) byCat[cat] = { category: cat, total: 0, count: 0 };
      byCat[cat].total += amt;
      byCat[cat].count += 1;
    }

    var summary = Object.values(byCat).sort(function(a, b) { return b.total - a.total; });
    filtered.sort(function(a, b) { return new Date(b.Date) - new Date(a.Date); });

    return { success: true, data: { summary: summary, grandTotal: grandTotal, expenses: filtered } };
  });
}

// ── REPORT ────────────────────────────────────────────────────────────────────

/** TỐI ƯU P0: getReportByRange() dùng Map và Set để tổng hợp dữ liệu O(N) */
function getReportByRange(params) {
  return withErrorHandling(function() {
    var today = new Date().toISOString().split('T')[0];
    var from  = (params && params.dateFrom) ? params.dateFrom : today;
    var to    = (params && params.dateTo)   ? params.dateTo   : today;

    var allOrders   = getSheetData(SHEETS.ORDERS, false);
    var allDetails  = getSheetData(SHEETS.ORDER_DETAILS, false);
    var allExp      = getSheetData(SHEETS.EXPENSES, false);
    var allProducts = getSheetData(SHEETS.PRODUCTS, false);

    // Lọc đơn trong khoảng ngày
    var orders = allOrders.filter(function(o) {
      if (!o.CreatedAt) return false;
      var d = _extractDateStr(o.CreatedAt);
      return d >= from && d <= to && o.Status === 'COMPLETED';
    });

    var totalRevenue  = 0;
    var byDay = {};
    var orderIds = new Set();
    var cashRevenue = 0, cashOrders = 0;
    var transferRevenue = 0, transferOrders = 0;
    var orderList = [];

    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      var amt = _parseCurrency(o.TotalAmount);
      totalRevenue += amt;
      orderIds.add(o.ID);
      var d = _extractDateStr(o.CreatedAt);
      if (!byDay[d]) byDay[d] = { date: d, revenue: 0, orders: 0 };
      byDay[d].revenue += amt;
      byDay[d].orders  += 1;

      var noteStr = String(o.Note || '').toUpperCase();
      var pMethod = String(o.PaymentMethod || o.Source || '').toUpperCase();
      if (pMethod === 'TRANSFER' || pMethod === 'ONLINE' || pMethod === 'VIETQR' || noteStr.includes('[TT:TRANSFER]') || noteStr.includes('CK:')) {
        transferRevenue += amt;
        transferOrders += 1;
      } else {
        cashRevenue += amt;
        cashOrders += 1;
      }

      orderList.push({
        ID: o.ID,
        TableID: o.TableID || '',
        TotalAmount: amt,
        CreatedAt: o.CreatedAt,
        OrderType: o.OrderType || 'DINE_IN',
        CustomerName: o.CustomerName || '',
      });
    }

    var totalOrders = orders.length;
    var dailyData = Object.values(byDay).sort(function(a, b) { return a.date > b.date ? 1 : -1; });

    var totalExpenses = allExp
      .filter(function(e) { 
        var d = _extractDateStr(e.Date); 
        return d >= from && d <= to; 
      })
      .reduce(function(s, e) { return s + _parseCurrency(e.Amount); }, 0);

    // Top sản phẩm O(M)
    var prodCount = {}, prodRevenue = {};
    for (var j = 0; j < allDetails.length; j++) {
      var dt = allDetails[j];
      if (orderIds.has(dt.OrderID)) {
        var n = dt.ProductName;
        prodCount[n]   = (prodCount[n]   || 0) + (Number(dt.Quantity) || 1);
        prodRevenue[n] = (prodRevenue[n] || 0) + (_parseCurrency(dt.Subtotal) || (_parseCurrency(dt.Price) * (Number(dt.Quantity) || 1)));
      }
    }

    var topProducts = Object.entries(prodCount)
      .sort(function(a, b) { return b[1] - a[1]; })
      .slice(0, 10)
      .map(function(e) { return { name: e[0], count: e[1], revenue: prodRevenue[e[0]] || 0 }; });

    // So sánh kỳ trước
    var dFrom = new Date(from), dTo = new Date(to);
    var diff  = Math.round((dTo - dFrom) / 86400000) + 1;
    var prevTo   = new Date(dFrom); prevTo.setDate(prevTo.getDate() - 1);
    var prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - diff + 1);
    var pFrom = prevFrom.toISOString().split('T')[0];
    var pTo   = prevTo.toISOString().split('T')[0];

    var prevRevenue = allOrders
      .filter(function(o) {
        if (!o.CreatedAt) return false;
        var d = _extractDateStr(o.CreatedAt);
        return d >= pFrom && d <= pTo && o.Status === 'COMPLETED';
      })
      .reduce(function(s, o) { return s + _parseCurrency(o.TotalAmount); }, 0);

    var revenueGrowth = prevRevenue > 0
      ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100)
      : null;

    return { success: true, data: {
      dateFrom: from, dateTo: to,
      totalRevenue: totalRevenue, totalOrders: totalOrders,
      avgOrder: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
      totalExpenses: totalExpenses,
      profit: totalRevenue - totalExpenses,
      dailyData: dailyData,
      topProducts: topProducts,
      orderList: orderList.slice(0, 50),
      paymentBreakdown: {
        cashRevenue: cashRevenue,
        cashOrders: cashOrders,
        transferRevenue: transferRevenue,
        transferOrders: transferOrders,
      },
      comparison: { prevRevenue: prevRevenue, revenueGrowth: revenueGrowth, dateFrom: pFrom, dateTo: pTo },
    }};
  });
}

function getReport() {
  return getReportByRange({ dateFrom: new Date().toISOString().split('T')[0] });
}

// ── CUSTOMERS ─────────────────────────────────────────────────────────────────

function getCustomers() {
  return withErrorHandling(function() {
    var customers = getSheetData(SHEETS.CUSTOMERS, false);
    customers.sort(function(a, b) { return (Number(b.TotalSpent) || 0) - (Number(a.TotalSpent) || 0); });
    return { success: true, data: customers };
  });
}

function searchCustomer(phone) {
  return withErrorHandling(function() {
    if (!phone) return { success: true, data: [] };
    var q = String(phone).trim();
    var found = getSheetData(SHEETS.CUSTOMERS, false)
      .filter(function(c) { return String(c.Phone || '').includes(q); });
    return { success: true, data: found };
  });
}

function saveCustomer(data) {
  return withErrorHandling(function() {
    if (data.id) {
      updateRowInSheet(SHEETS.CUSTOMERS, 'ID', data.id, {
        Name: data.name || '', Phone: data.phone || '',
        Type: data.type || 'Cá nhân', Company: data.company || '',
        Address: data.address || '', Email: data.email || '', Note: data.note || '',
      });
      invalidateCache(SHEETS.CUSTOMERS);
      return { success: true, id: data.id, data: data };
    }
    var id = 'CUS-' + new Date().getTime();
    var item = {
      ID: id, Name: data.name || '', Phone: data.phone || '',
      Type: data.type || 'Cá nhân', Company: data.company || '',
      Address: data.address || '', Email: data.email || '',
      Points: 0, TotalSpent: 0,
      CreatedAt: new Date().toISOString(), Note: data.note || '',
    };
    appendRowToSheet(SHEETS.CUSTOMERS, item);
    return { success: true, id: id, data: item };
  });
}

function getCustomerHistory(customerId) {
  return withErrorHandling(function() {
    var orders  = getSheetData(SHEETS.ORDERS, false);
    var details = getSheetData(SHEETS.ORDER_DETAILS, false);
    var detailsMap = _groupDetailsByOrderId(details);

    var result = orders
      .filter(function(o) { return o.CustomerID === customerId; })
      .sort(function(a, b) { return new Date(b.CreatedAt) - new Date(a.CreatedAt); })
      .map(function(o) {
        return Object.assign({}, o, { items: detailsMap.get(o.ID) || [] });
      });
    return { success: true, data: result };
  });
}

// ── ALIAS BRIDGE (Frontend → Backend) ─────────────────────────────────────────

function getActiveOrders() { return getOrders(); }
function createOrder(data) { return submitOrder(data); }
function updateOrder(data) { return editOrder(data); }
function cancelOrder(orderId) { return updateOrderStatus(orderId, 'CANCELLED'); }
function getOrderById(orderId) { return getOrderStatus(orderId); }

function checkoutOrder(orderId, paymentData) {
  return withErrorHandling(function() {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(2500)) return { success: false, error: 'Hệ thống đang bận' };

    try {
      var orders = getSheetData(SHEETS.ORDERS, false);
      var order  = orders.find(function(o) { return o.ID === orderId; });
      if (!order) return { success: false, error: 'Không tìm thấy đơn' };

      var pd = paymentData || {};
      var notePayment = '[TT:' + (pd.paymentMethod || 'cash').toUpperCase() + ']';
      if (pd.cashAmount)     notePayment += ' TM:' + pd.cashAmount;
      if (pd.transferAmount) notePayment += ' CK:' + pd.transferAmount;
      if (pd.tips)           notePayment += ' Tips:' + pd.tips;

      var existingNote = order.Note || '';
      var newNote = existingNote ? (existingNote + ' ' + notePayment) : notePayment;

      updateRowInSheet(SHEETS.ORDERS, 'ID', orderId, {
        Status: 'COMPLETED',
        Note:   newNote,
      });

      if (order.TableID) {
        var others = orders.filter(function(o) {
          return o.TableID === order.TableID && o.ID !== orderId &&
                 ['NEW','PREPARING','PACKING','SERVING'].includes(o.Status);
        });
        if (others.length === 0) {
          updateRowInSheet(SHEETS.TABLES, 'ID', order.TableID, { Status: 'FREE' });
        }
      }

      if (order.CustomerID) {
        var pts = Math.floor((Number(order.TotalAmount) || 0) / 10000);
        var customer = getSheetData(SHEETS.CUSTOMERS, false).find(function(c) { return c.ID === order.CustomerID; });
        if (customer) {
          updateRowInSheet(SHEETS.CUSTOMERS, 'ID', order.CustomerID, {
            Points:     (Number(customer.Points)     || 0) + pts,
            TotalSpent: (Number(customer.TotalSpent) || 0) + (Number(order.TotalAmount) || 0),
          });
          invalidateCache(SHEETS.CUSTOMERS);
        }
      }

      invalidateCache(SHEETS.ORDERS);
      invalidateCache(SHEETS.TABLES);
      return { success: true, orderId: orderId, status: 'COMPLETED' };
    } finally {
      lock.releaseLock();
    }
  });
}

function getMenuItems() { return getMenuAdmin(); }
function getCategories() { return getMenuAdmin(); }
function getToppings() { return getMenuAdmin(); }
function addMenuItem(data) { return addProduct(data); }
function updateMenuItem(data) { return updateProduct(data.id, data); }
function deleteMenuItem(id) { return deleteProduct(id); }

function searchCustomers(phone) { return searchCustomer(phone); }
function getCustomerOrders(customerId) { return getCustomerHistory(customerId); }

function updateTableStatus(tableId, status) {
  return withErrorHandling(function() {
    var allowed = ['FREE', 'OCCUPIED', 'RESERVED'];
    var st = String(status).toUpperCase();
    if (!allowed.includes(st)) return { success: false, error: 'Trạng thái không hợp lệ: ' + status };
    var ok = updateRowInSheet(SHEETS.TABLES, 'ID', tableId, { Status: st });
    invalidateCache(SHEETS.TABLES);
    return { success: ok, tableId: tableId, status: st };
  });
}

function getRevenueReport(params) { return getReportByRange(params); }

// ── STAFF CRUD ────────────────────────────────────────────────────────────────

function getStaff() {
  return withErrorHandling(function() {
    var staff = getSheetData(SHEETS.STAFF, false)
      .filter(function(s) { return s.Status !== 'INACTIVE'; });
    return { success: true, data: staff };
  });
}

function addStaff(data) {
  return withErrorHandling(function() {
    var name = (data && data.name) ? String(data.name).trim() : '';
    if (!name) return { success: false, error: 'Tên nhân viên không được rỗng' };
    var id = genId('NV');
    var item = { ID: id, Name: name, Status: 'ACTIVE' };
    appendRowToSheet(SHEETS.STAFF, item);
    invalidateCache(SHEETS.STAFF);
    return { success: true, id: id, data: item };
  });
}

function updateStaff(data) {
  return withErrorHandling(function() {
    if (!data || !data.id) return { success: false, error: 'Thiếu ID' };
    var updates = {};
    if (data.name)   updates.Name   = String(data.name).trim();
    if (data.status) updates.Status = data.status;
    updateRowInSheet(SHEETS.STAFF, 'ID', data.id, updates);
    invalidateCache(SHEETS.STAFF);
    return { success: true, id: data.id, data: updates };
  });
}

function deactivateStaff(id) {
  return withErrorHandling(function() {
    updateRowInSheet(SHEETS.STAFF, 'ID', id, { Status: 'INACTIVE' });
    invalidateCache(SHEETS.STAFF);
    return { success: true, id: id };
  });
}

// ── TASK TEMPLATES CRUD ───────────────────────────────────────────────────────

function getTaskTemplates() {
  return withErrorHandling(function() {
    var templates = getSheetData(SHEETS.TASK_TEMPLATES, false);
    return { success: true, data: templates };
  });
}

function addTaskTemplate(data) {
  return withErrorHandling(function() {
    var id = genId('TMPL');
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var item = {
      ID:           id,
      Title:        data.title        || '',
      Description:  data.description  || '',
      AssignedTo:   data.assignedTo   || '',
      AssignedName: data.assignedName || '',
      RepeatType:   data.repeatType   || 'daily',
      RepeatEvery:  Number(data.repeatEvery) || 1,
      Priority:     data.priority     || 'medium',
      StartDate:    data.startDate    || today,
      Status:       'ACTIVE',
    };
    appendRowToSheet(SHEETS.TASK_TEMPLATES, item);
    invalidateCache(SHEETS.TASK_TEMPLATES);
    return { success: true, id: id, data: item };
  });
}

function updateTaskTemplate(data) {
  return withErrorHandling(function() {
    if (!data || !data.id) return { success: false, error: 'Thiếu ID template' };
    var updates = {};
    if (data.title        !== undefined) updates.Title        = data.title;
    if (data.description  !== undefined) updates.Description  = data.description;
    if (data.assignedTo   !== undefined) updates.AssignedTo   = data.assignedTo;
    if (data.assignedName !== undefined) updates.AssignedName = data.assignedName;
    if (data.repeatType   !== undefined) updates.RepeatType   = data.repeatType;
    if (data.repeatEvery  !== undefined) updates.RepeatEvery  = Number(data.repeatEvery);
    if (data.priority     !== undefined) updates.Priority     = data.priority;
    if (data.startDate    !== undefined) updates.StartDate    = data.startDate;
    if (data.status       !== undefined) updates.Status       = data.status;
    updateRowInSheet(SHEETS.TASK_TEMPLATES, 'ID', data.id, updates);
    invalidateCache(SHEETS.TASK_TEMPLATES);
    return { success: true, id: data.id, data: updates };
  });
}

function deleteTaskTemplate(id) {
  return withErrorHandling(function() {
    updateRowInSheet(SHEETS.TASK_TEMPLATES, 'ID', id, { Status: 'DELETED' });
    invalidateCache(SHEETS.TASK_TEMPLATES);
    return { success: true, id: id };
  });
}

function toggleTaskTemplate(id) {
  return withErrorHandling(function() {
    var templates = getSheetData(SHEETS.TASK_TEMPLATES, false);
    var t = templates.find(function(x) { return x.ID === id; });
    if (!t) return { success: false, error: 'Template không tồn tại' };
    var newStatus = (t.Status === 'ACTIVE') ? 'PAUSED' : 'ACTIVE';
    updateRowInSheet(SHEETS.TASK_TEMPLATES, 'ID', id, { Status: newStatus });
    invalidateCache(SHEETS.TASK_TEMPLATES);
    return { success: true, status: newStatus };
  });
}

// ── Task Instance helpers & API ───────────────────────────────────────────────

function _shouldRunOnDate(template, dateStr) {
  var d     = new Date(dateStr + 'T00:00:00');
  var start = new Date((template.StartDate || dateStr) + 'T00:00:00');
  if (d < start) return false;

  var daysDiff = Math.floor((d - start) / 86400000);
  var dayOfWeek = d.getDay();
  var repEvery  = Number(template.RepeatEvery) || 1;

  switch (template.RepeatType) {
    case 'daily':    return true;
    case 'every_x':  return daysDiff % repEvery === 0;
    case 'weekly':   return dayOfWeek === (repEvery % 7);
    case 'biweekly':
      var weeks = Math.floor(daysDiff / 7);
      return dayOfWeek === (repEvery % 7) && weeks % 2 === 0;
    case 'monthly':  return d.getDate() === repEvery;
    default:         return false;
  }
}

function _generateInstances(dateStr, templates) {
  var existing = getSheetData(SHEETS.TASK_INSTANCES, false);
  var existingKeys = new Set();
  for (var i = 0; i < existing.length; i++) {
    existingKeys.add(existing[i].TemplateID + '|' + existing[i].DueDate);
  }

  var toAdd = [];
  for (var j = 0; j < templates.length; j++) {
    var t = templates[j];
    if (_shouldRunOnDate(t, dateStr) && !existingKeys.has(t.ID + '|' + dateStr)) {
      toAdd.push({
        ID:           genId('TASK'),
        TemplateID:   t.ID,
        Title:        t.Title,
        AssignedTo:   t.AssignedTo,
        AssignedName: t.AssignedName,
        DueDate:      dateStr,
        Priority:     t.Priority || 'medium',
        Status:       'PENDING',
        CompletedAt:  '',
        CompletedBy:  '',
        Note:         '',
      });
    }
  }

  if (toAdd.length > 0) {
    appendRowsToSheet(SHEETS.TASK_INSTANCES, toAdd);
  }
}

function getTasksForToday() {
  return withErrorHandling(function() {
    var tz      = Session.getScriptTimeZone();
    var now     = new Date();
    var todayStr     = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var yesterdayStr = Utilities.formatDate(new Date(now.getTime() - 86400000), tz, 'yyyy-MM-dd');

    var templates = getSheetData(SHEETS.TASK_TEMPLATES, false)
      .filter(function(t) { return t.Status === 'ACTIVE'; });

    _generateInstances(todayStr, templates);

    var all = getSheetData(SHEETS.TASK_INSTANCES, false);
    var result = all.filter(function(i) {
      if (i.DueDate === todayStr) return true;
      if (i.DueDate === yesterdayStr && i.Status === 'PENDING') return true;
      return false;
    });

    result = result.map(function(i) {
      return Object.assign({}, i, { isOverdue: i.DueDate === yesterdayStr });
    });

    var priorityOrder = { high: 0, medium: 1, low: 2 };
    result.sort(function(a, b) {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      return (priorityOrder[a.Priority] || 1) - (priorityOrder[b.Priority] || 1);
    });

    return { success: true, data: result };
  });
}

function completeTask(id, note) {
  return withErrorHandling(function() {
    var now = new Date().toISOString();
    updateRowInSheet(SHEETS.TASK_INSTANCES, 'ID', id, {
      Status:      'DONE',
      CompletedAt: now,
      Note:        note || '',
    });
    invalidateCache(SHEETS.TASK_INSTANCES);
    return { success: true, id: id, status: 'DONE', completedAt: now };
  });
}

function skipTask(id, note) {
  return withErrorHandling(function() {
    updateRowInSheet(SHEETS.TASK_INSTANCES, 'ID', id, {
      Status: 'SKIPPED',
      Note:   note || '',
    });
    invalidateCache(SHEETS.TASK_INSTANCES);
    return { success: true, id: id, status: 'SKIPPED' };
  });
}

/**
 * Tạo công việc đột xuất trong ngày (Ad-hoc Task) không cần qua template.
 * @param {{ title, assignedTo, assignedName, priority, note? }} data
 */
function createAdhocTask(data) {
  return withErrorHandling(function() {
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var id = genId('ADHOC');
    var item = {
      ID:           id,
      TemplateID:   'ADHOC',
      Title:        data.title || 'Công việc đột xuất',
      AssignedTo:   data.assignedTo   || '',
      AssignedName: data.assignedName || '',
      DueDate:      todayStr,
      Priority:     data.priority || 'medium',
      Status:       'PENDING',
      CompletedAt:  '',
      CompletedBy:  '',
      Note:         data.note || '',
    };
    appendRowToSheet(SHEETS.TASK_INSTANCES, item);
    invalidateCache(SHEETS.TASK_INSTANCES);
    return { success: true, id: id, data: item };
  });
}

/**
 * Bật/tắt nhanh trạng thái hết hàng của sản phẩm.
 * @param {string} productId
 * @param {'ACTIVE'|'OUT_OF_STOCK'|'INACTIVE'} status
 */
function toggleProductStock(productId, status) {
  return withErrorHandling(function() {
    var ok = updateRowInSheet(SHEETS.PRODUCTS, 'ID', productId, { Status: status });
    CacheService.getScriptCache().removeAll(['menu_pub', 'menu_admin']);
    return { success: ok, productId: productId, status: status };
  });
}
