/******************************************************************
 * KHO APP – Web app nhập / xuất / xem tồn kho cho Phúc Xuân Foods
 * Ghi trực tiếp vào sheet "Nhập kho" và "Xuất kho" của file này.
 * Danh mục hàng lấy từ sheet "Tồn Kho" (cột B:E).
 * Danh sách người dùng / kho / lý do xuất / PIN: sheet "CAI_DAT".
 * Mọi thao tác tạo / sửa / xoá được ghi vào sheet "LICH_SU_APP".
 *
 * Chống ghi trùng: mã phiếu do điện thoại tạo sẵn. Nếu mạng chập chờn
 * và điện thoại gửi lại cùng một phiếu, server nhận ra và bỏ qua.
 ******************************************************************/

// ======================= CONFIG =======================
const KHO_CONFIG = {
  APP_TITLE: 'KHO PHÚC XUÂN',
  SHEET_ITEMS: 'Tồn Kho',        // danh mục hàng
  ITEMS_FIRST_ROW: 4,            // dòng đầu tiên có hàng
  ITEMS_COL_NAME: 2,             // B: Tên hàng
  ITEMS_COL_UNIT: 3,             // C: ĐVT
  ITEMS_COL_GROUP: 4,            // D: Phân loại
  ITEMS_COL_CODE: 5,             // E: Mã hàng

  SHEET_CHUYEN: 'Chuyển Kho',    // chỉ đọc để tính tồn
  SHEET_SETTINGS: 'CAI_DAT',
  SHEET_LOG: 'LICH_SU_APP',

  DATA_FIRST_ROW: 4,             // dòng dữ liệu đầu tiên của Nhập kho / Xuất kho
  // Cột trong Nhập kho / Xuất kho (1 = A). B, D, F là ARRAYFORMULA – KHÔNG ghi vào.
  COL: { ID: 1, DATE: 3, NAME: 5, QTY: 7, NOTE: 8, USER: 9, KHO: 10 },

  TYPES: {
    NHAP: { sheet: 'Nhập kho', prefix: 'PN', label: 'NHẬP' },
    XUAT: { sheet: 'Xuất kho', prefix: 'PX', label: 'XUẤT' }
  },

  DEFAULT_KHOS: ['KHO KHÔ', 'KHO ĐÔNG', 'KHO 19', 'KHO 10', 'KHO 12'],
  DEFAULT_USERS: ['Hoàng'],
  DEFAULT_REASONS: ['Giao khách', 'Sơ chế', 'Hàng hư / huỷ'],

  RECENT_LIMIT: 80,              // số phiếu gần đây trả về
  CACHE_SETTINGS_SEC: 120,       // cài đặt (CAI_DAT) được nhớ tạm 2 phút
  CACHE_ITEMS_SEC: 600,          // danh mục hàng được nhớ tạm 10 phút
  TZ: 'Asia/Ho_Chi_Minh'
};
// Mã phiếu tạo từ app: PN261126-094924A7K2 (loại + yyMMdd-HHmmss + 2..4 ký tự ngẫu nhiên)
const KHO_KEY_RE = /^P[NX]\d{6}-\d{6}[0-9A-Z]{2,4}$/;
// ======================================================


