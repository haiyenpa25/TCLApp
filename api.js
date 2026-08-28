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
  return withLock(function() {
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
  return withLock(function() {
    deleteRowFromSheet(SHEETS.PRODUCTS, 'ID', id);
    CacheService.getScriptCache().removeAll(['menu_pub', 'menu_admin']);
    return { success: true, id: id };
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
    deleteRowFromSheet(SHEETS.TOPPINGS, 'ID', id);
    CacheService.getScriptCache().removeAll(['menu_pub', 'menu_admin']);
    return { success: true, id: id };
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
    for (var r = 1; r < prodData.length; r++) {
      var row = prodData[r];
      var pid = String(row[idCol]);
      existingIds.add(pid);

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
