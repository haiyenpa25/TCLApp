/**
 * Web App Entry Point — Tiệm Của Lá v3.1
 * Encoding: UTF-8
 */

/**
 * Sanitize URL param: chỉ cho phép ký tự an toàn, ngăn XSS khi inject vào HTML.
 * Chỉ giữ lại: a-z, A-Z, 0-9, dấu gạch dưới, gạch ngang.
 * @param {string} val - Giá trị cần sanitize
 * @returns {string} Chuỗi đã lọc, tối đa 30 ký tự
 */
function sanitizeUrlParam(val) {
  if (!val || typeof val !== 'string') return '';
  return val.replace(/[^a-zA-Z0-9_\-]/g, '').substring(0, 30);
}

/**
 * Entry point chính của Web App GAS.
 * @param {GoogleAppsScript.Events.DoGet} e - Event object chứa URL parameters
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Tiệm Của Lá — Hệ Thống Quản Lý POS & F&B')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const schema = {
    'Products':        ['ID','Name','Category','Price','Image','HasSize','HasIce','HasSugar','Status'],
    'Toppings':        ['ID','Name','Price','Status'],
    'Tables':          ['ID','Name','Status','Capacity','QR_URL'],
    'Orders':          ['ID','TableID','TotalAmount','Status','Source','OrderType','CustomerID','CustomerName','CustomerPhone','DeliveryAddress','CreatedAt','Note'],
    'Order_Details':   ['ID','OrderID','ProductID','ProductName','Size','Ice','Sugar','Toppings','Quantity','Price','Subtotal'],
    'Customers':       ['ID','Name','Phone','Type','Company','Address','Email','Points','TotalSpent','CreatedAt','Note'],
    'Expenses':        ['ID','Date','Category','Description','Amount','Note','FundingSource','PerformedBy','PerformedByName'],
    // Task Management
    'Staff':           ['ID','Name','Status'],
    'TaskTemplates':   ['ID','Title','Description','AssignedTo','AssignedName','RepeatType','RepeatEvery','Priority','StartDate','Status'],
    'TaskInstances':   ['ID','TemplateID','Title','AssignedTo','AssignedName','DueDate','Priority','Status','CompletedAt','CompletedBy','Note'],
    // Financial & Session Management
    'Payments':        ['ID','OrderID','TableSessionID','Amount','Method','ReceivedAmount','ChangeAmount','Status','TransactionRef','CashierName','CreatedAt','Note'],
    'CustomerPointLedger': ['ID','CustomerID','OrderID','Type','Points','CreatedAt','Note'],
    'TableSessions':   ['ID','TableID','Status','OpenedAt','ClosedAt','CustomerCount','Note'],
  };

  for (const [name, headers] of Object.entries(schema)) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    } else {
      // Add missing columns to existing sheets
      const lastCol = sheet.getLastColumn();
      const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
      headers.forEach((h) => {
        if (!existing.includes(h)) {
          existing.push(h);
          sheet.getRange(1, existing.length).setValue(h);
        }
      });
    }
  }

  seedSampleData(ss);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_PIN'))    props.setProperty('ADMIN_PIN', '1234');
  if (!props.getProperty('BANK_ID'))      props.setProperty('BANK_ID', '970436');
  if (!props.getProperty('ACCOUNT_NO'))   props.setProperty('ACCOUNT_NO', '');
  if (!props.getProperty('ACCOUNT_NAME')) props.setProperty('ACCOUNT_NAME', 'TIEM CUA LA');
  if (!props.getProperty('SHOP_NAME'))    props.setProperty('SHOP_NAME', 'Tiệm Của Lá');

  return '✅ Setup hoàn tất v3.2 — Đã thêm Staff + TaskTemplates + TaskInstances!';
}

function seedSampleData(ss) {
  const prodSheet = ss.getSheetByName('Products');
  if (prodSheet.getLastRow() <= 1) {
    const products = [
      ['P01','Hồng Trà Tắc Mật Ong','Trà Trái Cây',18000,'',true,true,true,'ACTIVE'],
      ['P02','Trà Sữa Truyền Thống','Trà Sữa',23000,'',true,true,true,'ACTIVE'],
      ['P03','Trà Đào Cam Sả','Trà Trái Cây',25000,'',true,true,true,'ACTIVE'],
      ['P04','Trà Ổi Hồng Hạt Lựu','Trà Trái Cây',28000,'',true,true,true,'ACTIVE'],
      ['P05','Trà Sữa Oolong Lài','Trà Sữa',26000,'',true,true,true,'ACTIVE'],
      ['P06','Cà Phê Sữa Sài Gòn','Cà Phê',20000,'',true,true,true,'ACTIVE'],
      ['P07','Bạc Xỉu Sương Mù','Cà Phê',22000,'',true,true,true,'ACTIVE'],
      ['P08','Matcha Latte Kem Sữa','Trà Sữa',30000,'',true,true,true,'ACTIVE'],
    ];
    prodSheet.getRange(2, 1, products.length, products[0].length).setValues(products);
  }

  const topSheet = ss.getSheetByName('Toppings');
  if (topSheet.getLastRow() <= 1) {
    const toppings = [
      ['T01','Trân Châu Đen',5000,'ACTIVE'],
      ['T02','Trân Châu Trắng 3Q',6000,'ACTIVE'],
      ['T03','Pudding Trứng',7000,'ACTIVE'],
      ['T04','Kem Cheese Macchiato',8000,'ACTIVE'],
      ['T05','Thạch Trái Cây',5000,'ACTIVE'],
      ['T06','Đào Miếng (2 lát)',7000,'ACTIVE'],
    ];
    topSheet.getRange(2, 1, toppings.length, toppings[0].length).setValues(toppings);
  }

  const tableSheet = ss.getSheetByName('Tables');
  if (tableSheet.getLastRow() <= 1) {
    const tables = [
      ['TB01','Bàn 01','FREE',4,''],
      ['TB02','Bàn 02','FREE',2,''],
      ['TB03','Bàn 03','FREE',6,''],
      ['TB04','Bàn 04','FREE',4,''],
      ['TB05','Bàn 05','FREE',2,''],
      ['TB06','Bàn 06','FREE',8,''],
      ['TB07','Bàn Ngoài Trời 1','FREE',4,''],
      ['TB08','Bàn Ngoài Trời 2','FREE',4,''],
    ];
    tableSheet.getRange(2, 1, tables.length, tables[0].length).setValues(tables);
  }

  const staffSheet = ss.getSheetByName('Staff');
  if (staffSheet.getLastRow() <= 1) {
    const staff = [
      ['ST01','Dinh (Chủ quán)','ACTIVE'],
      ['ST02','Linh (Pha chế)','ACTIVE'],
      ['ST03','An (Phục vụ)','ACTIVE'],
    ];
    staffSheet.getRange(2, 1, staff.length, staff[0].length).setValues(staff);
  }

  const tmplSheet = ss.getSheetByName('TaskTemplates');
  if (tmplSheet.getLastRow() <= 1) {
    const today = new Date().toISOString().split('T')[0];
    const templates = [
      ['TT01','Kiểm kê nguyên liệu đầu ngày','Kiểm tra sữa, trà, siro, topping','ST02','Linh (Pha chế)','DAILY',1,'HIGH',today,'ACTIVE'],
      ['TT02','Vệ sinh máy pha cà phê & dụng cụ','Rửa sạch vòi steam, cọ rửa ca đong','ST02','Linh (Pha chế)','DAILY',1,'HIGH',today,'ACTIVE'],
      ['TT03','Lau dọn bàn ghế & khu vực khách ngồi','Lau sạch tất cả bàn, sắp xếp ghế ngay ngắn','ST03','An (Phục vụ)','DAILY',1,'MEDIUM',today,'ACTIVE'],
      ['TT04','Đổ rác & vệ sinh quầy pha chế cuối ca','Thu gom túi rác, lau sàn quầy bar','ST03','An (Phục vụ)','DAILY',1,'HIGH',today,'ACTIVE'],
      ['TT05','Tổng kết doanh thu & kiểm quỹ tiền mặt','Đếm tiền mặt, đối soát với hệ thống POS','ST01','Dinh (Chủ quán)','DAILY',1,'HIGH',today,'ACTIVE'],
      ['TT06','Kiểm tra hạn sử dụng nguyên liệu tồn kho','Kiểm tra date các hộp siro, sữa, trà ủ','ST02','Linh (Pha chế)','WEEKLY',1,'MEDIUM',today,'ACTIVE'],
    ];
    tmplSheet.getRange(2, 1, templates.length, templates[0].length).setValues(templates);
  }
}

function resetMenu() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const prodSheet = ss.getSheetByName('Products');
  if (prodSheet) {
    const lastRow = prodSheet.getLastRow();
    if (lastRow > 1) {
      prodSheet.getRange(2, 1, lastRow - 1, prodSheet.getLastColumn()).clearContent();
    }
  }
  const topSheet = ss.getSheetByName('Toppings');
  if (topSheet) {
    const lastRow = topSheet.getLastRow();
    if (lastRow > 1) {
      topSheet.getRange(2, 1, lastRow - 1, topSheet.getLastColumn()).clearContent();
    }
  }
  seedSampleData(ss);
  return '✅ Đã reset Menu về dữ liệu mẫu tối ưu!';
}