/* ---------------- Web app entry ---------------- */
function doGet(e) {
  return HtmlService.createTemplateFromFile('KhoAppUI')
    .evaluate()
    .setTitle(KHO_CONFIG.APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


/* ---------------- API cho trang GitHub Pages (fetch POST, dữ liệu JSON) ---------------- */
const KHO_API = {
  khoApi_getSettings: khoApi_getSettings, khoApi_bootstrap: khoApi_bootstrap,
  khoApi_savePhieu: khoApi_savePhieu, khoApi_deletePhieu: khoApi_deletePhieu, khoApi_itemHistory: khoApi_itemHistory
};
function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = KHO_API[req.fn];
    if (!fn) kho_fail_('Không có chức năng ' + req.fn);
    out = { ok: true, data: fn.apply(null, req.args || []) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- API gọi từ giao diện ---------------- */
// Lỗi "thật" (dữ liệu sai) có tiền tố KHO| để điện thoại biết KHÔNG cần gửi lại.
function kho_fail_(msg) { throw new Error('KHO|' + msg); }

/** Cài đặt (giữ cho tương thích). */
function khoApi_getSettings() {
  const s = kho_readSettings_();
  return { users: s.users, khos: s.khos, reasons: s.reasons, needPin: !!s.pin, title: KHO_CONFIG.APP_TITLE };
}

/** Toàn bộ dữ liệu cho app: cài đặt, danh mục, tồn, phiếu gần đây. */
function khoApi_bootstrap(pin) {
  const s = kho_readSettings_();
  const settings = { users: s.users, reasons: s.reasons, needPin: !!s.pin, title: KHO_CONFIG.APP_TITLE };
  if (s.pin && String(pin || '') !== s.pin) return { pinRequired: true, settings: settings };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const items = kho_readItems_(ss);
  const nhap = kho_readTx_(ss, 'NHAP');
  const xuat = kho_readTx_(ss, 'XUAT');
  return {
    settings: settings,
    items: items.map(i => [i.name, i.unit, i.group]),
    stock: kho_computeStock_(ss, nhap, xuat),
    recent: kho_recentGroups_(nhap, xuat),
    khos: kho_mergeKhos_(s.khos, nhap, xuat),
    serverTime: Utilities.formatDate(new Date(), KHO_CONFIG.TZ, 'yyyy-MM-dd HH:mm')
  };
}

/**
 * Lưu phiếu (tạo mới hoặc sửa). Gọi lại nhiều lần vẫn an toàn.
 * payload = { type:'NHAP'|'XUAT',
 *             id:    mã phiếu mới (do điện thoại tạo) – khi TẠO MỚI,
 *             key:   mã phiếu cũ – khi SỬA,
 *             newKey: mã mới cho phiếu cũ không có mã app (CU|...) – khi SỬA,
 *             date:'yyyy-MM-dd', kho, note, user, lines:[{name, qty}] }
 */
function khoApi_savePhieu(pin, payload) {
  kho_checkPin_(pin);
  const t = KHO_CONFIG.TYPES[payload.type];
  if (!t) kho_fail_('Loại phiếu không hợp lệ');
  if (!payload.user) kho_fail_('Chưa chọn người nhập');
  if (!payload.kho) kho_fail_('Chưa chọn kho');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date || '')) kho_fail_('Ngày không hợp lệ');

  const itemNames = new Set(kho_cachedItems_().map(i => i.name));
  const lines = [];
  const errors = [];
  (payload.lines || []).forEach((ln, idx) => {
    const name = String(ln.name || '').trim();
    const qtyRaw = String(ln.qty == null ? '' : ln.qty).trim();
    if (!name && !qtyRaw) return;
    if (!name) { errors.push('Dòng ' + (idx + 1) + ': chưa có tên hàng'); return; }
    if (!itemNames.has(name)) { errors.push('Dòng ' + (idx + 1) + ': "' + name + '" không có trong danh mục'); return; }
    const q = kho_parseQty_(qtyRaw);
    if (q === null || q.value <= 0) { errors.push('Dòng ' + (idx + 1) + ': số lượng không hợp lệ'); return; }
    lines.push({ name: name, qty: q });
  });
  if (errors.length) kho_fail_(errors.join('\n'));
  if (!lines.length) kho_fail_('Phiếu chưa có món nào');

  const p = payload.date.split('-').map(Number);
  const dateObj = new Date(p[0], p[1] - 1, p[2]);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = ss.getSheetByName(t.sheet);
    kho_fixOpenRanges_(sh);
    let oldSnapshot = null;
    let phieuId;

    if (payload.key) {                                   // ----- SỬA
      phieuId = KHO_KEY_RE.test(payload.key) ? payload.key
              : (KHO_KEY_RE.test(payload.newKey || '') ? payload.newKey : kho_newPhieuId_(t.prefix));
      const found = kho_findRowsByKey_(sh, payload.key);
      if (!found.rows.length) {
        // đã sửa rồi (lần gửi trước thành công nhưng điện thoại không nhận được phản hồi)
        if (phieuId !== payload.key && kho_findRowsByKey_(sh, phieuId).rows.length) return { ok: true, key: phieuId, dup: true };
        kho_fail_('Không tìm thấy phiếu cũ (có thể đã bị người khác xoá).');
      }
      oldSnapshot = found.snapshot;
      kho_deleteRows_(sh, found.rows);
    } else {                                             // ----- TẠO MỚI
      phieuId = KHO_KEY_RE.test(payload.id || '') ? payload.id : kho_newPhieuId_(t.prefix);
      if (kho_findRowsByKey_(sh, phieuId).rows.length) return { ok: true, key: phieuId, dup: true }; // gửi trùng
    }

    kho_appendLines_(sh, phieuId, dateObj, payload, lines);
    SpreadsheetApp.flush();

    kho_log_(payload.key ? 'SỬA' : 'TẠO', t.label, phieuId, payload.user, {
      ngay: payload.date, kho: payload.kho, ghichu: payload.note || '',
      mon: lines.map(l => l.name + ': ' + l.qty.text),
      truoc: oldSnapshot
    });
    return { ok: true, key: phieuId, count: lines.length };
  } finally {
    lock.releaseLock();
  }
}

