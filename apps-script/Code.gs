/**
 * Number5 Apartment — Backend (Google Apps Script Web App)
 * -------------------------------------------------------------------
 * Data store : Google Sheet (SHEET_ID below)
 * Frontend   : static site (Netlify) that calls this /exec endpoint
 *
 * DEPLOY AS:  Execute as = Me (owner)  ·  Who has access = Anyone
 * The frontend sends the same TOKEN on every request.
 *
 * Endpoints:
 *   GET  ?action=ping&token=..            -> {ok, empty}
 *   GET  ?action=load&token=..            -> {ok, data:<state>}       (also supports &callback= for JSONP)
 *   POST {action:"saveAll", token, data}  -> {ok, savedAt}
 * -------------------------------------------------------------------
 */
var SHEET_ID = "1mkoaFdnrVLGY6Z5OVgYLA3nksdf2-nAK6D-nHTwfuGA";
var TOKEN    = "n5-a7f3k9q2";   // MUST match the token baked into the frontend

var TAB = {
  tenants:  "ผู้เช่า",
  water:    "มิเตอร์น้ำ",
  elec:     "มิเตอร์ไฟ",
  invoices: "บิล",
  costs:    "ต้นทุน",
  settings: "ตั้งค่า",
  income:   "รายได้ย้อนหลัง"
};
var TENANT_COLS  = ["roomId","roomLabel","firstName","lastName","phone","deposit","roomRate","elecRate","waterRate","occupied","moveInDate","startWater","startElec","note"];
var INVOICE_COLS = ["id","period","roomId","roomLabel","tenant","phone","issueDate","savedAt","type","waterUnits","elecUnits","waterRate","elecRate","subtotal","discount","total","deposit","refund","note","linesJson"];
var COST_COLS    = ["period","govWater","govElec","maintenance","note"];

/* ===================== HTTP entry points ===================== */
function doGet(e){
  var p = (e && e.parameter) ? e.parameter : {};
  try{
    if(p.token !== TOKEN) return out_({ok:false, error:"bad token"}, p.callback);
    var action = p.action || "load";
    if(action === "ping") return out_({ok:true, empty:isEmpty_()}, p.callback);
    if(action === "load") return out_({ok:true, data:readAll_()}, p.callback);
    return out_({ok:false, error:"unknown action: "+action}, p.callback);
  }catch(err){
    return out_({ok:false, error:String(err && err.message || err)}, p.callback);
  }
}

function doPost(e){
  try{
    var body = JSON.parse(e.postData.contents);
    if(body.token !== TOKEN) return out_({ok:false, error:"bad token"});
    if(body.action === "saveAll"){
      var lock = LockService.getScriptLock();
      lock.waitLock(25000);
      try{ writeAll_(body.data || {}); }
      finally{ lock.releaseLock(); }
      return out_({ok:true, savedAt:new Date().toISOString()});
    }
    return out_({ok:false, error:"unknown action"});
  }catch(err){
    return out_({ok:false, error:String(err && err.message || err)});
  }
}

