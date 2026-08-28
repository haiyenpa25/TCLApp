/**
 * API v3.4 (Optimized Engine) \u2014 Ti\u1ec7m C\u1ee7a L\u00e1 Full POS
 * 
 * \u00c1p d\u1ee5ng c\u00e1c t\u1ed1i \u01b0u hi\u1ec7u n\u0103ng cao:
 * 1. O(N+M) Map Hash Indexing: Gom nh\u00f3m chi ti\u1ebft \u0111\u01a1n h\u00e0ng b\u1eb1ng Map thay cho .filter() qu\u00e9t l\u1ed3ng nhau.
 * 2. Targeted Lock Concurrency: S\u1eed d\u1ee5ng LockService v\u1edbi tryLock(2500) v\u00e0 try/finally b\u1ea3o v\u1ec7 giao d\u1ecbch ghi.
 * 3. Batch Writes: D\u00f9ng appendRowsToSheet v\u00e0 setValues() h\u00e0ng lo\u1ea1t.
 * 4. Entity Returns: Tr\u1ea3 v\u1ec1 \u0111\u1ed1i t\u01b0\u1ee3ng v\u1eeba l\u01b0u gi\u00fap Frontend c\u1eadp nh\u1eadt State 0ms (Optimistic UI).
 */

//  Helpers 

/** T\u1ea1o ID duy nh\u1ea5t v\u1edbi prefix. */
function genId(prefix) {
  return prefix + '-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000);
}

/**
 * Wrapper DRY cho try/catch \u2014 b\u1eaft l\u1ed7i v\u00e0 tr\u1ea3 JSON chu\u1ea9n.
 * @param {Function} fn - H\u00e0m thu\u1ea7n logic, tr\u1ea3 v\u1ec1 data
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

function withLock(fn, timeoutMs) {
  timeoutMs = timeoutMs || 10000;
  return withErrorHandling(function() {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(timeoutMs);
      return fn();
    } finally {
      try { lock.releaseLock(); } catch(e) {}
    }
  });
}

/**
 * L\u1ea5y to\u00e0n b\u1ed9 d\u1eef li\u1ec7u kh\u1edfi \u0111\u1ed9ng \u1ee9ng d\u1ee5ng trong 1 l\u1ea7n g\u1ecdi duy nh\u1ea5t (Single RPC Roundtrip).
 * T\u1ed1i \u01b0u theo ti\u00eau chu\u1ea9n GGSheet-QLHT: Kh\u00f4ng g\u1eedi nhi\u1ec1u request l\u1ebb g\u00e2y lock contention tr\u00ean Google Apps Script.
 */