/** Xoá phiếu. Không tìm thấy = đã xoá rồi → coi như thành công. */
function khoApi_deletePhieu(pin, type, key, user) {
  kho_checkPin_(pin);
  const t = KHO_CONFIG.TYPES[type];
  if (!t) kho_fail_('Loại phiếu không hợp lệ');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = ss.getSheetByName(t.sheet);
    const found = kho_findRowsByKey_(sh, key);
    if (!found.rows.length) return { ok: true, already: true };
    kho_fixOpenRanges_(sh);
    kho_deleteRows_(sh, found.rows);
    SpreadsheetApp.flush();
    kho_log_('XOÁ', t.label, key, user || '', { truoc: found.snapshot });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** Lịch sử nhập/xuất của 1 mặt hàng (mới nhất trước). */
function khoApi_itemHistory(pin, name) {
  kho_checkPin_(pin);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = [];
  ['NHAP', 'XUAT'].forEach(type => {
    kho_readTx_(ss, type).forEach(r => {
      if (r.name === name) out.push({ type: type, date: r.dateStr, kho: r.kho, qty: r.qty, user: r.user, note: r.note, ts: r.ts });
    });
  });
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, 40);
}


/* ---------------- Đọc dữ liệu ---------------- */

function kho_cachedItems_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('kho_items_v1');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  const items = kho_readItems_(SpreadsheetApp.getActiveSpreadsheet());
  try { cache.put('kho_items_v1', JSON.stringify(items), KHO_CONFIG.CACHE_ITEMS_SEC); } catch (e) {}
  return items;
}

function kho_readItems_(ss) {
  const C = KHO_CONFIG;
  const sh = ss.getSheetByName(C.SHEET_ITEMS);
  const last = sh.getLastRow();
  if (last < C.ITEMS_FIRST_ROW) return [];
  const vals = sh.getRange(C.ITEMS_FIRST_ROW, C.ITEMS_COL_NAME, last - C.ITEMS_FIRST_ROW + 1,
    C.ITEMS_COL_CODE - C.ITEMS_COL_NAME + 1).getValues();
  const seen = new Set();
  const out = [];
  vals.forEach(r => {
    const name = String(r[0] || '').trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({
      name: name,
      unit: String(r[C.ITEMS_COL_UNIT - C.ITEMS_COL_NAME] || ''),
      group: String(r[C.ITEMS_COL_GROUP - C.ITEMS_COL_NAME] || '')
    });
  });
  try { CacheService.getScriptCache().put('kho_items_v1', JSON.stringify(out), KHO_CONFIG.CACHE_ITEMS_SEC); } catch (e) {}
  return out;
}

