/**
 * Web App Entry Point \u2014 Ti\u1ec7m C\u1ee7a L\u00e1 v3.1
 * Encoding: UTF-8
 */

/**
 * Sanitize URL param: ch\u1ec9 cho ph\u00e9p k\u00fd t\u1ef1 an to\u00e0n, ng\u0103n XSS khi inject v\u00e0o HTML.
 * Ch\u1ec9 gi\u1eef l\u1ea1i: a-z, A-Z, 0-9, d\u1ea5u g\u1ea1ch d\u01b0\u1edbi, g\u1ea1ch ngang.
 * @param {string} val - Gi\u00e1 tr\u1ecb c\u1ea7n sanitize
 * @returns {string} Chu\u1ed7i \u0111\u00e3 l\u1ecdc, t\u1ed1i \u0111a 30 k\u00fd t\u1ef1
 */
function sanitizeUrlParam(val) {
  if (!val || typeof val !== 'string') return '';
  return val.replace(/[^a-zA-Z0-9_\-]/g, '').substring(0, 30);
}

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Ti\u1ec7m C\u1ee7a L\u00e1 \u2014 H\u1ec7 Th\u1ed1ng Qu\u1ea3n L\u00fd POS & F&B')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
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
  if (!props.getProperty('SHOP_NAME'))    props.setProperty('SHOP_NAME', 'Ti\u1ec7m C\u1ee7a L\u00e1');

  return '\u2705 Setup ho\u00e0n t\u1ea5t v3.2 \u2014 \u0110\u00e3 th\u00eam Staff + TaskTemplates + TaskInstances!';
}

