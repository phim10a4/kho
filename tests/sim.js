/* Giả lập app web (../index.html) trong jsdom với máy chủ giả – không cần mạng.
 * Kiểm tra: tạo phiếu, bàn phím máy tính, mất mạng → hàng chờ, có mạng lại → gửi, chống ghi trùng.
 * Chạy: cd tests && npm i && node sim.js */
const { JSDOM } = require('jsdom');
const fs = require('fs'); const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let NET = true; const SHEET = []; let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '✔ ' : '✘ ') + msg); if (!cond) fails++; };

const fixture = { settings:{users:['Hoàng'],reasons:['Giao khách'],needPin:false,title:'KHO PHÚC XUÂN'},
  items:[['Cá thu','kg','CÁ'],['Chả lụa','kg','CHẾ BIẾN SẴN'],['Xúc xích gà','kg','CHẾ BIẾN SẴN']],
  stock:{'Chả lụa':{'KHO ĐÔNG':38}}, recent:[], khos:['KHO KHÔ','KHO ĐÔNG','KHO 19'] };
const server = {
  khoApi_bootstrap(){ return JSON.parse(JSON.stringify(fixture)); },
  khoApi_savePhieu(pin, p){ const k = p.key || p.id; if (!p.key && SHEET.some(r => r.key === k)) return {ok:true, dup:true};
    p.lines.forEach(l => SHEET.push({key:k, name:l.name, qty:l.qty})); return {ok:true}; },
  khoApi_deletePhieu(){ return {ok:true}; }, khoApi_itemHistory(){ return []; }
};
function fakeFetch(url, opt){
  if (!NET) return Promise.reject(new TypeError('Failed to fetch'));
  const req = JSON.parse(opt.body);
  return new Promise(res => setTimeout(() => {
    let body; try { body = {ok:true, data: server[req.fn](...req.args)}; } catch(e){ body = {ok:false, error:String(e.message)}; }
    res({ ok:true, status:200, json: async () => body });
  }, 5));
}
(async () => {
  const dom = new JSDOM(html, { runScripts:'dangerously', url:'https://phim10a4.github.io/kho/', beforeParse(w){
    w.fetch = fakeFetch; w.localStorage.setItem('khoapp_user','Hoàng'); w.scrollTo = ()=>{}; w.HTMLElement.prototype.scrollIntoView = ()=>{}; } });
  const w = dom.window, d = w.document; await sleep(100);
  ok(d.getElementById('main').textContent.includes('Nhập kho'), 'Trang chủ hiển thị');
  ok(w.parseQty('12×3−1,5') === 34.5 && w.parseQty('100−5%') === 95 && isNaN(w.parseQty('1÷0')), 'Biểu thức số lượng');
  w.openForm('XUAT'); const sel = d.getElementById('fKho'); sel.value = 'KHO ĐÔNG'; sel.dispatchEvent(new w.Event('change'));
  w.openPicker(); const s = d.getElementById('pkSearch'); s.value = 'cha lua'; s.dispatchEvent(new w.Event('input'));
  d.querySelector('#pkList [data-p]').click(); ['1','2',',','5','+','3','='].forEach(k => w.kpKey(k));
  ok(JSON.stringify(w.eval('S').form.lines) === '[{"name":"Chả lụa","qty":"12,5+3"}]', 'Bàn phím + chọn hàng');
  w.closePicker();
  NET = false; w.savePhieu(); await sleep(5); d.getElementById('cYes').click(); await sleep(50);
  ok(JSON.parse(w.localStorage.getItem('khoapp_outbox')).length === 1 && SHEET.length === 0, 'Mất mạng: phiếu nằm trong hàng chờ');
  ok(w.stockOf('Chả lụa','KHO ĐÔNG') === 22.5, 'Tồn trên máy đã trừ ngay (38 − 15,5)');
  NET = true; w.dispatchEvent(new w.Event('online')); await sleep(150);
  ok(SHEET.length === 1 && JSON.parse(w.localStorage.getItem('khoapp_outbox')).length === 0, 'Có mạng lại: đã gửi lên');
  const id = SHEET[0].key; server.khoApi_savePhieu('', {id, lines:[{name:'Chả lụa', qty:'12,5+3'}]});
  ok(SHEET.length === 1, 'Gửi trùng không ghi thêm');
  console.log(fails ? `\n${fails} kiểm tra lỗi` : '\nTất cả kiểm tra đều đạt'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