/** Đọc giao dịch có số lượng của Nhập kho / Xuất kho. */
function kho_readTx_(ss, type) {
  const C = KHO_CONFIG;
  const sh = ss.getSheetByName(C.TYPES[type].sheet);
  const last = kho_lastDataRow_(sh);
  if (last < C.DATA_FIRST_ROW) return [];
  const n = last - C.DATA_FIRST_ROW + 1;
  const vals = sh.getRange(C.DATA_FIRST_ROW, 1, n, C.COL.KHO).getValues();
  const forms = sh.getRange(C.DATA_FIRST_ROW, C.COL.QTY, n, 1).getFormulas();
  const out = [];
  vals.forEach((r, i) => {
    const name = String(r[C.COL.NAME - 1] || '').trim();
    const qty = Number(r[C.COL.QTY - 1]);
    if (!name || r[C.COL.QTY - 1] === '' || isNaN(qty)) return;
    const d = r[C.COL.DATE - 1];
    const dateOk = d instanceof Date;
    const dateStr = dateOk ? Utilities.formatDate(d, C.TZ, 'yyyy-MM-dd') : '';
    const id = String(r[C.COL.ID - 1] || '');
    const kho = String(r[C.COL.KHO - 1] || '').trim();
    out.push({
      row: C.DATA_FIRST_ROW + i,
      id: id,
      key: kho_rowKey_(id, dateStr, kho),
      date: d, dateStr: dateStr, ts: dateOk ? d.getTime() : 0,
      name: name, qty: qty,
      qtyText: kho_qtyText_(forms[i][0], r[C.COL.QTY - 1]),
      note: String(r[C.COL.NOTE - 1] || ''),
      user: String(r[C.COL.USER - 1] || ''),
      kho: kho
    });
  });
  return out;
}

/** Tồn hiện tại theo tên hàng & kho: { tên: { kho: số } } */
function kho_computeStock_(ss, nhap, xuat) {
  const stock = {};
  const add = (name, kho, q) => {
    if (!name) return;
    kho = kho || '(Chưa rõ kho)';
    stock[name] = stock[name] || {};
    stock[name][kho] = (stock[name][kho] || 0) + q;
  };
  nhap.forEach(r => add(r.name, r.kho, r.qty));
  xuat.forEach(r => add(r.name, r.kho, -r.qty));

  // Chuyển kho: E tên, G SL, H từ kho, I đến kho
  const sh = ss.getSheetByName(KHO_CONFIG.SHEET_CHUYEN);
  if (sh && sh.getLastRow() >= 4) {
    sh.getRange(4, 1, sh.getLastRow() - 3, 9).getValues().forEach(r => {
      const name = String(r[4] || '').trim();
      const q = Number(r[6]);
      if (!name || r[6] === '' || isNaN(q)) return;
      add(name, String(r[7] || '').trim(), -q);
      add(name, String(r[8] || '').trim(), q);
    });
  }
  Object.keys(stock).forEach(n => {
    Object.keys(stock[n]).forEach(k => {
      const v = Math.round(stock[n][k] * 1000) / 1000;
      if (v === 0) delete stock[n][k]; else stock[n][k] = v;
    });
    if (!Object.keys(stock[n]).length) delete stock[n];
  });
  return stock;
}

/** Gom dòng thành phiếu, trả về phiếu gần đây nhất. */
function kho_recentGroups_(nhap, xuat) {
  const groups = {};
  const push = (type, r) => {
    const gk = type + '|' + r.key;
    let g = groups[gk];
    if (!g) {
      g = groups[gk] = { type: type, key: r.key, date: r.dateStr, kho: r.kho, user: r.user,
        note: r.note, lines: [], maxRow: 0, ts: r.ts, isApp: KHO_KEY_RE.test(r.key) };
    }
    g.lines.push([r.name, r.qtyText]);
    g.maxRow = Math.max(g.maxRow, r.row);
  };
  nhap.forEach(r => push('NHAP', r));
  xuat.forEach(r => push('XUAT', r));
  const list = Object.keys(groups).map(k => groups[k]);
  list.forEach(g => { g.sort = g.isApp ? kho_idTime_(g.key) : g.ts; });
  list.sort((a, b) => (b.sort - a.sort) || (b.maxRow - a.maxRow));
  return list.slice(0, KHO_CONFIG.RECENT_LIMIT).map(g => ({
    type: g.type, key: g.key, date: g.date, kho: g.kho, user: g.user, note: g.note, lines: g.lines, isApp: g.isApp
  }));
}