function out_(obj, callback){
  var json = JSON.stringify(obj);
  if(callback){
    return ContentService.createTextOutput(callback + "(" + json + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* ===================== sheet helpers ===================== */
function ss_(){ return SpreadsheetApp.openById(SHEET_ID); }
function sheet_(name){
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if(!sh) sh = ss.insertSheet(name);
  return sh;
}
function isEmpty_(){
  var sh = ss_().getSheetByName(TAB.tenants);
  return !sh || sh.getLastRow() < 2;
}
function s_(v){ return v==null ? "" : String(v); }
function n_(v){ if(v===""||v==null) return 0; var x=parseFloat(String(v).replace(/,/g,"")); return isFinite(x)?x:0; }

/* ===================== READ (sheet -> state) ===================== */
function readAll_(){
  return {
    version: 2,
    buildingName: s_(getSetting_("buildingName")) || "หอพักเลขที่ 5",
    rooms: readRooms_(),
    roomLabels: readRoomLabels_(),
    tenants: readTenants_(),
    water: readMeter_(TAB.water),
    elec: readMeter_(TAB.elec),
    invoices: readInvoices_(),
    costs: readCosts_(),
    incomeHistory: readIncome_(),
    settings: { defaultNote: s_(getSetting_("defaultNote")) },
    seq: Number(getSetting_("seq")) || 1
  };
}
function readTable_(name){
  var sh = ss_().getSheetByName(name);
  if(!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getDataRange().getValues();
  var head = vals[0].map(String);
  var rows = [];
  for(var i=1;i<vals.length;i++){
    var o={}, blank=true;
    for(var c=0;c<head.length;c++){ o[head[c]] = vals[i][c]; if(vals[i][c]!=="" && vals[i][c]!=null) blank=false; }
    if(!blank) rows.push(o);
  }
  return rows;
}
function readRooms_(){
  return readTable_(TAB.tenants).map(function(r){ return String(r.roomId); });
}
function readRoomLabels_(){
  var o={}; readTable_(TAB.tenants).forEach(function(r){ o[String(r.roomId)] = s_(r.roomLabel) || String(r.roomId); });
  return o;
}
function readTenants_(){
  var t={};
  readTable_(TAB.tenants).forEach(function(r){
    t[String(r.roomId)] = {
      firstName:s_(r.firstName), lastName:s_(r.lastName), phone:s_(r.phone),
      deposit:n_(r.deposit), roomRate:n_(r.roomRate), elecRate:n_(r.elecRate), waterRate:n_(r.waterRate),
      occupied: (r.occupied===true||r.occupied==="TRUE"||r.occupied==="true"||r.occupied===1||r.occupied==="1"),
      moveInDate: s_(r.moveInDate),
      startWater: (r.startWater===""||r.startWater==null)?null:n_(r.startWater),
      startElec:  (r.startElec===""||r.startElec==null)?null:n_(r.startElec),
      note:s_(r.note)
    };
  });
  return t;
}
function readMeter_(name){
  var sh = ss_().getSheetByName(name);
  if(!sh || sh.getLastRow()<2) return {};
  var vals = sh.getDataRange().getValues();
  var head = vals[0].map(String);
  var out={};
  for(var i=1;i<vals.length;i++){
    var period = s_(vals[i][0]); if(!period) continue;
    var rec = { _date: s_(vals[i][1]) };
    for(var c=2;c<head.length;c++){
      var v = vals[i][c];
      if(v!=="" && v!=null) rec[head[c]] = n_(v);
    }
    out[period]=rec;
  }
  return out;
}
function readInvoices_(){
  return readTable_(TAB.invoices).map(function(r){
    var lines=[]; try{ lines = r.linesJson ? JSON.parse(r.linesJson) : []; }catch(e){}
    return {
      id:s_(r.id), period:s_(r.period), roomId:s_(r.roomId), roomLabel:s_(r.roomLabel),
      tenant:s_(r.tenant), phone:s_(r.phone), issueDate:s_(r.issueDate), savedAt:s_(r.savedAt),
      type:s_(r.type)||"normal",
      waterUnits:n_(r.waterUnits), elecUnits:n_(r.elecUnits), waterRate:n_(r.waterRate), elecRate:n_(r.elecRate),
      subtotal:n_(r.subtotal), discount:n_(r.discount), total:n_(r.total),
      deposit:n_(r.deposit), refund:n_(r.refund), note:s_(r.note), lines:lines
    };
  });
}
function readCosts_(){
  var o={}; readTable_(TAB.costs).forEach(function(r){
    o[String(r.period)] = {govWater:n_(r.govWater), govElec:n_(r.govElec), maintenance:n_(r.maintenance), note:s_(r.note)};
  });
  return o;
}
function readIncome_(){
  var sh = ss_().getSheetByName(TAB.income);
  if(!sh || sh.getLastRow()<2) return {};
  var vals = sh.getDataRange().getValues();
  var head = vals[0].map(String);
  var out={};
  for(var i=1;i<vals.length;i++){
    var period=s_(vals[i][0]); if(!period) continue;
    var rec={};
    for(var c=1;c<head.length;c++){ var v=vals[i][c]; if(v!=="" && v!=null) rec[head[c]]=n_(v); }
    out[period]=rec;
  }
  return out;
}
function getSetting_(key){
  var rows = readTable_(TAB.settings);
  for(var i=0;i<rows.length;i++){ if(String(rows[i].key)===key) return rows[i].value; }
  return "";
}

/* ===================== WRITE (state -> sheet) ===================== */
function writeAll_(st){
  var rooms  = Array.isArray(st.rooms) ? st.rooms.map(String) : [];
  var labels = st.roomLabels || {};

  var tRows = rooms.map(function(id){
    var t = (st.tenants && st.tenants[id]) || {};
    return [id, labels[id]||id, s_(t.firstName), s_(t.lastName), s_(t.phone),
      n_(t.deposit), n_(t.roomRate), n_(t.elecRate), n_(t.waterRate),
      t.occupied?"TRUE":"FALSE", s_(t.moveInDate),
      (t.startWater==null?"":n_(t.startWater)), (t.startElec==null?"":n_(t.startElec)), s_(t.note)];
  });
  writeSheet_(TAB.tenants, TENANT_COLS, tRows);

  writeMeter_(TAB.water, rooms, st.water||{});
  writeMeter_(TAB.elec,  rooms, st.elec||{});

  var invRows = (st.invoices||[]).map(function(inv){
    return [s_(inv.id), s_(inv.period), s_(inv.roomId), s_(inv.roomLabel), s_(inv.tenant), s_(inv.phone),
      s_(inv.issueDate), s_(inv.savedAt), s_(inv.type)||"normal", n_(inv.waterUnits), n_(inv.elecUnits), n_(inv.waterRate), n_(inv.elecRate),
      n_(inv.subtotal), n_(inv.discount), n_(inv.total), (inv.deposit==null?"":n_(inv.deposit)), (inv.refund==null?"":n_(inv.refund)),
      s_(inv.note), JSON.stringify(inv.lines||[])];
  });
  writeSheet_(TAB.invoices, INVOICE_COLS, invRows);

  var costRows = Object.keys(st.costs||{}).sort().map(function(p){
    var c=st.costs[p]||{}; return [p, n_(c.govWater), n_(c.govElec), n_(c.maintenance), s_(c.note)];
  });
  writeSheet_(TAB.costs, COST_COLS, costRows);

  writeIncome_(rooms, st.incomeHistory||{});

  writeSheet_(TAB.settings, ["key","value"], [
    ["buildingName", s_(st.buildingName)||"หอพักเลขที่ 5"],
    ["defaultNote", (st.settings && s_(st.settings.defaultNote)) || ""],
    ["seq", String(Number(st.seq)||1)]
  ]);
}
function writeSheet_(name, header, rows){
  var sh = sheet_(name);
  sh.clear();
  var data = normalizeRows_([header].concat(rows), header.length);
  var rng = sh.getRange(1,1,data.length, header.length);
  rng.setNumberFormat("@");           // text format: prevents Sheets auto-parsing "2026-06" / "1/1" / phone
  rng.setValues(data);
  sh.getRange(1,1,1,header.length).setFontWeight("bold");
  sh.setFrozenRows(1);
}
function normalizeRows_(data, width){
  return data.map(function(r){
    r = r.slice(0,width);
    while(r.length<width) r.push("");
    return r;
  });
}
function writeMeter_(name, rooms, obj){
  var header = ["period","date"].concat(rooms);
  var rows = Object.keys(obj).sort().reverse().map(function(p){
    var rec=obj[p]||{}, row=[p, s_(rec._date)];
    rooms.forEach(function(rid){ row.push(rec[rid]==null?"":n_(rec[rid])); });
    return row;
  });
  writeSheet_(name, header, rows);
}
function writeIncome_(rooms, obj){
  var header=["period"].concat(rooms);
  var rows=Object.keys(obj).sort().reverse().map(function(p){
    var rec=obj[p]||{}, row=[p];
    rooms.forEach(function(rid){ row.push(rec[rid]==null?"":n_(rec[rid])); });
    return row;
  });
  writeSheet_(TAB.income, header, rows);
}

/* ===================== manual helpers (run from editor) ===================== */
function ping_test(){ Logger.log(JSON.stringify({empty:isEmpty_()})); }   // Run once to authorize Sheet access