function seedSampleData(ss) {
  const prodSheet = ss.getSheetByName('Products');
  if (prodSheet.getLastRow() <= 1) {
    const products = [
      ['P01','H\u1ed3ng Tr\u00e0 T\u1eafc M\u1eadt Ong','Tr\u00e0 Tr\u00e1i C\u00e2y',18000,'',true,true,true,'ACTIVE'],
      ['P02','Tr\u00e0 S\u1eefa Truy\u1ec1n Th\u1ed1ng','Tr\u00e0 S\u1eefa',23000,'',true,true,true,'ACTIVE'],
      ['P03','Tr\u00e0 \u0110\u00e0o Cam S\u1ea3','Tr\u00e0 Tr\u00e1i C\u00e2y',25000,'',true,true,true,'ACTIVE'],
      ['P04','Tr\u00e0 \u1ed4i H\u1ed3ng H\u1ea1t L\u1ef1u','Tr\u00e0 Tr\u00e1i C\u00e2y',28000,'',true,true,true,'ACTIVE'],
      ['P05','Tr\u00e0 S\u1eefa Oolong L\u00e0i','Tr\u00e0 S\u1eefa',26000,'',true,true,true,'ACTIVE'],
      ['P06','C\u00e0 Ph\u00ea S\u1eefa S\u00e0i G\u00f2n','C\u00e0 Ph\u00ea',20000,'',true,true,true,'ACTIVE'],
      ['P07','B\u1ea1c X\u1ec9u S\u01b0\u01a1ng M\u00f9','C\u00e0 Ph\u00ea',22000,'',true,true,true,'ACTIVE'],
      ['P08','Matcha Latte Kem S\u1eefa','Tr\u00e0 S\u1eefa',30000,'',true,true,true,'ACTIVE'],
    ];
    prodSheet.getRange(2, 1, products.length, products[0].length).setValues(products);
  }

  const topSheet = ss.getSheetByName('Toppings');
  if (topSheet.getLastRow() <= 1) {
    const toppings = [
      ['T01','Tr\u00e2n Ch\u00e2u \u0110en',5000,'ACTIVE'],
      ['T02','Tr\u00e2n Ch\u00e2u Tr\u1eafng 3Q',6000,'ACTIVE'],
      ['T03','Pudding Tr\u1ee9ng',7000,'ACTIVE'],
      ['T04','Kem Cheese Macchiato',8000,'ACTIVE'],
      ['T05','Th\u1ea1ch Tr\u00e1i C\u00e2y',5000,'ACTIVE'],
      ['T06','\u0110\u00e0o Mi\u1ebfng (2 l\u00e1t)',7000,'ACTIVE'],
    ];
    topSheet.getRange(2, 1, toppings.length, toppings[0].length).setValues(toppings);
  }

  const tableSheet = ss.getSheetByName('Tables');
  if (tableSheet.getLastRow() <= 1) {
    const tables = [
      ['TB01','B\u00e0n 01','FREE',4,''],
      ['TB02','B\u00e0n 02','FREE',2,''],
      ['TB03','B\u00e0n 03','FREE',6,''],
      ['TB04','B\u00e0n 04','FREE',4,''],
      ['TB05','B\u00e0n 05','FREE',2,''],
      ['TB06','B\u00e0n 06','FREE',8,''],
      ['TB07','B\u00e0n Ngo\u00e0i Tr\u1eddi 1','FREE',4,''],
      ['TB08','B\u00e0n Ngo\u00e0i Tr\u1eddi 2','FREE',4,''],
    ];
    tableSheet.getRange(2, 1, tables.length, tables[0].length).setValues(tables);
  }

  const staffSheet = ss.getSheetByName('Staff');
  if (staffSheet.getLastRow() <= 1) {
    const staff = [
      ['ST01','Dinh (Ch\u1ee7 qu\u00e1n)','ACTIVE'],
      ['ST02','Linh (Pha ch\u1ebf)','ACTIVE'],
      ['ST03','An (Ph\u1ee5c v\u1ee5)','ACTIVE'],
    ];
    staffSheet.getRange(2, 1, staff.length, staff[0].length).setValues(staff);
  }

  const tmplSheet = ss.getSheetByName('TaskTemplates');
  if (tmplSheet.getLastRow() <= 1) {
    const today = new Date().toISOString().split('T')[0];
    const templates = [
      ['TT01','Ki\u1ec3m k\u00ea nguy\u00ean li\u1ec7u \u0111\u1ea7u ng\u00e0y','Ki\u1ec3m tra s\u1eefa, tr\u00e0, siro, topping','ST02','Linh (Pha ch\u1ebf)','DAILY',1,'HIGH',today,'ACTIVE'],
      ['TT02','V\u1ec7 sinh m\u00e1y pha c\u00e0 ph\u00ea & d\u1ee5ng c\u1ee5','R\u1eeda s\u1ea1ch v\u00f2i steam, c\u1ecd r\u1eeda ca \u0111ong','ST02','Linh (Pha ch\u1ebf)','DAILY',1,'HIGH',today,'ACTIVE'],
      ['TT03','Lau d\u1ecdn b\u00e0n gh\u1ebf & khu v\u1ef1c kh\u00e1ch ng\u1ed3i','Lau s\u1ea1ch t\u1ea5t c\u1ea3 b\u00e0n, s\u1eafp x\u1ebfp gh\u1ebf ngay ng\u1eafn','ST03','An (Ph\u1ee5c v\u1ee5)','DAILY',1,'MEDIUM',today,'ACTIVE'],
      ['TT04','\u0110\u1ed5 r\u00e1c & v\u1ec7 sinh qu\u1ea7y pha ch\u1ebf cu\u1ed1i ca','Thu gom t\u00fai r\u00e1c, lau s\u00e0n qu\u1ea7y bar','ST03','An (Ph\u1ee5c v\u1ee5)','DAILY',1,'HIGH',today,'ACTIVE'],
      ['TT05','T\u1ed5ng k\u1ebft doanh thu & ki\u1ec3m qu\u1ef9 ti\u1ec1n m\u1eb7t','\u0110\u1ebfm ti\u1ec1n m\u1eb7t, \u0111\u1ed1i so\u00e1t v\u1edbi h\u1ec7 th\u1ed1ng POS','ST01','Dinh (Ch\u1ee7 qu\u00e1n)','DAILY',1,'HIGH',today,'ACTIVE'],
      ['TT06','Ki\u1ec3m tra h\u1ea1n s\u1eed d\u1ee5ng nguy\u00ean li\u1ec7u t\u1ed3n kho','Ki\u1ec3m tra date c\u00e1c h\u1ed9p siro, s\u1eefa, tr\u00e0 \u1ee7','ST02','Linh (Pha ch\u1ebf)','WEEKLY',1,'MEDIUM',today,'ACTIVE'],
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
  return '\u2705 \u0110\u00e3 reset Menu v\u1ec1 d\u1eef li\u1ec7u m\u1eabu t\u1ed1i \u01b0u!';
}