function kho_mergeKhos_(khos, nhap, xuat) {
  const set = khos.slice();
  nhap.concat(xuat).forEach(r => { if (r.kho && set.indexOf(r.kho) < 0) set.push(r.kho); });
  return set;
}


/* ---------------- Ghi / xoá ---------------- */

function kho_appendLines_(sh, phieuId, dateObj, payload, lines) {
  const C = KHO_CONFIG.COL;
  const start = kho_lastDataRow_(sh) + 1;
  const n = lines.length;
  const need = start + n - 1;
  if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 50);

  const ids = [], dates = [], names = [], rest = [];
  lines.forEach((l, i) => {
    ids.push([phieuId + '.' + String(i + 1).padStart(2, '0')]);
    dates.push([dateObj]);
    names.push([l.name]);
    // G: SL (công thức nếu có phép tính), H: ghi chú, I: người, J: kho
    rest.push([l.qty.formula || l.qty.value, payload.note || '', payload.user, payload.kho]);
  });
  // Ghi từng cột riêng để không đè lên cột ARRAYFORMULA (B, D, F)
  sh.getRange(start, C.ID, n, 1).setValues(ids);
  sh.getRange(start, C.DATE, n, 1).setValues(dates).setNumberFormat('dd/MM/yyyy');
  sh.getRange(start, C.NAME, n, 1).setValues(names);
  sh.getRange(start, C.QTY, n, 4).setValues(rest);
}

function kho_findRowsByKey_(sh, key) {
  const C = KHO_CONFIG;
  const last = kho_lastDataRow_(sh);
  const rows = [];
  const snapshot = [];
  if (last < C.DATA_FIRST_ROW) return { rows: rows, snapshot: snapshot };
  const n = last - C.DATA_FIRST_ROW + 1;
  const vals = sh.getRange(C.DATA_FIRST_ROW, 1, n, C.COL.KHO).getValues();
  const forms = sh.getRange(C.DATA_FIRST_ROW, C.COL.QTY, n, 1).getFormulas();
  vals.forEach((r, i) => {
    const name = String(r[C.COL.NAME - 1] || '').trim();
    if (!name || r[C.COL.QTY - 1] === '') return;
    const d = r[C.COL.DATE - 1];
    const dateStr = d instanceof Date ? Utilities.formatDate(d, C.TZ, 'yyyy-MM-dd') : '';
    const k = kho_rowKey_(String(r[C.COL.ID - 1] || ''), dateStr, String(r[C.COL.KHO - 1] || '').trim());
    if (k === key) {
      rows.push(C.DATA_FIRST_ROW + i);
      snapshot.push(name + ': ' + kho_qtyText_(forms[i][0], r[C.COL.QTY - 1]));
    }
  });
  return { rows: rows, snapshot: snapshot };
}

/** Xoá các dòng (gom các đoạn liên tiếp, xoá từ dưới lên). */
function kho_deleteRows_(sh, rows) {
  rows = rows.slice().sort((a, b) => b - a);
  let i = 0;
  while (i < rows.length) {
    let end = rows[i], start = rows[i];
    while (i + 1 < rows.length && rows[i + 1] === start - 1) { i++; start = rows[i]; }
    sh.deleteRows(start, end - start + 1);
    i++;
  }
}

/** Dòng cuối cùng có dữ liệu thật (dựa trên cột Tên hàng / ID / Ngày). */
function kho_lastDataRow_(sh) {
  const C = KHO_CONFIG;
  const max = sh.getLastRow();
  if (max < C.DATA_FIRST_ROW) return C.DATA_FIRST_ROW - 1;
  const vals = sh.getRange(C.DATA_FIRST_ROW, 1, max - C.DATA_FIRST_ROW + 1, C.COL.NAME).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    const r = vals[i];
    if (String(r[C.COL.NAME - 1]).trim() !== '') return C.DATA_FIRST_ROW + i;   // chỉ dựa vào cột Tên hàng (cột ID có sẵn nhiều mã trống)
  }
  return C.DATA_FIRST_ROW - 1;
}