function getInitialData() {
  return withErrorHandling(function() {
    try {
      var checkProds = getSheetData(SHEETS.PRODUCTS, false);
      var hasCoffee = checkProds.some(function(p) { return p.ID === 'P-CF01'; });
      if (!hasCoffee) {
        standardizeMenu();
      }
    } catch(e) {}
    var menuRes = getMenu();
    var tablesRes = getTables();
    var activeOrdersRes = getActiveOrders();
    var tasksRes = getTasksForToday();
    var expensesRes = getExpenses();
    var staffRes = getStaff();
    var customersRes = getCustomers();
    var settingsRes = getSettings();
    // Tối ưu hóa Fast Boot: Báo cáo chi tiết sẽ tải Lazy khi vào tab Báo Cáo
    var reportRes = { success: true, data: null };

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
 * Helper gom nh\u00f3m m\u1ea3ng Order_Details theo OrderID b\u1eb1ng Map trong 1 l\u1ea7n duy\u1ec7t O(M).
 * @param {Object[]} details - Danh s\u00e1ch chi ti\u1ebft m\u00f3n
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
 * X\u1eed l\u00fd chu\u1ed7i ti\u1ec1n t\u1ec7 linh ho\u1ea1t (h\u1ed7 tr\u1ee3 s\u1ed1 thu\u1ea7n ho\u1eb7c chu\u1ed7i \u0111\u1ecbnh d\u1ea1ng "12.000" / "415.000").
 * @param {any} val - Gi\u00e1 tr\u1ecb s\u1ed1 ho\u1eb7c chu\u1ed7i
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
 * Chu\u1ea9n h\u00f3a gi\u00e1 tr\u1ecb ng\u00e0y th\u00e1ng t\u1eeb nhi\u1ec1u \u0111\u1ecbnh d\u1ea1ng trong Google Sheets th\u00e0nh YYYY-MM-DD.
 * @param {any} val - Gi\u00e1 tr\u1ecb ng\u00e0y th\u00e1ng
 * @returns {string} Chu\u1ed7i YYYY-MM-DD
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

//  AUTH 

/** X\u00e1c minh PIN admin. */
function verifyPin(pin) {
  return withErrorHandling(function() {
    var stored = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '1234';
    return { success: true, valid: String(pin) === stored };
  });
}

/** \u0110\u1ed5i PIN admin. */
function changePin(oldPin, newPin) {
  return withErrorHandling(function() {
    var stored = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '1234';
    if (String(oldPin) !== stored) return { success: false, error: 'PIN c\u0169 kh\u00f4ng \u0111\u00fang' };
    PropertiesService.getScriptProperties().setProperty('ADMIN_PIN', String(newPin));
    return { success: true };
  });
}

//  SETTINGS 

function getSettings() {
  return withErrorHandling(function() {
    var cache = CacheService.getScriptCache();
    var hit   = cache.get('settings');
    if (hit) return { success: true, data: JSON.parse(hit) };
    var p = PropertiesService.getScriptProperties();
    var data = {
      shopName:    p.getProperty('SHOP_NAME')    || 'Ti\u1ec7m C\u1ee7a L\u00e1',
      slogan:      p.getProperty('SHOP_SLOGAN')  || 'Ng\u1ed3i b\u00ean L\u00e1 qu\u00ean v\u1ed9i v\u00e3',
      phone:       p.getProperty('SHOP_PHONE')   || '0877 11 58 36',
      facebook:    p.getProperty('SHOP_FB')      || '',
      bankId:      p.getProperty('BANK_ID')      || '970436',
      accountNo:   p.getProperty('ACCOUNT_NO')   || '1018704944',
      accountName: p.getProperty('ACCOUNT_NAME') || 'TRUONG HOAI DINH',
      logoUrl:     p.getProperty('SHOP_LOGO_URL') || '',
      bannerUrl:   p.getProperty('SHOP_BANNER_URL') || ''
    };
    cache.put('settings', JSON.stringify(data), 300);
    return { success: true, data: data };
  });
}

function saveSettings(data) {
  return withLock(function() {
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

//  MENU (Customer) 

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

//  PRODUCTS CRUD (Admin) 

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
  return withLock(function() {
    var id = 'P-' + new Date().getTime();
    var imgVal = data.image || '';
    if (imgVal.length > 49000) imgVal = ''; // Bảo vệ giới hạn 50k ký tự ô Google Sheet
    var item = {
      ID: id, Name: data.name, Category: data.category,
      Price: Number(data.price), Image: imgVal,
      HasSize: !!data.hasSize, HasIce: !!data.hasIce, HasSugar: !!data.hasSugar, Status: 'ACTIVE'
    };
    appendRowToSheet(SHEETS.PRODUCTS, item);
    CacheService.getScriptCache().removeAll(['menu_pub', 'menu_admin']);
    return { success: true, id: id, data: item };
  });
}

function updateProduct(id, data) {
  return withLock(function() {
    var updates = {};
    if (data.name     !== undefined) updates.Name     = data.name;
    if (data.category !== undefined) updates.Category = data.category;
    if (data.price    !== undefined) updates.Price    = Number(data.price);
    if (data.image    !== undefined) {
      var imgVal = data.image || '';
      if (imgVal.length > 49000) imgVal = ''; // Bảo vệ giới hạn 50k ký tự ô Google Sheet
      updates.Image = imgVal;
    }
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
  return withLock(function() {
    var ok = deleteRowFromSheet(SHEETS.PRODUCTS, 'ID', id);
    invalidateCache(SHEETS.PRODUCTS);
    try {
      CacheService.getScriptCache().removeAll(['menu_pub', 'menu_admin', 'TCL_DB_Products']);
    } catch(e) {}
    return { success: ok, id: id };
  });
}

//  TOPPINGS CRUD 

function addTopping(data) {
  return withLock(function() {
    var id = 'T-' + new Date().getTime();
    var item = { ID: id, Name: data.name, Price: Number(data.price), Status: 'ACTIVE' };
    appendRowToSheet(SHEETS.TOPPINGS, item);
    CacheService.getScriptCache().removeAll(['menu_pub', 'menu_admin']);
    return { success: true, id: id, data: item };
  });
}

function updateTopping(id, data) {
  return withLock(function() {
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
  return withLock(function() {
    var ok = deleteRowFromSheet(SHEETS.TOPPINGS, 'ID', id);
    invalidateCache(SHEETS.TOPPINGS);
    try {
      CacheService.getScriptCache().removeAll(['menu_pub', 'menu_admin', 'TCL_DB_Toppings']);
    } catch(e) {}
    return { success: ok, id: id };
  });
}

/**
 * T\u1ea3i \u1ea3nh s\u1ea3n ph\u1ea9m l\u00ean Google Drive v\u00e0 t\u1ea1o direct link.
 * @param {string} base64Data - D\u1eef li\u1ec7u base64 (c\u00f3 th\u1ec3 c\u00f3 ti\u1ec1n t\u1ed1 data:image/...)
 * @param {string} fileName - T\u00ean file
 * @returns {{ success: boolean, url?: string, fileId?: string, error?: string }}
 */
function uploadProductImage(base64Data, fileName) {
  return withErrorHandling(function() {
    if (!base64Data) return { success: false, error: 'D\u1eef li\u1ec7u \u1ea3nh r\u1ed7ng' };

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

//  ORDERS 

/** T\u1ea1o c\u00e1c h\u00e0ng chi ti\u1ebft \u0111\u01a1n h\u00e0ng (d\u00f9ng chung cho submitOrder v\u00e0 editOrder). */
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

/** T\u1ed1i \u01b0u submitOrder v\u1edbi LockService v\u00e0 Batch appendRowsToSheet */

/**
 * Thu\u1eadt to\u00e1n t\u00ednh gi\u00e1 Authoritative tr\u00ean Server (P0 Security & Data Integrity).
 * Server t\u1ef1 \u0111\u1ecdc b\u1ea3ng gi\u00e1 Products & Toppings t\u1eeb Google Sheets \u0111\u1ec3 t\u00ednh to\u00e1n.
 */
function _calculateOrderAuthoritative(rawItems, products, toppings) {
  var prodMap = new Map();
  if (products && products.length) {
    products.forEach(function(p) { prodMap.set(String(p.ID), p); });
  }
  var topMap = new Map();
  if (toppings && toppings.length) {
    toppings.forEach(function(t) {
      topMap.set(String(t.Name).trim().toLowerCase(), t);
      topMap.set(String(t.ID), t);
    });
  }

  var total = 0;
  var computedItems = (rawItems || []).map(function(item, idx) {
    var p = prodMap.get(String(item.productId));
    var basePrice = p ? (Number(p.Price) || 0) : (Number(item.price) || 0);

    // Size Delta
    var sizeDelta = 0;
    var sz = String(item.size || '').toUpperCase();
    if (sz === 'M') sizeDelta = 5000;
    else if (sz === 'L') sizeDelta = 10000;

    // Toppings Delta
    var topDelta = 0;
    var topArr = Array.isArray(item.toppings) ? item.toppings : (item.toppings ? String(item.toppings).split(', ') : []);
    topArr.forEach(function(tName) {
      var topObj = topMap.get(String(tName).trim().toLowerCase()) || topMap.get(String(tName).trim());
      if (topObj) {
        topDelta += Number(topObj.Price) || 5000;
      } else {
        topDelta += 5000;
      }
    });

    var unitPrice = basePrice + sizeDelta + topDelta;
    var qty = Math.max(1, parseInt(item.quantity, 10) || 1);
    var subtotal = unitPrice * qty;
    total += subtotal;

    return {
      productId: item.productId || (p ? p.ID : ''),
      productName: p ? p.Name : (item.productName || 'M\u00f3n'),
      size: item.size || 'M',
      ice: item.ice || '100% \u0110\u00e1',
      sugar: item.sugar || '100% \u0110\u01b0\u1eddng',
      toppings: topArr,
      quantity: qty,
      price: unitPrice,
      subtotal: subtotal,
      note: item.note || ''
    };
  });

  return { items: computedItems, totalAmount: total };
}

/** T\u1ed1i \u01b0u submitOrder v\u1edbi Server Authoritative Pricing, LockService v\u00e0 Batch writes */
function submitOrder(payload) {
  return withErrorHandling(function() {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(3500)) {
      return { success: false, error: 'H\u1ec7 th\u1ed1ng \u0111ang x\u1eed l\u00fd \u0111\u01a1n kh\u00e1c, vui l\u00f2ng th\u1eed l\u1ea1i sau gi\u00e2y l\u00e1t.' };
    }

    try {
      var products = getSheetData(SHEETS.PRODUCTS, false);
      var toppings = getSheetData(SHEETS.TOPPINGS, false);
      var calcResult = _calculateOrderAuthoritative(payload.items, products, toppings);

      var orderId = 'ORD-' + new Date().getTime();
      var orderType = payload.orderType || 'DINE_IN';
      var customerId = payload.customerId || '';
      var discountAmount = 0;

      // X l khch hng v gim gi tch im
      if (!customerId && payload.customerPhone) {
        var existingCust = getSheetData(SHEETS.CUSTOMERS, false).find(function(c) { return String(c.Phone) === String(payload.customerPhone); });
        if (existingCust) {
          customerId = existingCust.ID;
        } else {
          customerId = 'CUS-' + new Date().getTime();
          appendRowToSheet(SHEETS.CUSTOMERS, {
            ID: customerId, Name: payload.customerName || 'Kh\u00e1ch h\u00e0ng',
            Phone: payload.customerPhone || '', Type: 'C\u00e1 nh\u00e2n', Company: '',
            Address: payload.deliveryAddress || '', Email: '',
            Points: 0, TotalSpent: 0,
            CreatedAt: new Date().toISOString(), Note: '',
          });
          invalidateCache(SHEETS.CUSTOMERS);
        }
      }

      // Kim tra i im hp l (10 im = 10.000)
      if (customerId && payload.usePointsDiscount) {
        var cust = getSheetData(SHEETS.CUSTOMERS, false).find(function(c) { return c.ID === customerId; });
        if (cust && (Number(cust.Points) || 0) >= 10) {
          discountAmount = 10000;
          updateRowInSheet(SHEETS.CUSTOMERS, 'ID', customerId, {
            Points: (Number(cust.Points) || 0) - 10
          });
          appendRowToSheet(SHEETS.POINT_LEDGER, {
            ID: genId('LED'), CustomerID: customerId, OrderID: orderId,
            Type: 'REDEEM', Points: -10, CreatedAt: new Date().toISOString(),
            Note: '\u0110\u1ed5i 10 \u0111i\u1ec3m gi\u1ea3m 10.000\u0111 cho \u0111\u01a1n ' + orderId
          });
          invalidateCache(SHEETS.CUSTOMERS);
        }
      }

      var finalTotal = Math.max(0, calcResult.totalAmount - discountAmount);

      var newOrder = {
        ID: orderId,
        TableID: payload.tableId || '',
        TableSessionID: payload.tableId ? ('TS-' + payload.tableId + '-' + new Date().toISOString().substring(0,10)) : '',
        TotalAmount: finalTotal,
        Status: 'NEW',
        KitchenStatus: 'NEW',
        PaymentStatus: 'UNPAID',
        Source: payload.source || 'POS',
        OrderType: orderType,
        CustomerID: customerId,
        CustomerName: payload.customerName || '',
        CustomerPhone: payload.customerPhone || '',
        DeliveryAddress: payload.deliveryAddress || '',
        CreatedAt: new Date().toISOString(),
        Note: payload.note || '',
      };

      appendRowToSheet(SHEETS.ORDERS, newOrder);

      if (payload.tableId && orderType === 'DINE_IN') {
        updateRowInSheet(SHEETS.TABLES, 'ID', payload.tableId, { Status: 'OCCUPIED' });
      }

      // Batch Insert Order Details
      var detSheet = getSheet(SHEETS.ORDER_DETAILS);
      var rows = _buildOrderDetailRows(orderId, calcResult.items, detSheet);
      if (rows.length > 0) {
        detSheet.getRange(detSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
        invalidateCache(SHEETS.ORDER_DETAILS);
      }

      var fullOrderData = Object.assign({}, newOrder, { items: calcResult.items });
      return { success: true, orderId: orderId, data: fullOrderData };
    } finally {
      lock.releaseLock();
    }
  });
}

/** T\u1ed0I \u01afU P0: getOrders() d\u00f9ng Map Grouping O(N+M) thay v\u00ec .filter() l\u1ed3ng O(N*M) */
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
    if (!order) return { success: false, error: 'Kh\u00f4ng t\u00ecm th\u1ea5y \u0111\u01a1n' };
    var details = getSheetData(SHEETS.ORDER_DETAILS, false);
    var items = details.filter(function(d) { return d.OrderID === orderId; });
    return { success: true, data: Object.assign({}, order, { items: items }) };
  });
}

/** T\u1ed0I \u01afU P0: getOrderHistory() d\u00f9ng Map Grouping v\u00e0 t\u00ednh to\u00e1n trong 1 l\u01b0\u1ee3t duy\u1ec7t */
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
    if (!order) return { success: false, error: 'Kh\u00f4ng t\u00ecm th\u1ea5y \u0111\u01a1n' };

    // Hon im khi hy n c khch hng
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

    // Gii phng bn khi n hon thnh/hy v khng cn n active khc
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

/** T\u1ed1i \u01b0u editOrder v\u1edbi Lock v\u00e0 Batch update details */
function editOrder(payload) {
  return withErrorHandling(function() {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(2500)) return { success: false, error: 'H\u1ec7 th\u1ed1ng \u0111ang b\u1eadn, vui l\u00f2ng th\u1eed l\u1ea1i.' };

    try {
      var orderId = payload.orderId;
      var orders  = getSheetData(SHEETS.ORDERS, false);
      var order   = orders.find(function(o) { return o.ID === orderId; });
      if (!order) return { success: false, error: 'Kh\u00f4ng t\u00ecm th\u1ea5y \u0111\u01a1n h\u00e0ng' };
      if (!['NEW','PREPARING','PACKING'].includes(order.Status)) {
        return { success: false, error: 'Ch\u1ec9 c\u00f3 th\u1ec3 s\u1eeda \u0111\u01a1n M\u1edaI, \u0110ANG PHA ho\u1eb7c \u0110\u00d3NG G\u00d3I' };
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

      // Ti u Batch: Lc li Order_Details trong RAM v ghi li ton b bng
      var detSheet = getSheet(SHEETS.ORDER_DETAILS);
      var detData = detSheet.getDataRange().getValues();
      var headers = detData[0];
      var orderIdCol = headers.indexOf('OrderID');

      // Gi li cc dng khng thuc order ny
      var remainingRows = detData.slice(1).filter(function(r) { return r[orderIdCol] !== orderId; });
      
      // To cc dng mi
      var newRows = _buildOrderDetailRows(orderId + '-E', payload.items, detSheet);
      var combined = remainingRows.concat(newRows);

      // Xa v ghi li theo l
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

//  TABLES 

function getTables() {
  return withErrorHandling(function() {
    var tables = getSheetData(SHEETS.TABLES, false);
    var orders = getSheetData(SHEETS.ORDERS, false);
    
    // m active orders bng Map O(N+M)
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
  return withLock(function() {
    return { success: updateRowInSheet(SHEETS.TABLES, 'ID', tableId, { Status: 'FREE' }) };
  });
}

function addTable(data) {
  return withLock(function() {
    var existing = getSheetData(SHEETS.TABLES, false);
    var id = 'TBL' + String(existing.length + 1).padStart(2, '0');
    var item = {
      ID: id, Name: data.name || ('B\u00e0n ' + (existing.length + 1)),
      Status: 'FREE', Capacity: data.capacity || 4, QR_URL: '',
    };
    appendRowToSheet(SHEETS.TABLES, item);
    return { success: true, id: id, data: item };
  });
}

function deleteTable(id) {
  return withLock(function() {
    deleteRowFromSheet(SHEETS.TABLES, 'ID', id);
    return { success: true, id: id };
  });
}

function switchTable(fromTableId, toTableId) {
  return withErrorHandling(function() {
    if (!fromTableId || !toTableId) return { success: false, error: 'Thi\u1ebfu th\u00f4ng tin b\u00e0n chuy\u1ec3n' };
    if (fromTableId === toTableId) return { success: false, error: 'B\u00e0n chuy\u1ec3n v\u00e0 b\u00e0n nh\u1eadn ph\u1ea3i kh\u00e1c nhau' };

    var orders = getSheetData(SHEETS.ORDERS, false);
    var activeFrom = orders.filter(function(o) {
      return o.TableID === fromTableId && ['NEW','PREPARING','PACKING','SERVING'].includes(o.Status);
    });

    if (activeFrom.length === 0) {
      return { success: false, error: 'B\u00e0n ngu\u1ed3n kh\u00f4ng c\u00f3 \u0111\u01a1n h\u00e0ng \u0111ang ph\u1ee5c v\u1ee5' };
    }

    // Chuyn ton b n active sang bn mi
    for (var i = 0; i < activeFrom.length; i++) {
      updateRowInSheet(SHEETS.ORDERS, 'ID', activeFrom[i].ID, { TableID: toTableId });
    }

    // Cp nht trng thi 2 bn
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

//  EXPENSES 

function addExpense(data) {
  return withLock(function() {
    var id   = 'EXP-' + new Date().getTime();
    var date = data.date || new Date().toISOString().split('T')[0];
    var item = {
      ID: id, Date: date, Category: data.category || 'Kh\u00e1c',
      Description: data.description, Amount: Number(data.amount),
      Note: data.note || '', FundingSource: data.fundingSource || 'Ti\u1ec1n qu\u00e1n',
      PerformedBy: data.performedBy || '', PerformedByName: data.performedByName || ''
    };
    appendRowToSheet(SHEETS.EXPENSES, item);
    return { success: true, id: id, data: item };
  });
}

function getExpenses(date) {
  return withErrorHandling(function() {
    var all = getSheetData(SHEETS.EXPENSES, false);
    var mapped = all.map(function(e) {
      return {
        ID: e.ID,
        Date: _extractDateStr(e.Date),
        Category: e.Category || 'Kh\u00e1c',
        Description: e.Description || '',
        Amount: _parseCurrency(e.Amount),
        Note: e.Note || '',
        FundingSource: e.FundingSource || 'Ti\u1ec1n qu\u00e1n',
        PerformedBy: e.PerformedBy || '',
        PerformedByName: e.PerformedByName || '',
        ReceiptImage: e.ReceiptImage || ''
      };
    });
    var filtered = date ? mapped.filter(function(e) { return String(e.Date).startsWith(date); }) : mapped;
    var total = filtered.reduce(function(s, e) { return s + (e.Amount || 0); }, 0);
    filtered.sort(function(a, b) { return (b.Date > a.Date) ? 1 : ((b.Date < a.Date) ? -1 : 0); });
    return { success: true, data: { expenses: filtered, total: total } };
  });
}

function deleteExpense(id) {
  return withLock(function() {
    deleteRowFromSheet(SHEETS.EXPENSES, 'ID', id);
    return { success: true, id: id };
  });
}

function updateExpense(id, data) {
  return withLock(function() {
    var updates = {};
    if (data.date            !== undefined) updates.Date            = _extractDateStr(data.date);
    if (data.category        !== undefined) updates.Category        = data.category;
    if (data.description     !== undefined) updates.Description     = data.description;
    if (data.amount          !== undefined) updates.Amount          = _parseCurrency(data.amount);
    if (data.note            !== undefined) updates.Note            = data.note;
    if (data.fundingSource   !== undefined) updates.FundingSource   = data.fundingSource;
    if (data.performedBy     !== undefined) updates.PerformedBy     = data.performedBy;
    if (data.performedByName !== undefined) updates.PerformedByName = data.performedByName;
    if (data.receiptImage    !== undefined) updates.ReceiptImage    = data.receiptImage;
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
      var cat = e.Category || 'Kh\u00e1c';
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

// ── REPORT ──────────────────────────────────────────────────────────────────

/**
 * TỐI ƯU P0: getReportByRange() tổng hợp dữ liệu Doanh thu, Chi phí, Lợi nhuận và Top món.
 */
function getReportByRange(params) {
  return withErrorHandling(function() {
    var today = _extractDateStr(new Date());
    var from  = (params && params.dateFrom) ? params.dateFrom : '2000-01-01';
    var to    = (params && params.dateTo)   ? params.dateTo   : '2099-12-31';

    var allOrders   = getSheetData(SHEETS.ORDERS, false);
    var allDetails  = getSheetData(SHEETS.ORDER_DETAILS, false);
    var allExp      = getSheetData(SHEETS.EXPENSES, false);

    // Lọc đơn hàng COMPLETED trong khoảng ngày
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

    // Khởi tạo bảng giờ hoạt động
    var hourlyMap = {};
    for (var h = 7; h <= 22; h++) {
      var hStr = String(h).padStart(2, '0') + ':00';
      hourlyMap[hStr] = 0;
    }

    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      var amt = _parseCurrency(o.TotalAmount);
      totalRevenue += amt;
      orderIds.add(o.ID);
      var d = _extractDateStr(o.CreatedAt);
      if (!byDay[d]) byDay[d] = { date: d, revenue: 0, orders: 0 };
      byDay[d].revenue += amt;
      byDay[d].orders  += 1;

      // Phân bổ giờ
      if (o.CreatedAt) {
        var hourStr = o.CreatedAt.length >= 13 ? (o.CreatedAt.substring(11, 13) + ':00') : '08:00';
        if (hourlyMap[hourStr] !== undefined) hourlyMap[hourStr] += amt;
      }

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
        PaymentMethod: pMethod || 'CASH'
      });
    }

    var totalOrders = orders.length;
    var dailyData = Object.values(byDay).sort(function(a, b) { return a.date > b.date ? 1 : -1; });
    var hourlyStats = Object.keys(hourlyMap).map(function(k) {
      return { hour: k, revenue: hourlyMap[k] };
    });

    var totalExpenses = allExp
      .filter(function(e) { 
        var d = _extractDateStr(e.Date); 
        return d >= from && d <= to; 
      })
      .reduce(function(s, e) { return s + _parseCurrency(e.Amount); }, 0);

    // Top sản phẩm bán chạy
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

    orderList.sort(function(a, b) { return (b.CreatedAt > a.CreatedAt) ? 1 : -1; });

    var netProfit = totalRevenue - totalExpenses;

    return { success: true, data: {
      dateFrom: from, dateTo: to,
      totalRevenue: totalRevenue,
      totalOrders: totalOrders,
      avgOrder: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
      totalExpenses: totalExpenses,
      netProfit: netProfit,
      profit: netProfit,
      dailyData: dailyData,
      hourlyStats: hourlyStats,
      topProducts: topProducts,
      orderList: orderList.slice(0, 50),
      paymentBreakdown: {
        cashRevenue: cashRevenue,
        cashOrders: cashOrders,
        transferRevenue: transferRevenue,
        transferOrders: transferOrders,
      }
    }};
  });
}

function getReport(period, dateFrom, dateTo) {
  return withErrorHandling(function() {
    var p = (typeof period === 'object' && period !== null) ? (period.period || 'month') : (period || 'month');
    var from = '2000-01-01', to = '2099-12-31';
    var now = new Date();
    var tz = Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh';
    var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

    if (p === 'today') {
      from = todayStr;
      to = todayStr;
    } else if (p === 'yesterday') {
      var yest = new Date(now.getTime() - 86400000);
      var yestStr = Utilities.formatDate(yest, tz, 'yyyy-MM-dd');
      from = yestStr;
      to = yestStr;
    } else if (p === 'week') {
      var w = new Date(now.getTime() - 6 * 86400000);
      from = Utilities.formatDate(w, tz, 'yyyy-MM-dd');
      to = todayStr;
    } else if (p === 'month') {
      var y = now.getFullYear();
      var m = String(now.getMonth() + 1).padStart(2, '0');
      from = y + '-' + m + '-01';
      to = y + '-' + m + '-31';
    } else if (p === 'all' || p === 'all_time') {
      from = '2000-01-01';
      to = '2099-12-31';
    } else if (p === 'custom') {
      from = (typeof period === 'object' && period.dateFrom) ? period.dateFrom : (dateFrom || '2000-01-01');
      to   = (typeof period === 'object' && period.dateTo)   ? period.dateTo   : (dateTo || from);
    }

    return getReportByRange({ dateFrom: from, dateTo: to });
  });
}

//  CUSTOMERS 

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
  return withLock(function() {
    if (data.id) {
      updateRowInSheet(SHEETS.CUSTOMERS, 'ID', data.id, {
        Name: data.name || '', Phone: data.phone || '',
        Type: data.type || 'C\u00e1 nh\u00e2n', Company: data.company || '',
        Address: data.address || '', Email: data.email || '', Note: data.note || '',
      });
      invalidateCache(SHEETS.CUSTOMERS);
      return { success: true, id: data.id, data: data };
    }
    var id = 'CUS-' + new Date().getTime();
    var item = {
      ID: id, Name: data.name || '', Phone: data.phone || '',
      Type: data.type || 'C\u00e1 nh\u00e2n', Company: data.company || '',
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

//  ALIAS BRIDGE (Frontend  Backend) 

function getActiveOrders() { return getOrders(); }
function createOrder(data) { return submitOrder(data); }
function updateOrder(data) { return editOrder(data); }
function cancelOrder(orderId) { return updateOrderStatus(orderId, 'CANCELLED'); }
function getOrderById(orderId) { return getOrderStatus(orderId); }

function checkoutOrder(payload, extraData) {
  return withErrorHandling(function() {
    var orderId = typeof payload === 'string' ? payload : (payload ? payload.orderId : '');
    var pd = (typeof payload === 'object' && payload.method) ? payload : (extraData || {});
    var method = (pd.method || pd.paymentMethod || 'CASH').toUpperCase();
    var receivedAmount = Number(pd.receivedAmount || pd.cashAmount || pd.amount || 0);
    var cashierName = pd.cashierName || 'Thu Ng\u00e2n';
    var note = pd.note || '';

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(3500)) return { success: false, error: 'H\u1ec7 th\u1ed1ng \u0111ang b\u1eadn, vui l\u00f2ng th\u1eed l\u1ea1i sau gi\u00e2y l\u00e1t.' };

    try {
      var orders = getSheetData(SHEETS.ORDERS, false);
      var order  = orders.find(function(o) { return o.ID === orderId; });
      if (!order) return { success: false, error: 'Kh\u00f4ng t\u00ecm th\u1ea5y \u0111\u01a1n h\u00e0ng: ' + orderId };

      var total = Number(order.TotalAmount) || 0;
      if (receivedAmount <= 0) receivedAmount = total;
      var changeAmount = Math.max(0, receivedAmount - total);

      // 1. Cp nht Order trng thi  Thanh Ton &  Hon Tt
      updateRowInSheet(SHEETS.ORDERS, 'ID', orderId, {
        Status: 'COMPLETED',
        PaymentStatus: 'PAID'
      });
      invalidateCache(SHEETS.ORDERS);

      // 2. Ghi nhn giao dch vo bng Payments (P0 Money)
      var paymentRecord = {
        ID: genId('PAY'),
        OrderID: orderId,
        TableSessionID: order.TableSessionID || '',
        Amount: total,
        Method: method,
        ReceivedAmount: receivedAmount,
        ChangeAmount: changeAmount,
        Status: 'COMPLETED',
        TransactionRef: pd.transactionRef || '',
        CashierName: cashierName,
        CreatedAt: new Date().toISOString(),
        Note: note
      };
      appendRowToSheet(SHEETS.PAYMENTS, paymentRecord);
      invalidateCache(SHEETS.PAYMENTS);

      // 3. Gii phng bn nu l DINE_IN
      if (order.TableID) {
        var remainingTableOrders = orders.filter(function(o) {
          return o.TableID === order.TableID && o.ID !== orderId &&
                 ['NEW','PREPARING','PACKING','SERVING'].includes(o.Status);
        });
        if (remainingTableOrders.length === 0) {
          updateRowInSheet(SHEETS.TABLES, 'ID', order.TableID, { Status: 'FREE' });
          invalidateCache(SHEETS.TABLES);
        }
      }

      // 4. Tch im hi vin an ton vo CustomerPointLedger (10.000 = 1 im, ch pht sinh khi PAID)
      if (order.CustomerID) {
        var earnPts = Math.floor(total / 10000);
        if (earnPts > 0) {
          var customer = getSheetData(SHEETS.CUSTOMERS, false).find(function(c) { return c.ID === order.CustomerID; });
          if (customer) {
            updateRowInSheet(SHEETS.CUSTOMERS, 'ID', order.CustomerID, {
              Points: (Number(customer.Points) || 0) + earnPts,
              TotalSpent: (Number(customer.TotalSpent) || 0) + total,
            });
            appendRowToSheet(SHEETS.POINT_LEDGER, {
              ID: genId('LED'),
              CustomerID: order.CustomerID,
              OrderID: orderId,
              Type: 'EARN',
              Points: earnPts,
              CreatedAt: new Date().toISOString(),
              Note: 'T\u00edch ' + earnPts + ' \u0111i\u1ec3m t\u1eeb \u0111\u01a1n h\u00e0ng ' + orderId
            });
            invalidateCache(SHEETS.CUSTOMERS);
            invalidateCache(SHEETS.POINT_LEDGER);
          }
        }
      }

      return {
        success: true,
        orderId: orderId,
        totalAmount: total,
        receivedAmount: receivedAmount,
        changeAmount: changeAmount,
        payment: paymentRecord
      };
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
  return withLock(function() {
    var allowed = ['FREE', 'OCCUPIED', 'RESERVED'];
    var st = String(status).toUpperCase();
    if (!allowed.includes(st)) return { success: false, error: 'Tr\u1ea1ng th\u00e1i kh\u00f4ng h\u1ee3p l\u1ec7: ' + status };
    var ok = updateRowInSheet(SHEETS.TABLES, 'ID', tableId, { Status: st });
    invalidateCache(SHEETS.TABLES);
    return { success: ok, tableId: tableId, status: st };
  });
}

function getRevenueReport(params) { return getReportByRange(params); }

//  STAFF CRUD 

function getStaff() {
  return withErrorHandling(function() {
    var staff = getSheetData(SHEETS.STAFF, false)
      .filter(function(s) { return s.Status !== 'INACTIVE'; });
    return { success: true, data: staff };
  });
}

function addStaff(data) {
  return withLock(function() {
    var name = (data && data.name) ? String(data.name).trim() : '';
    if (!name) return { success: false, error: 'T\u00ean nh\u00e2n vi\u00ean kh\u00f4ng \u0111\u01b0\u1ee3c r\u1ed7ng' };
    var id = genId('NV');
    var item = { ID: id, Name: name, Status: 'ACTIVE' };
    appendRowToSheet(SHEETS.STAFF, item);
    invalidateCache(SHEETS.STAFF);
    return { success: true, id: id, data: item };
  });
}

function updateStaff(data) {
  return withLock(function() {
    if (!data || !data.id) return { success: false, error: 'Thi\u1ebfu ID' };
    var updates = {};
    if (data.name)   updates.Name   = String(data.name).trim();
    if (data.status) updates.Status = data.status;
    updateRowInSheet(SHEETS.STAFF, 'ID', data.id, updates);
    invalidateCache(SHEETS.STAFF);
    return { success: true, id: data.id, data: updates };
  });
}

function deactivateStaff(id) {
  return withLock(function() {
    updateRowInSheet(SHEETS.STAFF, 'ID', id, { Status: 'INACTIVE' });
    invalidateCache(SHEETS.STAFF);
    return { success: true, id: id };
  });
}

//  TASK TEMPLATES CRUD 

function getTaskTemplates() {
  return withErrorHandling(function() {
    var templates = getSheetData(SHEETS.TASK_TEMPLATES, false);
    return { success: true, data: templates };
  });
}

function addTaskTemplate(data) {
  return withLock(function() {
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
  return withLock(function() {
    if (!data || !data.id) return { success: false, error: 'Thi\u1ebfu ID template' };
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
  return withLock(function() {
    updateRowInSheet(SHEETS.TASK_TEMPLATES, 'ID', id, { Status: 'DELETED' });
    invalidateCache(SHEETS.TASK_TEMPLATES);
    return { success: true, id: id };
  });
}

function toggleTaskTemplate(id) {
  return withLock(function() {
    var templates = getSheetData(SHEETS.TASK_TEMPLATES, false);
    var t = templates.find(function(x) { return x.ID === id; });
    if (!t) return { success: false, error: 'Template kh\u00f4ng t\u1ed3n t\u1ea1i' };
    var newStatus = (t.Status === 'ACTIVE') ? 'PAUSED' : 'ACTIVE';
    updateRowInSheet(SHEETS.TASK_TEMPLATES, 'ID', id, { Status: newStatus });
    invalidateCache(SHEETS.TASK_TEMPLATES);
    return { success: true, status: newStatus };
  });
}

//  Task Instance helpers & API 

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
  return withLock(function() {
    updateRowInSheet(SHEETS.TASK_INSTANCES, 'ID', id, {
      Status: 'SKIPPED',
      Note:   note || '',
    });
    invalidateCache(SHEETS.TASK_INSTANCES);
    return { success: true, id: id, status: 'SKIPPED' };
  });
}

/**
 * T\u1ea1o c\u00f4ng vi\u1ec7c \u0111\u1ed9t xu\u1ea5t trong ng\u00e0y (Ad-hoc Task) kh\u00f4ng c\u1ea7n qua template.
 * @param {{ title, assignedTo, assignedName, priority, note? }} data
 */
function createAdhocTask(data) {
  return withErrorHandling(function() {
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var id = genId('ADHOC');
    var item = {
      ID:           id,
      TemplateID:   'ADHOC',
      Title:        data.title || 'C\u00f4ng vi\u1ec7c \u0111\u1ed9t xu\u1ea5t',
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
 * B\u1eadt/t\u1eaft nhanh tr\u1ea1ng th\u00e1i h\u1ebft h\u00e0ng c\u1ee7a s\u1ea3n ph\u1ea9m.
 * @param {string} productId
 * @param {'ACTIVE'|'OUT_OF_STOCK'|'INACTIVE'} status
 */
function toggleProductStock(productId, status) {
  return withLock(function() {
    var ok = updateRowInSheet(SHEETS.PRODUCTS, 'ID', productId, { Status: status });
    CacheService.getScriptCache().removeAll(['menu_pub', 'menu_admin']);
    return { success: ok, productId: productId, status: status };
  });
}


/**
 * Bootstrap an to\u00e0n d\u00e0nh ri\u00eang cho Kh\u00e1ch Qu\u00e9t QR B\u00e0n (Customer Mode).
 * Ch\u1ec9 tr\u1ea3 Menu & Th\u00f4ng tin b\u00e0n, tuy\u1ec7t \u0111\u1ed1i c\u00e1ch ly kh\u1ecfi CRM, Staff, Chi ph\u00ed & B\u00e1o c\u00e1o.
 */
function getCustomerBootstrap(tableId) {
  return withErrorHandling(function() {
    var menuRes = getMenu();
    var settingsRes = getSettings();
    var tableObj = null;
    if (tableId) {
      var tables = getSheetData(SHEETS.TABLES, false);
      tableObj = tables.find(function(t) { return t.ID === tableId || t.Name === tableId; });
    }

    var pubSettings = {};
    if (settingsRes && settingsRes.data) {
      pubSettings = {
        shopName: settingsRes.data.shopName || 'Ti\u1ec7m C\u1ee7a L\u00e1',
        slogan: settingsRes.data.slogan || '',
        phone: settingsRes.data.phone || '',
        bankId: settingsRes.data.bankId || '970436',
        accountNo: settingsRes.data.accountNo || '',
        accountName: settingsRes.data.accountName || ''
      };
    }

    return {
      success: true,
      data: {
        shop: pubSettings,
        table: tableObj ? { ID: tableObj.ID, Name: tableObj.Name } : null,
        menu: (menuRes && menuRes.data) ? menuRes.data : { products: [], toppings: [], categories: [] }
      }
    };
  });
}


/**
 * Chuẩn hóa Menu và bổ sung nhóm Cà Phê đặc trưng Tiệm Của Lá.
 */
function standardizeMenu() {
  return withLock(function() {
    var ss = getSpreadsheet();
    var prodSheet = ss.getSheetByName('Products');
    var topSheet = ss.getSheetByName('Toppings');
    if (!prodSheet || !topSheet) return { success: false, error: 'Sheet not found' };

    var prodData = prodSheet.getDataRange().getValues();
    var prodHeaders = prodData[0];
    var idCol = prodHeaders.indexOf('ID');
    var nameCol = prodHeaders.indexOf('Name');
    var catCol = prodHeaders.indexOf('Category');
    var priceCol = prodHeaders.indexOf('Price');
    var sizeCol = prodHeaders.indexOf('HasSize');
    var iceCol = prodHeaders.indexOf('HasIce');
    var sugarCol = prodHeaders.indexOf('HasSugar');
    var statusCol = prodHeaders.indexOf('Status');

    var existingIds = new Set();
    var imgMap = {
      '1783096644752': 'data:image/webp;base64,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',
      '1783096727585': 'data:image/webp;base64,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',
      '1783096794690': 'data:image/webp;base64,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',
      '1783946880512': 'data:image/webp;base64,UklGRixDAABXRUJQVlA4ICBDAAAQwwCdASosAakAPmEmjkWkIiEbXJeIQAYEtQBk3iZIE/E817jvq/+AfdfOj2B9i+Xy+v/vfVh+qvYM/q/988+H1p/vD6mv299Y3/u+tH/H+oL/h+pi9Cfpav79/4vS99QD//+3dyo8PHgh90/JrzN/Ifm38d/ff8x/y/7z7e+JPqp/5fQX+afhD9//fPQf/m/4Lxj+Jn+n/ePyh+Qj8w/oH+v+3/4u/su2s3H/U+gR7o/bP+z/kv897CP1Hmh9pP/J7gP9F/unp3/2/CL9h9gX+t/6r0gf/jzN/r3/D9gz+jf5PrffvZ7RZ+azPsCnpiSrmr55wjiwxcIlBGBfLlJyZGYKn86DjHHFKL8hmyk/zF6etPq9UdskAx65h2dvfZ7NPIjrhNFXbYtnfFkXtop0ycpB+hDIvrMkZ96gHOz8kkcB7aNYh2/51RNWlzDTqjF4X0moujDq1S2dIeIC+XhQ9OtCdBIGdjNCSMOBB8EnjMNeJBpl54SdYYvPoa5+ajLsimqPhPIqpChmhAqyF0ySgOSaujFlqnIz8u2MNVKTT77gX7LZRRt+43m+H7cQjNqeyAhu98CXTtqa8UD56cZj6drkvu17p+wPwLRJmR/6w6WzCpXjAEODjS3BPxI8PPmv8Tkw/oPygIELPv5JHoNYWBKhc5XXOEA/WV6deGiu5lAa6DxIdg7nGroQ9/6or4e+24lqkEKS2W8S+3k4+OW09LY3eXIigbKfpzd8sq65JU1KPZKor0W6YC5/nSSEFVMekomWz8+puTrgp0x9cEUVbF2HWodyKpCoHH4ICJPCc1WYm8ZP79OqZPoq6n2YQU9ONqcwLCiH7CNbJo99Dg/y10Lx+eIO9tDHgei83SRf9hZU7ZNkeap43QOss2vDK3KB84GGPenuxdb3QIV359nCXMUX6bFinNhhftpCfXowyV8UPRAz2M4JCKsjNKrcP73ciDZ73Uj69X9E3UuwbkwiidgnToMxuIYTUpTf9jTbViLak4aC90HGTr2oalH+BZmo6spV3RvfldsihWcMSpZZnLGnfTo9Eh7jfy5yphzLGh+6UrGCvXUVxfurYe3J1Doh3gs1PBRgi6O29ZqfPV0veSBH+YmuRljxzhQ7Lkspj9itsqvE2AW+yR2yi70UY7Si9yO5BaVswh6M0D9F4dqWv1jr34VBpYBaXCDdDTQiL/hHtrfpknpeMa3/GYmOVsXsf2E9dW4jm0j8q7ifyzhV+onFDJE+VnNK908OoAtGmPfc2wscUBagG+oya/s2/C7/BFpnzXxlalznSYGBPCF6N7F4UEwPYEf4E+m+vJg7y/UaH7DqeU/2i4H1/0e2k4CuXbChH+iEWPaFxlSRdDfGTGmTcsJoJJGbwLpeCuM/AgS+m5ib+0WXwWBROKD0rNFnD3vzDahSlZ7vjhdGmhQHr7G8LDAfLa5nUKul0kgLeIyOH+w84sNLn0B+j2cjzdfZWjDJvEXdhx2WRnwHJunt8AmOZq2IhnEkjKHMJrZM3AqQh3/tEWs82GuYs+tOsexe1NIrsWjxES6BKX01H6y3VyIfiAjE3RVQvgzeReYm58JxexzTvlnozye4Icvu7g9qJagT8aNDM2/e399SNfHVK+XcVbR8vgDxl1MpeEdt7UWvaC+jqINt7c4N3wz2pN8S0K0+DkN9EFTN7KYui8addu25foM5E1H0LgGshR0fKGZ4WdLqOkvVjK/wdofcE3trDjnxvlSjNWidSsJvcDIGVOG/30t5DizV/JwpaypT31uvmBr8KaH1ptMP2b6eVcU2gP2nffuFliGT8woOMWwuuPRhrGwiesHlqP8tEMO9JEqFk/6b6n5R+4UbNgsDmJK9wd0nU+PNfJtGhtdy92WzkCB3oFaEpXPA0Ed1T9QM/9Gw9vWHpeDUVe////9R+JTeYp1X2Vj7kJf+OoVwcIJKw2no4676kGUNLhH3T9U2BjPtCF1RGJ8QnjfnovRxqardretGpZRpc6/tSocS02AMzahMuqyte05+rwHglr9jqG44gUTdN30GZX2oe9QucyRl/gQ+DglL+7ePWtBtw6ojoV67hy2Si80VZexts5csPZAA/t2du/vo/y320fBwWJpAnB521SbBPYO6gyA23tEDmrVW/npd8z0ano4X88wP7sofLAJOeGUci6YC+mCxmQBZ6oiT/sqS+1J6t6Wr5KX0ZcZ8/8h1N3tr2gA+CEy10Yp9OyGvillYeWZH3XRYcL5hDPH9mhfQxPcpvPyc4F0r7mSH7mbSZFB/6OwUAUgJre9x6hRnKIzmg1rsW1H2gJ5Y51HdYJIIat8/160tAz3lhD6vFm9o63tayRHel4xCALZb2d9vKYChLaOPG9Nd6RVYRawGml0fQdGsOhTH6gILgun/rFEg8H2nZV5hKIFgquamXqwCS7Ziby31wsh8x2CF2J7knb51IciDnZu1MvYUOlUXn+b3QG/pM37MPWnxy5L/hxCfnoNYzUPLC5Nk/C60JQYZjVFW31kCGhLce3SVnH4qWneRdFxsJRmrNESNgs7RGn50stoUnbPXFgj2Knq4REi8LDL4kCeaAodL8oUfEoXN0V0PMEH4+nn5mZl597bine5u6vQ886fUmfc/VCOPjo0X17YkalS7lo1DoReI619AIYPq1dkCXb2JS3PkacVVw8L8YzEclVgouLsDuKZBPKFhBLJcOX9s43FDdKDkeH4zFJ7FxUQdOXVJvrDrU6G556vi4PCM6oEAbfWy5Oaaq88qiWw2/R7mCdGqIG9/ig7LSh0DfJL72An7mc2Vi31/IUhnAQa4TG/Qo8gGMFHdDF1VYZZKAyWVE9iaCyG679sQp153PB5ZP6UZrSYz8cvRJ40IBV6Xa+7VwV6Bm2fqnlEDdlPMIBsj/okMrvsBeplFVerYnCyEDNZR1B/Kw9htHoRa14zMbTjb8kfqc8+gvbiWDpfsoXJ0/yFJc8bGdBNckqaltsbavrUJUQp1w1wGHeBgb1BnAfbzlz3Md+gvtqAVbrYlP38XQunDyOT0kq9KbMgfv/8VYMMOIpo6aqKNK958I/LPDTYPQLylMpN+IsFYL+Xf2O6ul37jZVEwK/wl7Cbgk53eVMt6XlMK3P8dIi1sZM5GcKz0fARnhCTrq5LMTEraN9SvkQdCbaJgcsHR7MR9x2Qu2Wn5gZi3rqo6mYQGnFyBiQGtRzW+9saC4OvVbC3GRekq/0wnXfcP6Zqt/zmMzXhQ1nfkUu9UeYR4TNWcQEIp4lB1lD20ej5mTWvbSUVvzJOYqqMiqfc8nuXfyatf0OdbOP9wxjXwXXphXam1jVwdRm+IbmmKImWqMOWkyvTuQ0gPvlz4VSUT8/tsgMHg83CpaTWPXiXEPakC32z/gU9uVLma0ldT71JgXnEGGnrd78KQusmqQbJZtw/BDtz7avc9wMf+IdEGigi+F/UCa2P6wiy1JyY9i8gN59PLlW8FzMHkWvt8LoHvjAglGPJMB+JHnTd6lEQEnLHbQFgAfNvaBHWT32WWdkc5LF/+pkqSXGHlT8v8pPXh1quYS1Xt7frQqnffep9Jtr3o0TIfjLKmx2QMtu/QS6xFQYyO4RH/rVpv0ScGc7OL49mkGaVt5oQK0RLkWjYmU53TZgvJe83qnO4BtegHOG2TDyj/DujEly7ERu0Y4X7O9hlxT3cyaap+jO3PnIuTRURvNk0akkDS+1ukHsZt5x9FH02/GzeCkrUEUCsxTsZ4TBDV4PZEesvzskU0q27jv8BHbYNutiranLDOV83TynjFekYcbeEuttKY8SaOeKx3p/DirX0P7LUxR1VYeM4pIYv/PFiu98OwGiQnRRrp73wAiGWqzwCllfWLiwu3RZ9bhhYZhsE7td/bbXImLMJg8iNF+X+A5QK9XOab/SqXGdv+D3hYkTvFdRmS3+FYTbuIwpBb1SZsazR/bvIF/oWWf9yuuqROW0Hn/Zkz76Uygv8DcxzBA9fH6JALhAy5qlHPHLjluMItMBcCHCcc9GVhFMjCHJwQtpOglW/UYzrA/fPelmsTem+/Xkuzt/C3hSzDykXb2Ny1Mk/pF53okt4N3mY47HXbT9KLJDpxIOQhMm1AW19NnF8Msg/Be8t9E5E/urqYuk/aOhpuWOZTYUGiNFPht02t0yz8BOpNYxn20AcbN6r5+2tmRa8MGThscIMxFFAdemmEskTpuYc91qOMptp2whnwDDxMi1pKeykQFlRGk4GoPaWsZxCdeSkgnmoUgNQfUWPAnUbD4qvlER4O+npb3+MLBxjU5gneLHmyY/ZFOE7eXlBL/YsWsX/4dz/xZAYNAwLKhUGKM1s+2K9y7kN86fhIGvuqDA5gHziQzT+1NTn3bkMxvodAiBRZ6GSyQoxjLHkVoNxRvMf//m+c9vwPiQ9QP+nZ2bHi0JTfwrTVQfXhwqf6giEWbE2PBOquMH66cu6wX6PfeR2nHGViqnQwXCi8WL408QVsvofcaVexwKg+Q0DeC3xPFzsCdWfyAEti9PLF/fFQ0/xSpB/2yowb8ECB9Z5/TKFJrTRYjJkK9yX44MNwSRC1gE7GigK7f7j9jRNjRzzhZonpHCm5XkRVmkrxe4+kC8zOOAS2/hkZKJVFOlDrc39Fadae9B4POe0djRU6ykbnmEfZ6SRjRDBjH2E6bQAUKZNFO4+dkUsWzsZqvUIvvqfjzQU5HbG003ckBruYVEWjvkBGiizqI1oVre8dDeXhcFS/c9Dv7FuUo1K5CYr2DWw9sNhJnM/V4z8gbQEIhQABQpNCF8CSBRuvyf7tnv9IXlsQoDcoHcinf61sirFOb5r8hmuqkFzzEaolAkQhjNhoXGavS6Olhzp0C4eqxEr8qibyxD5p0pxMCfOGz6ulysZJHesoTIV1jW/PC6kWGwPDIXdcjj9ohLQMvmtlSiI7N2lyPeb5NGuqjn505d/qt5LcszgM5llcqMoLHcByDDbCAewy8TcerUoZpX3JOTvq3/unV4gmsDM9zalobzQqT+k+XTWGnrnfYgRzwAXeJymhqe5LTSalcoJtd3xuIomEq0OEWTDtAkSPNLMcTK4tBHB2mmy3O7nN4SuHz2br2AcCHI16mMA0DnhnCuxyaUSPaKg3rLpKEaxiYJRW21zhovPz3DT3Z3hqpEFCiz3DI+d0vzKu70kOAkXJLLtaIuDK9+nd30PFkl4KefbCedkfOP959zQmkWom9yw37RqHZnsZEvWrqz4TmnEq9+oIFZ8mMBo0vjG8tTygs1BsCLJTzdLiH3eLOfz5OdOoVRdpLKoDY+3VqeXQgeg5ZnS4zdGfdnOOu/duMlMeX2rLG4aR7970Pmk5QTgMcf4BnJ5kMXXJxFz847gjx4JjYH4LD65wzOj0OD9VVvGH8ZflKQERRW3mg+bUC8+7dyvj2QHqm4EYUAFe6Wq1/oRV1+lCkZFXOb6Y8UKfbNuqU3+MJJk5UDQa69rk8z4la5RKf1UPWTRGf0lSH1TPSzkhxmhNrXhpjvOMtrVAQC8Yz1Y48rqXHOWDelN/OoreSNc+fn7eV8Kw2uGrWZ12ScDTKYB69wUir+rTmvWDoq8YIGFfETSXeqogB3Tpm1RQhqK8j5Lxugq8QENE5sCFENjLcLPI0VHQhaNxt8lQ3c4i9iP0UxyWbxvNb/5qAD3+pfLcHeep/YknDSYFcyiSWWOrR/RpFPVWZH161p9gEwcrAxSKdXXxneq3MkXbnhT+XcXWC+5mWMDpoQyxIw2zA0Uh0/OqbiK8VPtFuzfiCBzzbi0lK3/beniOBF4SNV5OWVoRJcs1plkh1yUNgFGVQZwxsuFLoilQz7mxxDViMt95pqARY275YtXu5YPMs29tDIObCtAjJZQzGmZlsKeP529G2hqPOnLbtIapBQXkWpstostDwX59b/ho4Uzojk+fzIx4ChSOWQ5Eg3R9+85yrXwmkYQJ9HJ6tnVtf+3/YL4x7j/h0+cjwQ1WVSVekqeMgdAIwi76N+Ddy5x/29GaXEPo/tI4SCxb19n5ju+M5y734/3wrQTWsNfkVHLRb18bHrrSxAXJtagZTFYuYe8/C60AHW3X9YQ6UPL1ZoSfUxNbwK+0WVWfBJ+9aVID0c5vI/Mqw2YSJCru0xuktedF6jh7aJ+YCECa/8EjrVeiDDctT0SFaeHM7QZALlsInCq+Uu91uK9GWd5pRU2L7qHb0oeDGnmyNng2XkDqkkDdIuiulZH3JTnufFDzoKa2dMR/wrMvEWLEerV7Fs/sDiC+CBEZfxTCEeoM9g/CbObyXb/Vm0EQDNa0D34rU34Pt96+LwURNtvMdxsGwsr85WwkDQSGoX2PtMjA6mvgw59DpO3mSEMdno+GQrUsSXW8nb6jGTJZ267I8ndIKIfeMo/SVZXL0q1EvnRqGjU1KttmUo3BXDzXwUtEwA78HV6hCvztkVHmtUjsGWf25OCvXwXrQ/fAA2baw/rStxdgtIG+D8LwR+gyiI3OrbaYinikPrJRbfte672/q/uhslTI/S0m1fmBfJajf7+5oTVV6+LBF9uJVKrqKiFA2ktQ4N9HazyMlZvRur4GMUplIi40+RKuhKK2FG1kCruhuc3x+8IGqpR9y8aP0MCbbfAyYYrTlHi91uo35ivBaDs7n2RtD3hMs1/3D1fCWO8PZnI3sMZpjiYJppXe68KKGZGXiP/i+HH+DZ1qzC+aaPmCboZ95kBWruzXPElrRsNoCjKEH98LpTS8cUZubOWpXaqdbb+IjoFwyJgf/qHlYC872vrefEL8scRfOgAtXQU02ml2y+yLy/AerjXWsvlv7o6lFTBk002wkcNMwxiP6snrQOM95LBW/1iO9CRJb73m4VD1mG9MZs2MT82iTAfu70Wtii7KfieTGGxuJbfHwbW3p2Dq4dBsqW9eUcWOex3IhBjlDwb+WHklA3pZ3RHx4IzsVKSdQo6I/e3tmI72bP8N00+oCNHMfA1gi25mHGhJsEgPpLPzInI/cdb9BywlCszxcSXIDkNmethcinU+rNVRH5BaXrfavqhj1iGYNDtfStDd/2fxFlTAHizedEANeDyaIJsm5id+bQvYYP0jc2gRTmzRKwra2Ensgt0+zJTiaPC+yEdtr0yyy+XeC7j0r5no+d+ezQ0tsjF4GdyRW08hx7O353uw7IzdHtcX5RFdNdQ3PSwtmkPO+t+4KMvh9ME7ir9zp3eND3YIrfeh+97kU5PNK26MkLIE0kCyoYp+mdxhou/He4GAX0ikwPn/VAYKCFxtyQbxLDdIJSRL5oQ4wbd5RfUmodhk+/E2diwIYI/5pHooA6T7Z41NO6PjmK9BQRohHqjwK0hpwqy3oK78Uur7kidTnFRzWjW0jaZRgZ4eZfPxVxgY2zhUwyP4huxj4fODFNnw+U+hMlqGO1m9zK7S0/iC75PHEGQb/WW0/aleGbZC7JfkYdDGzzpi17QzxZz8Vr8/bS2McYIILD6kcfqTUwhg42ZOhqPOTJE51Zu0waJ2z77fGh478rmSaDwiHqq0PYU7cSiUVRo1OxN2VxoAWi6i0zwPqjF+6L3N8c0tN+44stJftUULawrqpqyWy+LNlOGExM9ymlrakUsPhRrX+Y6vTeOFUT+9dy+C7oBGTgbsS4zyLS7818NMIkdZvNOjeJslqsNqc9obwae9tOT12//fCwgFvlWP3iDEbi78Wj20PKTNl9pSbZWu5lQMK3ZT2nE0LI+VJuuVf6Edvc3u3fCOFAdtggEdUskahozrtUzXGEU3zJk2MD7VbEGgYz1CoS84ZJtAxjXyiK3utZ+s5KFZbfGn56FDt+K5L+cUKnYGZZhA66c2NBNDSW4PbmU3pjgQoNKsKqFgIDAylhLk6F0mfCDFhNyUEYQhrNOLqwkk3bqf6rdJpzK8SrutSR6aIxf0ayz7s/LgAlpvBsf77uim5wg8TZJ8243mNcvdHbgZhGTQDneiOr4GzplbwS50I4OuItSW4j5ttPx/w2fdFPA2MnzGiLiqK638AemwG511E0Mhifvw1rhLG+LeFB76sVfjPsITpPU4QDYzZ+Yqn34uP6QqCMGnOKdNoH+AqFlUJLECMAru0ud4YDS3G7gkNJ9OtBopJy6+HY7BuoN9MzMzkcqmGybMUk+jz8+djrq6+znRsXhQ7VfP1m0f5AECsgW+vQaXMmQGZEGNPxfenb92ovm7VTnH1Zb1MBHzJ5+4bR/OOKqnlCTMauvueqWalLTGw3VhU2WPlYW3wTGyGMRSZj4SvImkWuMOQNlHdqCgb1t8P3xtJExswjyNJQ4GDJ95zGeeWYSLmEC6vFLp0cHJq8aqa0kLmcczQJYNb5uHle2P5Y1Pa65e56hdMMN5ErbhwlLy3HFV0EeOs+KsDerV2mJ+M9AaajBziglOo1fi5h2LJhN8l1Qe0JSWNZMH8g9rbesuPYSUICkVGWq1rnil2CPFOgxGcXlh5ei1mh/xskJXDnsbmGmBXfpOvKBPhoVnp4DE3E8MK6G6pavZCsTWNNe4xI2oKBCGh11il9q7bZ+gPyKVX8boVisucmdo4dVV3EsdP54QxRVtUUNEqh3f2b5pcBI2p7o98bXssU7cDVUywgUawzjys53lnuo6hqvj9GSJQ9BY+fUsYl+3WpjP2+/oBX+p2kkqjeJ1iO5PmRnAP5v4Qwf7kWmFvMNAvhnvTKEeHeGpivsWqF6wzGsdF/A9l6nh057uM1yh8Rd3B86n4cP8F1dXZlQCgadnz5QvgnCjZvQafhHTeFMuDIMZaTI5SiX934GseC2iuXhzNOgmK1DBIeER8RyJfSn+L1Q84epsYVxmVIO9ct1OMezKzS96JyLmO0LOI2U9cGucp7iBIKOf7RBwDwGknneUe4g5hiz29zVSzt7PzzeT73Arr5z10gmCluU/uk4vQcvVf8Tp4mwTcy5t/E3ksK6Dcl0OVLQbK+kC9eK5U98/IBQtOu7hqTdr5ckgWZe5/TNxejsI7Qq/RwSCWSkx5pYVBW1ysynHJ7JEIeZJRc2qOYNy9+446ohwV8pdpGGd2XKm0Z9jQbBZBp03IrQdPboGLLkcI2UIwh3xmU/SAMpjtxwuOVmki0BgjOYBVBn6SAx1aCnP8ceq0oiuHap47exM+THpyxby+GHnN4Yhjyx2cf+/Q+JTnZtldtRlqHMyDY0fa2EvD/nM/u7hHvT1QNZWOFKMrsibaOGVxtQckjLvqWebSvWyGDp3vEYMN2MnJRoC22WNyoj8yEyMVcWzH1zJI71tYpPOC1XqTdtaPLYO1Gw+kmxMdJP0mBGNFDxZtCDxqPtMP+3zTIjzpI2VarNVwZwWdcDmw7f0N09ReTJ1kdmjf74Xu1WAINFVt9Uph3iS48wTBzk5cH4IuIfv13yb4w93sMy+AZLWd+9+A3sX9yzl0o4ol+kC0dUjI7gj3wztBt6kAtR5BJ/xOmOF6HPdiV5y/AkXOa7/WGUICQ9cx0qU8jktJmF2inZJ+J0Y65HhOrRTQnj12zfuyX84BdFeKBuOjLy26ftTg5jiFTEuntq2CBqMLLrx/7f5UIVknRMuugmedrKEfmoqkTpByL4WarbF62ujcpYHRH9b+qDYHiiJtG69h6tjZggupeQ/IS9Cge2hU9/mSo7hYb0m2Xew2P6QT/mvAiJFKajZhEaddcjpfcP6ezAajCkL07zIBYfkwxrbJtE4ujYIxmT6DOWT5eXMktqxIWATRxti8Rl+M7ieLX6wPJcu2piRiTSvujQOVxWrxcJc2SemxahfYkV6nAUwhTUyaXun0q9v8kwI4jjKQyOwqvW+RR/VNVt2hNAZGYIM88u57vNY3qSf0x232jAjSAhHfQSXyjBl2Lq2biNrWdqcpSKERaS6eZaZDOyWztYFEW5fTqYH9qkCdqrmC7bwt1+JIk/fh5K03nSl7HoIOTgnn51Jg2HBjMj5H6OHqq85KQxOifIACPpix7XhirTkkSzXWoUDnLVKOAIkTOz9k3wHXLdrn73CFV39zHv3SxJN9uFRyt77ND/jAY00f3ZOrLOZQaR+Ng8JAKmbCCJWNdEkgIdRX3iheVC23lpc9Bc3foku3FDnjE/zWge+N3GWpwzY58PxTNOno+Ndox2JuSarqDTPuprm/HWWOQTy0QaqnoHlI21OxmF6him2r5ADrunov5fVqh1zKqsdxc2LXJyw2zu1v/Nlw2TCrZfcFGnof5WYtUnGMHVdHYlmJq8fJTvaWZHNJ74kcDyOgfgD9jXI6LkcJsEK7jUHhvCmoMbpoZHQzQGPiSaESu/fAqlAYACpnRt4D+uy8N8/LAOjbcRIXvhIZkoIkh+ZX8LtNiH1M+zRmJty+MPeNGwwUSVmYuOZG3BkFHum6Pg/IHwpOkvoYNJz+De3jw5mXp8Gd5f44ztrFFLmUIjQClVKO7WTZa+FEUTvbz15aeEO7jJpWNaDy1gIUxGzYxs0BcFBMrdrzE9UK4EJM2C32fcM7bGUgKRkHZcSfQuHj6EI0CnuxzbSdQy3WUNBl29t35wpZJsJYbwFzb4ImJxEbLwPpCpa8VwdKKimvQJ2B8qFGlKsgRtc2S4WYAZa8WomUnktazjf29HtDHPECXp5JtNpnQsg8I10E+Uho0Wkqq+xraGED7rA6X0gZRPPCm60aKXn4DQQi1O8/otsymJoDhj9BotVqPHK40SLcl9yzyz1Wckfb9S70B0131wN9pDdf/K0B5tIgPh0FAAjWrjVi4FMUZvdCGnh5POuVcikmvZuM38HJ/CGNFfdvjlGvCm3JWXGQT416Gtj1HdkOuXVFjdMzpZA3ZrmWiUo3PyvqwspBkP16DQxUXKDO1rGOP0Rjmpohk+g6yFqrjbhJETozfWJ3hjSBeBZo7f6yWljc5aTpP/Uydy6VR9mUswA9PSEUKwmWUj07QEzwJ1QHBzOCDtRrjANRUdL9qMYZIdCmZZ/REsgYgwne2aPG31HwCWzj0+WtbrWplcwJ0RGyQZvlACcDfAnocr3Izs+FbT9YuGGrVnw/zDaTe2JJ9Mj4pcvMQt2VUhXvrZpWI3xFSDmj/iqox9HlamNGU7CQKk2gM9waKBEQFuxjsSh+UHHs9ueJ8SX2wuvcvSvPM0zcX0G4OkvfigO3tdKvnfltzPVMJtc+X+HXUQ1T1yqLRILigU9x8aYVun10L/o4vw2h/EE6DfYWWEEV3a08M7kWrEWGs5eAnj4IUSjE2u/xfpRJvEB9N1YwUWd4LOYYdeSvuXZhlpu+7yhTS9A1N0NcPZamyl6L8C9E7tdkKWg7MtkRZv6LZtzgbXrjIdt3Ysz0B2yCmR8VIzFpJaFCkSXIqK0e80TyG2Lh/QR2gPkydJDqmX4peKJpqXwC9kRSw2f8LGNhIixUIBErme8VMz5nzSamyKDo0FLfOUrWQx0JX/Ba+ipr38HZGOIL8/7ziMNBpyM5Pui8sxyL7dHXcvVyl6CZNuMGcs6w6gBvezjFCd3j2+GHPLJe7QxP+cNlzFe5g95p1Dlega2nX8xuAhH9jR95A7sar0sMJvj5wuQ9eqqY0n0iL207Iw9jFfct94+L8JSzpwRjZzL2AELfjTk3n+JwxAtzhtvEGe9d5dGt/n5k7L4ax6WL39SzhBVlV2MufRvPnGMAEvhlOx2k+mGE8ur0grBoR+syoNX3WmRmdArRQJ80ms9zGq3FDOglYsLkvM6ikTTxukOovgOMUu4Cj8J50aZEPXnUlRR9Ku9ByOhGKisukxpUU4IebRQO00UVvstJQbizOrGkqCcPpHwpoodMp6FY/skC8Xz1idwv1xcLfRAZN42yY8ZB9hRsrrFfNaGYb8ZFP3kyXcK5+NyRjRlcWoMlbKH9tdUqdzT0rlJe3qE6JKs12MDoJ4GICwdegMAqBWUxNSUt7t3IX2T3SGGUIkQDcOawVAFxvyZ7UEGIZ+9ySXK//UzdE3zq8X1rUs5oVpPoDwzNP8VDGFpGFspCUjIpgYnqLdDpSnrXbM6Dve+3LFHaXmD5xpiFKKREVz7nt2XM3Ri/eoEPHJFYTGNYd+Z4x0uvYHl3VfmWeexOYxwqZ1B+rkE5aalWaMFg1lhvT4DdyTMwShzoOUFd3eW632lGfuTGyWGXCoNnM7ra2HAGpbJyFZHpe53yWcSykXmpCLg9saJUYMyETN92bSsit1M8Y5r8U9UdnNyd1iwyqe9ep05e7VDDfp05TNnbzPkiFcIMYMn3WkL7wrYATPrf+lTQ0VOIHbok5F09j/KB26eSM72oPWYZc9vTVav+IN5k5sty4LwbYGB88RViWjjTmXgTkn+64X+K7+ZeI1+Q01zmE2MYM2RYyJuTzcVuyokC3C8Pq6utUL4seQvo2gfwrRAV9a3j2RIpTrFxPgTglfRiIYWbYODJwgEaoqzjXuurt7PmILAO3zzpDXLpI4K+Gmn/f8yam4SXbflbLv38ApZFdcTlQW6v+QLjjZ0QdaYcKThfyykCO0oC32pRfaXhNQpeLgvvgvYN/LUrEQ+kMK3SL6ExUsoSh08EpfNppD3FNqUt6HF40lGk3vGxyapk0n4tg+cZXYVZqgzJogiUmE+n+WgqAiwUeHIqv/xKewlcNgwvGcanbIF5g809y6kgr7JJdkIMwHrcOlkh4eey8ieLo/cYflsJawc66fQUfq0Zh0yREhKhM8Eloi6WBL9dC5w7u6q4mn2I8nMsmr+PVG5A8nljFjWZDNjEGtUCl2Q8uzTKAwh94zoDn2TGDuB5V8Pi4nlbuS33NnMv4TZleAiYuZV1cCzjpdl5QSRDhks4PLLfuKIMkZoQXVR2iR4Z/HS3pXcKDEKGPJIOfKv2LYJ/ofDdrC5pzmdZAQ7tIh4iCsjj+h7STYngMqocaMEPlk0Sptcs9QyvJdTpYf0MX25/Cw/LBh95F3yupdlfzetOospAw9HCf/L+WyuG5XtN/QcJBmcXqhsbduHHOKp9Gz5cgoiXo2NpyY+pGPUtv105EjTPdIBM+1Dk3HjlDCxCOV5td7dAEr/9cigTZxJTBEngLnApejajfiUqXdyFSal7Ec4nNAQa10U9CN17Rrnu8INIJpGxFKF+oogfmzMNyxXSh7s1kBy+wz80hcc/zIMq0Q7cDV1dx1VHS2WzmXccUYEVpcP2qcMugMA5WEPqEdtH9WYZWLngIfjbGXUPbmCM8kWl6QZMGeDSxbjyTveh31tKwXs5hLBP/eZIkOGpFt7MNxhDX9oQ5LrUGV+AE+QqhF3SkoudZlrAQIkUvHSRSn+nw5x4lkAvh+KWlB1JdZ2wMO5LkS7gOTAHvFr8DUz3G4mM4q/+6/4kc4v0iUC8KQwm57qYz5pPefy3s4aC0pPkdmYkJdPTzk+dns32q16RROJ9SYyYo4IbH9kc7WGz1nXUUsQUQXre/gSu3NZ6KrvJ/ZjhLzZBc6ltH7aE58SvwKOeLAO1HgC5+VQLOgn4110yZd/qTrvmO39XmrIwFyROGi7QBPaMJlf4Ce6Xynuo5c1X9a3ySESPVrhQzHtjNo6QQs4NiDR66FrA91+1ufqK+HYhRG0qC3EHXYF4D7JeTTzcS5v7S27Ea5TAkxAql9WcHsuEtie2EDP7Nd5csdam3/mP+D+6XBCP4+QPkORsYrW0iuHihq9Lph8XoBbODyG6iLiJDbj69R5QeAB4d9aZJ4+fYFU4WKOiRckmt8H+QgPSEdsJchUaDd698fW/y/ugS64OKa7WbjL9kPtHNALVaEkNvZ1gKJxw6LCNEc5a3DL8RXYlD368Ko36Eni1dr+DO340bK83uZkDFrYIfu5kGv0hAx9PC0yOcAIeVxhFh154tX2XY6YhGCTKevD27+nPLdqnAaqBmRSI+AlCLewtwd0V/QZYbFi+pWGFb0fG2ZpXiiFUJpAGZ5I3YKKb6PlHBohxpe3V/lpObnia1/Jvo3d4UtxIWQs1JxzN65NEXC+ghGuZW3lGnui6bhlinnTgkNYacal3ZlJxnjEnj7YsrYQdErARsf5JGKXU6IYJwimNkJSKuy5GlQ5IWX5JvLdZPjuOMVtEEvYCDnUtdyQzByGIY5lVnQN2DcB1KKdhxgJKHt+YR4SlskWPkSFOoYA2fWiRnfbkfm2of7ioXfU+8SHSYgkMFtv6FqbjpJeUSXYdoWvyW/3T5f4W5lCQZeeu9AmM4mtIbiDshSXaZ15WG4zknZrspqgYXE59SuyCWWNuQDCKOBi3o4KfFmoEUWCSdttnpb0NZCJ8/Y12uqags8Fcmh7gpWGnwA2ynr5rHt8x112Z8Ftr0TiRIu1HeFQ2gq06UEl4N1bXneD6rmHzz2x9KoYvRyTMGx1upByvnPMva8ijieQWF2ElItn2f1SVb2qPf+lZ/HZ57HYaDP0TtivGjbPxQr2AKaCfdz+eQisvCrA50LabCCS73dpOgKX/QspxnJ0y4446Szc0XeOk06/cSwMRY81YEyquwImzkBfKAa2VVnAh8YYTZW2Fsh3PBS9N43mQ5M35iNWxNnQv+DgabzfCB7feDZCcDu948yDCzmza8U/AcFyAWVFvv1KDK/PJj0i9KqfflIYilPuI/C02rXdIrqfba2/iEzsJiJeGnKZEf5HZI7xH574Tmx4oIPz+m1Yuy52Yq2Ky7Gy5Kg3Le/vUUadJHlA8la1a3Eur6fqYtr7z7wMK1zhDrQjb1LjqSCa8EQdOwFJhki8la/T8uoM6ipT7wIuTKxuD723raoghw5BuU190Vvbe/9bcjXZm8NAPXxAkGgbuzpMXwgh2phwFI+mSeQ7z/gVZdXpmZTKYT772elMt1RDtvkBW+Zk7/oLP9CKX70YKGttApNukZGYfgGhH7iklypjpQyKFLoUDuf+FvF9xUVL0z/4vfoLUsG6slDJU34uMj2Aa+TWf6t2ZsH4VICzSgeHRlspGI0AmxEPX0Wyp3n7XL2PtsUePprTGmV2k7jOzBtig7C+ydSLZ43RnvQN+KiQ+5hul1jDondPqlItCQ7uq6wI7xxBhx5Z5zppMYlA3HGUM49trfOv+yZ97CHazbkjPZqAZaEwq937/M2mRCWdisntzJhYTQA2HcO/gAioSs+4aPYUaM436HO4jFftex46ppEp8jqkBgfqOlcTkU61PcCglliI4Z9hQvsqdG1mkVLeER1HCYCAooGzvF8Ez8enfPfKXstbZ+SKOPrQxf+QM3RctxPpoJUiZX6cIUqrk9inc7aHsftthCJMwgeCwEOFXB4gV1g76zm175fM93M3ecpMLFy5xsr4w4lY87tnViX+kJEEg0PidCkGv2+X/NiWEPlnDg/3wcW8kZepLauj9pQGK+FjVkXUyXwODWx2vbBmB1TWmKMlzTGx+6VEyOmVcrdaLISv98fuUlCsbxxwI5jv52AAml6ug0jMlGk0Vhj/XrhMadQuzKFihRoxfbkIwjSjfSOEcSphKdqXHiuFFbDEBWiMqrb0wqyqFmY39nrhwKVxWlopFUQEgAtLtljv8oIDDj5bk2SWEgQOdFL7KC/3XOFJ2IVhySATXGUrK/JKPZDBBaKGC/OqZaaThW8vkZ2An1JhzIKod10XUKNeUrVSq5oUjnKcHXM4bK6U8O3NQ+il3kcf6S3xdFPeXAUViYVAuTNA0j/EC0WTnAojE47t+orzYfgTGWoho17oJPEkooptXYCXS71sQ87xknTQ36Z/4uf592vA65F3M+5+LMqyqu48eBRKkG3dfqpNFoxt4v1cNHAqGsBrpj7IV+DgmDZV6jIKGVo4KRLVaHd5Qsn+f5hinbr055mfwfLom9URhawkv0yNaIF5z/76xh5yLg2bSPqKTSYWK1Z3M+o0hyCbGQl3g6zECswP7SVc+GRvj6hyRW3L5vpJsVMt0SNS7+38manC6x9x9nF4IpPNlmMQehumffk2jXDaoJZd/CWEdXixH9HTTyoN7l3M2r90TgNkc95YMcru1+nVc4uEb147M2fAMCUhUdpY78Fzsr02LWl2vAs9l6O23+AewOhyWz3TOYKMHDXbGPUN1HuMjkmuvm09DzV5WhAc7BrnuQzAnobkDdHknNHUc90FxAqMt9S5/sktlXcTx2PQYET9d43RKxqS6qCznF9yufJWXWQOKgJ6NMcHgH3zxvfJ5rRiNTSKnCOfzbCkHJDBTQT3E6e0A8KQVw/tca7p7MYr6rsgny67Lc4H2ZQ0GJWbJFnh7Ovv6+WQjXjdArq8xOxhK1TLibjazZwAURLvFEH6ed2PBlIuYvvTh3f6oAwV/DdmbbhpJi9BYRix2slvDNt0H1dWuGIxslZFD9L2e9aSSLs8a/qPLWhkD/FwWAn0US+5u9wt/CWKKXjktktaSeHb0vMH3rjz10PcvbKTOz4N4E02MWNPmwIIDCme/S27I8V/3L4iZzAKxPsSfI/IlY/aIaQi2TT7CdXnvCARI7c/iOJLtrTH7EYdOO/aopR9uOwaXqUCxIx4IGIe8TXBI2gpozYwhRZKBXH6P+cOzpbW09LxqTodXiGePNdqJOJ34Axn4GQ3WivlzkUFRdRZxJLHAD/8hVhlsCNHmP6j+q3dhx3/1TzMUGo6+AnMu/BBYAp5iWfJ56f8iXoE1cweyg1DnpuA3wHXnNdpK804apgno+7MzvY5uF+Kv1FRytUcx7sz7IJ3qO/qQCuQjIzBYPJSl5grC82s2NIAkmixzd1iFFJ0KK31nU/k/bosVRw/mgrdfsVf9yg9s2kywB6ZCFcu1O6LwQoNY+Lkxktbg+Tvq+oGAF13QHWr1q117SgahK8oluDGmhkbtbmo/AA6Q6+L1Pz3UhoCfs0EjpR5U9Qy7pKeGPvrpoeQyXtauVOq8C7ecpBSAL9rrVhLbpn+9ntb6VigxS/INaif3ZHK+vRW403t+MCIXmrJ22LZbEuSv3NDC1+glu0mnlS1IGPKrPiVw9oEX7kdzjAstiTrXmcioZEuGYkoFsxhJCD1s2CuLar75rSeJTZqUTvjLkupCRzI0z1dZMHUeK5Y5VFlAWVes8RWlLcG9bIlLXOnpHqAdud5aZ4Jv2zIDE3DTMV0gOh2BNuwRImGQzfCHXK1qd40TDYliJYH1PLscJrHaqv82GwgrOXshAvAuoin/3xzJpsGkMYvrHDNtDEHAD6kAElO7lN3KNnwoIqboi1NxJh+ZitjIVPgZV6amyCdaN439d4+0QQ5DQoVD/5608Ldaqk2PsCoq0VSR3ugTdfGDSO1sEVssWl3FrWq/BhghkREIKfipsepqq3jfNjokpR2lmT0xTdcLFyGUeHOYceExQS0la8DL9N18+/MzKhpyqpcQyRXkXfH8TtxKuNz6abOJvvlaKM8k+BNuHTuqiSUFQciN7PAq3+fRmCDJasRx/oHEpLHPk7ywvKdRexg7CoIbNVYk4hRRRVbT2S1KullSeBA6xmXnynsKc+/oyMxtfg//ArlHNXCMkFep9CfBxjhmNmtoh+xfoLPYOzza4zAGGi6Bd3MAV1MZqszj0HI8tNZJ7+bA9b9prpO+i74h9rnkWfmI7q7avNnzSWcoZJ7BC1NuF4u3rl4jtgr1lQGxD7NHf2/3ZQC/r9E7mNsoniIH5FVSoHBETnRKNA6HL5fZukt7HVZ+1eJlvhHUlPr8tWK58cfL8t1GFhVSlSQT/8sAKDSbzGsSGGwGsIR97WFWA6cCNA017+/o1ojDynC3amBgPy4lmMjX+F0OcImNcYXW94kD6+GVR3K0A6O758C55WcF6aD58t8UEqw0pXA1eRKP3oNpIJ4ojkDpiXB+m/3wvdAA0OGO3KfQu45VBcrFZ1XYpUoxY87YV7dT35XmpiKwG08zjzogzaIbG81gokhAGMuktL1EDGWg4lgtv85bPXeNjIT4N2YoqV80dgSundTk5oDsbJno2MKNe6LQAOVb9k+nXyIDiLzNLpCKAD15ChfhmnMgm47l+38oS0+/mY+hDWjGQcS8TjKe3yZU5d3bftshbOuTFyNA4wFCaZ5dxcc0Arn+vke1lCIf2JFco1l/Cd1c8LCImsYnulAz13hlii9iMvaznz5Ps0cJPSk7mKhyljOThfEGayZCOTrGrDLMK+X62HVAgUPShqRh8rM75FoW9KIxcOhtrlONJxGVt/WhgGQWkdTSM65zSuL61hw0ErKqV2LCjiVvAecy/CJN2ZgJ0EorhRMo2zxkKewlqE5cvK8TzPeg22lKHB3Lpb4VReRnZjhxgwe7j2ppeUHLoSbn2QzcNapMFnYTQSgu0fuYaILW8zX8QYg0q9aerdNMPkETq44iAr062kGMnHxwVaFkRdHwGced3AtjDm03w4Cqk3BBuFA1HADxTj7/iLMd/Vb+GoZ0dtnexZiTnAjyH3CqmvqD/2QuDjlIv3+SxmFOG1yDdUCpt6e6ffoQUaJxtkaXCJFIle6p9yWZKwz7knpjrIbCmIv6O+RT6Z+buuhuaOeV2ldWSx48WBfs3zefT8e8b3sYiQjODCUUiC4y/xyhgRk7SDJj9p8zHxtwyGea/YimsqCVzml96yhzRy1vW1h+94v1xhphmZp2SjiIPq4/wcloKjBmujp4Qz6XRvOwFTJZUvr1pLQc8bktKBupDUI2SzVuA6+PoIxuihwSgZQcopDvTqgvGj3qtfXRv1lmUFDaVmQQ6EKeFc9L3BQnxm7MFJq3Lbb4MlEnJp1wZdqbM7WVM4SOWLkipI3KM1hAzFNKaoNanyVkU4cpUKGoJESicZJ+Ps+7VEURPSEdyiyl1U8+OsVR+sDb0+iCyh+Kw8jKouAFhExEquPUnQbx6c5TLUzD194defJ1mafl1xvAQaVALAlCM2VzxrW0lp8EUXXfcqC4I23FmG67kkH6nh5z06Wrv+kBEW6tKqZBUQnMflHZCJpTAop9Z2wwRfCWv99yJ8e3sUFUxlsmgIRgXOuIuXDR/IrvQxF/Dpe3xz3cCGbbGjvVxX0/w8lEcjANPxXpbM6pROQGs8blkkmS+GENDBe4Kn7+35ToLoaYWuHYVl82GsyVjTiEoUXGt8ne1POpvpCj8b1fi4U21urbWZHNdLju1IjixIZpneMf496kka/H+nkMcbDITosKp2S1aChyb6gZn5WfIWHn0mGZCdmNfhTyBTuhE/ci2407/uPNDswGrhzJ3EAXJrrIBvHk/3prgIaQhrGsD7eesEVoWzPcIp3CRRPm5sKcz0dQN99vbAAOgMAwrSlIC66N4XpO0FDcgbZp2eWycn6wI2cCOdzzB8oWrxqB30yA3SevLw/np0x9BzqmtYydHYiCuqN+NLC6sFpwi5WkMTPbJ68fCj6wEOibogoDey4i5P1JNd50VH6MhVv3FoRssREbBBLYbOm05a7iSH4RRoxbx/b2n1VoGLh9zBYEXPrspU6POeXfsKey99gImQ/jVadRhsKVW4gU5mI5kctwvNiUHj2Wm8ZwaS4PKryCVHJQp0UxwK3rFOeHcGTOyh1e3YMKE/+JP8KoipnqxrWSDj8N3iIMcS1MZ2adrKCIMEp/kKa5WtbaRFrOw5Sg2+BMRqFb9f0qA6xFOk8pGfxixmlt9pHPELL812JTf5o3mPUd2C08CSXrL9TugZCcctmuPdjotXMhnpMIYcsq4PLjxJZTr1keR/TrplOzIYPg/gKDtmKbWnTMLKN3Ynx6nWQOZDF8lAL2q5NXQ1L6WYPUlkUeHvY9xNGHzu8prmWB5Dp1HdiMWOvNtSy8vRXx/4Dc3e/DACy1C+ALvbyecRrin/MuXTYpUQNoLCy+UDDzrhsT+fo2/AoEk/HRICqvQSxodJEnFoWlvpxi3F/KWuts1+fXBFs1a8mCkpsNKrDwAB8eu1kviHTce6TXh8GVGDcGaNKl8m1ecN8/fXR5oO/LyrP+zGbbiHylnxLUDCN0PIpMpWbPeDP9VuKzJeLGlcrFI1ZetNqPeLAIUqXLRlCQRvsfdtGDJ6yEwBulJiDhDrwqzI/iGQb07vdd7w/5yw01ip+vIuUXfyTZokLdpFv4UVtJiZk+GzpfNfS1LAuTjgl8tdvG2anRqSI95M0w1aNh4mAYgTPfbD0gs63T1mq0Q2931ic9nVQnic5hIFCKOCg0cXi8s+b231CNvTo2IpYmYLVVsTmcRbnp2xthruesN0xgAykLqtXQVtR4mhUME2FMFdJv3wj1uFjDFr200a5wbaF4aqZOS/PJiv5oU4JF8Cq1HWgD+vedtFxYhvdvJy9kXrXqKT0ztoNluvYoAun8PAK8kERa5qFqqxP2gP7q0p5BFfovLxXnzDDqf7Vhq6rwN5SHrYXnNNM5CR3NYUow7EF3o9R3p8mvyzYr/zOHKFNRpbZETW5Q1d2oQF/I7qCRzcGOIRO0nZjrKaydvSFBrMWZCaE0bpZMUJxrouEjhsy3XFsucBjNEC/D52pEaFW4eJVBVjWko6Oz0LwdMJTzuBP62p668gzToEjxMTNhvuzpRbnZzhktVHPZJ0J6KuuBdUyOCoKbQr49NHWEfCKQqH72MVshywRgtLLTipb4gYE4PkQ2iPuzhkDPQMZzdX4L8pTASkJKCzSKRA6AWhZsslTK3aqaDWH9C7p1uLuwUaBKLG8D4cYgl55OaSLmVmCq/af6DNgQf3tDMY516ZhvNsJmEdxqwCFfSVeoYT1GnErK6D7HAONDjQBWmhiAOjf4lWZgTXY/z8jQpLG/k+EMd5tZgQ+p1pXamOm/9MoTGD2pTnCUKwUWvmE91xZgUfewMh1EThphwmb8BzRjUgR+5Q5LCC5PpI2El773VSQnUJPrE2LHCmD8fQRnatASKpWd4Cb037vo+BoOSfqYoPP1jSXN1LkOM9OVFizP7Inh0Br92IGD9DgqthRf1LL4giVhZMnkHa+5/cz+qOZPbhryosRuWvCDgstrne0g0/iSNrDoDTQeHLF/b9c38rAnHmDxmoS9hTojcWdj4obsELdyPbKtMuc6NdTOqXIAnTBzZ0X/ttYHgOBk3rh+ITd2fniRpQCftgVv5Fkfk/MhRviIz0t92/Cgmm1GwsLCaEp44WJouhLkPyyqhpe7yk447jDtqGD41nuNttjDNoZGdQtLwqIeTtCRj6brklDCq/PenUwfmCLzrV17ZEi97H5ws12p0VWerGhFJLKmYGxxoYKYf+2E1REzc4Pzc0NSeFiFVTkS53JvKQSdRWxzoZP4u/rVcxQB+bFL8hSjZeIPEZoEmRQFW83ljF8iPw7cvZfX0lNbY4cGhRdOt9gQ8lNKtSryeMSeqGfpdmAiIPG0Z8rGIjaA/RAeH00+L3DXzb9nFsem5/vaNpo8a6WyXKe2fJ0Kdu3JnD0Ykzb39QFdDlxKxsEzNjKrW+zH7Mf1AY/5gwF02qTqceb844doeQbs/GadVq07xlxmxAH1RwfPDUIAa/DLVl4elicH7BPfb/t0o58T/svXWWCozrVtNgneGL3TRknViRMl7R20R3aknNNwoUkkXs66Ox1JP7GupdjbSrhv2qxak1Gen8HQ1iZ1WRuN3iFmMATnK5C1DV118nKEra310crm/AKJciQKnyRE5O3hCOXxopSZiZUraMiu6XoVbyB0Anj7Z31At+C6kAPdXt5ldd66QQKBIFD5Gq63qCKMpCDmfNMd9WMVk3D8uM1zAf9Blb+cNh4MFu86nLOKwB1P2vX4bRN3/6IYdabX/lKHP6afhx95C1b6wxjuUWh36ptMJwerVyx2mdmd+oMQ1ySSRNAkCfnwQIirop+0mRG9ACZefwFZyJJxqHcap4K1o/YQjEvx4AstGWO/aTudQ98wmephNRy2qNPr3jM0INv0wFUsd3PBQCyuK2QhRtaeew9QLojR1DftKHUli5411nA6Rgjs5NLHmj75P9kyioMEf3yJVdM6Db5OfocracQFipqn54+prX5SXDly/r31J2I13Q5nGA4v/GwEDKqp5Jl7SoIa28jImdZRuLiZTMqU8Q6NTcf4Sumwc2Fpz0d085jdm1tJuGTbj/z+OOC9740d+tqMRag6gP52+j3gW5SJKIqBmApo2EFNtvmgL2LoZk/RE1OLgna3GKKAZ19p/aADFbOeNXqnuHm+c1mCKm7IpPM2wcUxj9huKH24dCuuqY10dBJxMQNiovnKE2psBIaLjIQRSyoyPSoI4deOoEKJrdcwgshc4jfFiF2Nqn7u9vHF2KZcb6VAI7rfGfDzS/cvmHMmwFAAfnoQ41/VPnWE2hMh5Qdm8Rbc0d9qwoozojGYItDBQ/Fdnj98cWUgBX/+wf4sXmrWbjFLZXkuqVBmzj9pzULQ3x3lIPmNedLA1UNQAyeTMTf+MtMYzN5DYcvTbUBi8bECsehYW27GujNM+sOywy3PsvYa45eY0wl4O4q764me6HhwrTydd1882SPaFOzqR89u68ugEIkgYgJXDuer2OC2fd+wjVVsnz7NBZfhyO5FFlVep4yuw+J2WnDzn5qvk4if6A+e/qg/o3BOaGBgCSvFVe/CFABIyE+v9j/RlZSJRC3K+e6gyWgL57ORjjJ/Z7dJlLvDiI2y+1LqDLTw4ircNUV19dsnc2bTFzWiFoJGhkQTKawPNUslx7uxNk/SWsK28ipaHhDRsQBSHlec3BdJveVw4bE43euuaaMN/M3tt5OQFHCJTRAlClx3nQsYCqARfDfF6VLgQBR3wplhplTem+argKtQd/uUi0JxeAoAFaBP0wgxRxh/kA/WDusqZ2ciy21mDQ1LJPZlPiAHS7Hf4NyY3rCeHWVfMXglpnt2x5wRnEQblbEDLC55PtoqOyf6IfCeNiYjaaWcNUcTNTKACM0yBqHSy3WzT2eRHZam0ruPUIKGAMAdM+d1PP9jKiMcx+cC4SfVgXviRwkXvx4PoDqS0+/vDzXwJzA6caQC63tmbDTmhX+1PNhcMsE9bGjJOoA0WAE8P3JxbFWDayNkqbVKHTTYL+BuLt93Dq8AbdioSGiII9L/UUIC9L52Vt/uhy3BOsJNDUyl+s8AcWBy0W8AylsYAA=',
      '1784021178178': 'data:image/webp;base64,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',
      '1784021181201': 'data:image/webp;base64,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',
    };

    for (var r = 1; r < prodData.length; r++) {
      var row = prodData[r];
      var pid = String(row[idCol]);
      existingIds.add(pid);

      for (var k in imgMap) {
        if (pid.indexOf(k) !== -1 && (!row[prodHeaders.indexOf('Image')] || row[prodHeaders.indexOf('Image')].length < 10)) {
          prodSheet.getRange(r + 1, prodHeaders.indexOf('Image') + 1).setValue(imgMap[k]);
        }
      }

      if (pid === 'P01') {
        prodSheet.getRange(r + 1, nameCol + 1).setValue('Trà Thơm Nhiệt Đới (Summer Pineapple)');
        prodSheet.getRange(r + 1, statusCol + 1).setValue('ACTIVE');
      } else if (pid === 'P02') {
        prodSheet.getRange(r + 1, nameCol + 1).setValue('Trà Xoài Nhiệt Đới (Summer Mango)');
        prodSheet.getRange(r + 1, statusCol + 1).setValue('ACTIVE');
      } else if (pid === 'P08') {
        prodSheet.getRange(r + 1, sizeCol + 1).setValue(true);
        prodSheet.getRange(r + 1, iceCol + 1).setValue(true);
        prodSheet.getRange(r + 1, sugarCol + 1).setValue(true);
      } else if (pid.indexOf('1783946880512') !== -1) {
        prodSheet.getRange(r + 1, sizeCol + 1).setValue(false);
        prodSheet.getRange(r + 1, iceCol + 1).setValue(false);
        prodSheet.getRange(r + 1, sugarCol + 1).setValue(false);
      }
    }

    var newCoffees = [
      { ID: 'P-CF01', Name: 'Cà Phê Muối', Category: 'Cà Phê', Price: 28000, Image: '', HasSize: true, HasIce: true, HasSugar: true, Status: 'ACTIVE' },
      { ID: 'P-CF02', Name: 'Cà Phê Sữa Pha Phin', Category: 'Cà Phê', Price: 22000, Image: '', HasSize: true, HasIce: true, HasSugar: true, Status: 'ACTIVE' },
      { ID: 'P-CF03', Name: 'Bạc Xỉu Lá', Category: 'Cà Phê', Price: 25000, Image: '', HasSize: true, HasIce: true, HasSugar: true, Status: 'ACTIVE' },
      { ID: 'P-CF04', Name: 'Cà Phê Đen Đá', Category: 'Cà Phê', Price: 18000, Image: '', HasSize: true, HasIce: true, HasSugar: true, Status: 'ACTIVE' }
    ];

    newCoffees.forEach(function(cf) {
      if (!existingIds.has(cf.ID)) {
        appendRowToSheet(SHEETS.PRODUCTS, cf);
      }
    });

    var topData = topSheet.getDataRange().getValues();
    var topHeaders = topData[0];
    var topIdCol = topHeaders.indexOf('ID');
    var existingTopIds = new Set();
    for (var t = 1; t < topData.length; t++) {
      existingTopIds.add(String(topData[t][topIdCol]));
    }

    if (!existingTopIds.has('T08')) {
      appendRowToSheet(SHEETS.TOPPINGS, { ID: 'T08', Name: 'Hạt Đác Rim Thơm', Price: 5000, Status: 'ACTIVE' });
    }

    invalidateCache(SHEETS.PRODUCTS);
    invalidateCache(SHEETS.TOPPINGS);
    CacheService.getScriptCache().remove('menu_pub');
    CacheService.getScriptCache().remove('menu_admin');

    return { success: true, message: 'Đã chuẩn hóa Menu thành công!' };
  });
}