/**
 * Các ARRAYFORMULA ở dòng 3 (Mã lô, Mã hàng, ĐVT) từng giới hạn tới dòng 1995 / 4042.
 * Đổi sang dải mở (D4:D) để app ghi thêm bao nhiêu dòng cũng có Mã hàng / ĐVT.
 */
function kho_fixOpenRanges_(sh) {
  [2, 4, 6].forEach(col => {
    const cell = sh.getRange(3, col);
    const f = cell.getFormula();
    if (!f) return;
    const nf = f.replace(/(\$?[A-Z]{1,2}\$?4:\$?[A-Z]{1,2})\$?\d+/g, '$1');
    if (nf !== f) cell.setFormula(nf);
  });
}


/* ---------------- Tiện ích ---------------- */

/**
 * Biểu thức số lượng kiểu máy tính: "12", "8,2", "20,5+3", "12×3−1,5", "50÷2", "100−5%"
 * % theo kiểu máy tính điện thoại: a+b% = a + a×b/100 ; a×b% = a×b/100 ; b% = b/100
 * Trả về số (làm tròn 3 chữ số thập phân) hoặc null nếu sai.
 */
function kho_evalExpr_(raw) {
  const s = String(raw == null ? '' : raw).replace(/\s+/g, '').replace(/^=/, '')
    .replace(/[*xX]/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
  if (!s) return null;
  const toks = [];
  const re = /(\d+(?:[.,]\d+)?)|([+−×÷])|(%)/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < s.length) {
    const at = re.lastIndex;
    m = re.exec(s);
    if (!m || m.index !== at) return null;
    toks.push(m[1] ? { n: Number(m[1].replace(',', '.')) } : { o: m[2] || m[3] });
  }
  let i = 0;
  const factor = () => {
    const t = toks[i];
    if (!t || t.n === undefined) throw 0;
    i++;
    if (toks[i] && toks[i].o === '%') { i++; return { v: t.n / 100, pct: true }; }
    return { v: t.n, pct: false };
  };
  const term = () => {
    const f = factor(); let v = f.v, pct = f.pct;
    while (toks[i] && (toks[i].o === '×' || toks[i].o === '÷')) {
      const op = toks[i++].o, g = factor();
      if (op === '÷' && g.v === 0) throw 0;
      v = op === '×' ? v * g.v : v / g.v; pct = false;
    }
    return { v: v, pct: pct };
  };
  try {
    let acc = term().v;
    while (toks[i] && (toks[i].o === '+' || toks[i].o === '−')) {
      const op = toks[i++].o, t = term();
      const add = t.pct ? acc * t.v : t.v;
      acc = op === '+' ? acc + add : acc - add;
    }
    if (i !== toks.length || !isFinite(acc)) return null;
    return Math.round(acc * 1000) / 1000;
  } catch (e) { return null; }
}

/** → {value, text (dạng hiển thị: 20,5+3), formula (để ghi vào sheet, hoặc null)} */
function kho_parseQty_(raw) {
  const value = kho_evalExpr_(raw);
  if (value === null) return null;
  const text = String(raw).replace(/\s+/g, '').replace(/^=/, '').replace(/\./g, ',')
    .replace(/[*xX]/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
  let formula = null;
  // Có phép tính và không có % → ghi công thức để còn xem lại cách tính.
  // Số thập phân viết dạng (205/10) để không phụ thuộc dấu thập phân của file (vi_VN dùng dấu phẩy).
  if (/[+−×÷]/.test(text) && text.indexOf('%') < 0) {
    formula = '=' + text.replace(/(\d+),(\d+)/g, (m, a, b) => '(' + (a + b).replace(/^0+(?=\d)/, '') + '/' + Math.pow(10, b.length) + ')')
      .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  }
  return { value: value, text: text, formula: formula };
}

/** Đọc lại số lượng từ sheet để hiển thị: "=(205/10)*3-1" → "20,5×3−1"; công thức lạ → giá trị */
function kho_qtyText_(formula, value) {
  const plain = String(value).replace('.', ',');
  if (!formula) return plain;
  let f = String(formula).replace(/^=/, '').replace(/\s+/g, '');
  f = f.replace(/\((\d+)\/(10+)\)/g, (m, a, b) => {
    const k = b.length - 1, d = a.padStart(k + 1, '0');
    return d.slice(0, -k) + ',' + d.slice(-k);
  });
  if (/^[\d,+\-*\/]+$/.test(f)) return f.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
  return plain;
}

function kho_newPhieuId_(prefix) {
  let r = '';
  for (let i = 0; i < 4; i++) r += '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.charAt(Math.floor(Math.random() * 36));
  return prefix + Utilities.formatDate(new Date(), KHO_CONFIG.TZ, 'yyMMdd-HHmmss') + r;
}

function kho_rowKey_(id, dateStr, kho) {
  const m = String(id).match(/^(P[NX]\d{6}-\d{6}[0-9A-Z]{2,4})\.\d+$/);
  if (m) return m[1];
  return 'CU|' + dateStr + '|' + kho; // dòng cũ (trước khi có app): gom theo ngày + kho
}

function kho_idTime_(key) {
  const m = key.match(/^P[NX](\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (!m) return 0;
  return new Date(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

function kho_checkPin_(pin) {
  const s = kho_readSettings_();
  if (s.pin && String(pin || '') !== s.pin) kho_fail_('SAI_PIN');
}

/** Đọc (và tạo nếu chưa có) sheet CAI_DAT. Nhớ tạm vài phút cho nhanh. */
function kho_readSettings_() {
  const C = KHO_CONFIG;
  const cache = CacheService.getScriptCache();
  const hit = cache.get('kho_settings_v1');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(C.SHEET_SETTINGS);
  if (!sh) {
    sh = ss.insertSheet(C.SHEET_SETTINGS);
    const header = [['NGƯỜI DÙNG', 'KHO', 'LÝ DO XUẤT (gợi ý)', 'MÃ PIN (để trống = không cần)']];
    sh.getRange(1, 1, 1, 4).setValues(header).setFontWeight('bold').setBackground('#38761d').setFontColor('#ffffff');
    const rows = Math.max(C.DEFAULT_USERS.length, C.DEFAULT_KHOS.length, C.DEFAULT_REASONS.length);
    const data = [];
    for (let i = 0; i < rows; i++) {
      data.push([C.DEFAULT_USERS[i] || '', C.DEFAULT_KHOS[i] || '', C.DEFAULT_REASONS[i] || '', '']);
    }
    sh.getRange(2, 1, rows, 4).setValues(data);
    sh.getRange('D2').setNumberFormat('@');
    sh.setColumnWidths(1, 4, 220);
    sh.setFrozenRows(1);
  }
  const last = Math.max(sh.getLastRow(), 2);
  const v = sh.getRange(2, 1, last - 1, 4).getDisplayValues();
  const col = i => v.map(r => String(r[i]).trim()).filter(x => x);
  const s = { users: col(0), khos: col(1), reasons: col(2), pin: String(v[0][3] || '').trim() };
  try { cache.put('kho_settings_v1', JSON.stringify(s), C.CACHE_SETTINGS_SEC); } catch (e) {}
  return s;
}

/** Chạy tay hàm này nếu vừa sửa CAI_DAT / danh mục và muốn app thấy ngay. */
function khoXoaBoNhoTam() {
  CacheService.getScriptCache().removeAll(['kho_settings_v1', 'kho_items_v1']);
}

function kho_log_(action, typeLabel, key, user, detail) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(KHO_CONFIG.SHEET_LOG);
  if (!sh) {
    sh = ss.insertSheet(KHO_CONFIG.SHEET_LOG);
    sh.getRange(1, 1, 1, 6).setValues([['Thời điểm', 'Người', 'Thao tác', 'Loại', 'Mã phiếu', 'Chi tiết']])
      .setFontWeight('bold').setBackground('#38761d').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidth(6, 600);
  }
  const lines = [];
  if (detail.ngay) lines.push('Ngày ' + detail.ngay + ' | ' + detail.kho + (detail.ghichu ? ' | ' + detail.ghichu : ''));
  if (detail.mon) lines.push('Sau: ' + detail.mon.join('; '));
  if (detail.truoc) lines.push('Trước: ' + detail.truoc.join('; '));
  sh.appendRow([new Date(), user, action, typeLabel, key, lines.join('\n')]);
}
