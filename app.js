// ============================
// BondTracker — app.js
// ============================

let bonds = [];
let transactions = [];
let finData = {}; // { '2026-03': { deposits: 0, piggybank: 0 }, ... }
let settings = { taxRate: 13, brokerFee: 0.3, accountNKD: true };
let charts = {};
let currentPage = 'dashboard';
let couponYear = new Date().getFullYear();
let calendarYear = new Date().getFullYear();
let sortState = { key: '', dir: 1 };

const TX_LABELS = { buy:'Покупка', sell:'Продажа', coupon:'Купон', maturity:'Погашение', amortization:'Амортизация' };
const MN = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

// === Init ===
document.addEventListener('DOMContentLoaded', function() {
  loadStorage();
  setupEvents();
  renderAll();
  // Автозагрузка из облака при старте
  if (settings.syncUrl) {
    cloudLoadQuiet();
  }
});

function saveStorageLocal() {
  try {
    localStorage.setItem('bt_bonds', JSON.stringify(bonds));
    localStorage.setItem('bt_tx', JSON.stringify(transactions));
    localStorage.setItem('bt_settings', JSON.stringify(settings));
    localStorage.setItem('bt_fin', JSON.stringify(finData));
  } catch(e) {}
}

// === Storage ===
var cloudSaveTimer = null;

function saveStorage() {
  try {
    localStorage.setItem('bt_bonds', JSON.stringify(bonds));
    localStorage.setItem('bt_tx', JSON.stringify(transactions));
    localStorage.setItem('bt_settings', JSON.stringify(settings));
    localStorage.setItem('bt_fin', JSON.stringify(finData));
  } catch(e) { console.error('save error', e); }

  // Автосохранение в облако с задержкой 5 сек (debounce)
  if (settings.syncUrl) {
    if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(function() { cloudSaveQuiet(); }, 5000);
  }
}

// === Cloud Sync ===
// Google Apps Script Web App делает redirect 302.
// fetch с redirect:'follow' для GET работает.
// Для POST redirect ломает тело — поэтому шлём через скрытый form/iframe.

function cloudGet(url) {
  return fetch(url, { redirect: 'follow' })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
}

function cloudPostViaForm(url, payload) {
  return new Promise(function(resolve, reject) {
    // Создаём скрытый iframe + form для отправки POST
    var id = 'cf_' + Date.now();
    var iframe = document.createElement('iframe');
    iframe.name = id;
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    var form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.target = id;
    form.style.display = 'none';

    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'payload';
    input.value = JSON.stringify(payload);
    form.appendChild(input);

    document.body.appendChild(form);
    form.submit();

    // Не можем прочитать ответ из-за CORS, но данные дойдут
    setTimeout(function() {
      try { document.body.removeChild(iframe); } catch(e) {}
      try { document.body.removeChild(form); } catch(e) {}
      resolve();
    }, 3000);
  });
}

function cloudSaveQuiet() {
  var url = settings.syncUrl;
  if (!url) return;
  var now = new Date().toISOString();
  settings.lastSaved = now;
  saveStorageLocal();
  var payload = {
    action: 'save',
    data: {
      bonds: bonds,
      transactions: transactions,
      settings: settings,
      finData: finData,
      savedAt: now
    }
  };
  cloudPostViaForm(url, payload).catch(function() {});
}

function cloudLoadQuiet() {
  var url = settings.syncUrl;
  if (!url) return;
  cloudGet(url)
    .then(function(res) {
      if (res.status === 'ok' && res.data) {
        var d = res.data;
        var cloudTime = d.savedAt ? new Date(d.savedAt).getTime() : 0;
        var localTime = settings.lastSaved ? new Date(settings.lastSaved).getTime() : 0;
        if (cloudTime > localTime) {
          var syncUrl = settings.syncUrl;
          if (d.bonds) bonds = d.bonds;
          if (d.transactions) transactions = d.transactions;
          if (d.finData) finData = d.finData;
          if (d.settings) settings = Object.assign({}, settings, d.settings);
          settings.syncUrl = syncUrl;
          settings.lastSaved = d.savedAt;
          saveStorageLocal();
          loadStorage();
          renderAll();
          showToast('Данные синхронизированы', 'success');
        }
      }
    })
    .catch(function() {});
}

function loadStorage() {
  try {
    var b = localStorage.getItem('bt_bonds');
    var t = localStorage.getItem('bt_tx');
    var s = localStorage.getItem('bt_settings');
    var f = localStorage.getItem('bt_fin');
    if (b) bonds = JSON.parse(b);
    if (t) transactions = JSON.parse(t);
    if (s) settings = Object.assign({}, settings, JSON.parse(s));
    if (f) finData = JSON.parse(f);
  } catch(e) {
    console.error('load error', e);
    bonds = [];
    transactions = [];
  }
  // Migrate old data
  bonds = bonds.map(function(b) {
    if (b.couponRate && !b.couponSize) {
      b.couponSize = (b.nominalValue || 1000) * (b.couponRate / 100) / (b.couponFreq || 2);
      delete b.couponRate;
    }
    if (!b.buyPrice && b.currentPrice) b.buyPrice = b.currentPrice;
    return b;
  });

  document.getElementById('settingsTax').value = settings.taxRate;
  document.getElementById('settingsBrokerFee').value = settings.brokerFee;
  document.getElementById('settingsNKD').checked = settings.accountNKD;
  if (settings.syncUrl) document.getElementById('settingsSyncUrl').value = settings.syncUrl;
}

// === Events ===
function setupEvents() {
  // Nav
  var navItems = document.querySelectorAll('.nav-item[data-page]');
  for (var i = 0; i < navItems.length; i++) {
    (function(item) {
      item.addEventListener('click', function() {
        navigateTo(item.getAttribute('data-page'));
        closeSidebar();
      });
    })(navItems[i]);
  }

  document.getElementById('menuToggle').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);
  document.getElementById('addBondBtn').addEventListener('click', openAddModal);
  document.getElementById('bondSaveBtn').addEventListener('click', saveBond);
  document.getElementById('portfolioSearch').addEventListener('input', renderPortfolio);

  // Sort headers
  var ths = document.querySelectorAll('#portfolioTable thead th[data-sort]');
  for (var j = 0; j < ths.length; j++) {
    (function(th) {
      th.addEventListener('click', function() {
        var k = th.getAttribute('data-sort');
        if (sortState.key === k) sortState.dir *= -1;
        else { sortState.key = k; sortState.dir = 1; }
        renderPortfolio();
      });
    })(ths[j]);
  }

  document.getElementById('couponYearPrev').addEventListener('click', function() { couponYear--; updateCouponChart(); });
  document.getElementById('couponYearNext').addEventListener('click', function() { couponYear++; updateCouponChart(); });
  document.getElementById('calYearPrev').addEventListener('click', function() { calendarYear--; renderCalendar(); });
  document.getElementById('calYearNext').addEventListener('click', function() { calendarYear++; renderCalendar(); });

  document.getElementById('settingsTax').addEventListener('change', function(e) { settings.taxRate = parseFloat(e.target.value)||0; saveStorage(); renderAll(); });
  document.getElementById('settingsBrokerFee').addEventListener('change', function(e) { settings.brokerFee = parseFloat(e.target.value)||0; saveStorage(); renderAll(); });
  document.getElementById('settingsNKD').addEventListener('change', function(e) { settings.accountNKD = e.target.checked; saveStorage(); renderAll(); });
  document.getElementById('settingsSyncUrl').addEventListener('change', function(e) { settings.syncUrl = e.target.value.trim(); saveStorage(); });

  document.getElementById('addTransactionBtn').addEventListener('click', openTxModal);
  document.getElementById('txSaveBtn').addEventListener('click', saveTx);
  document.getElementById('txFilter').addEventListener('change', renderTransactions);
  document.getElementById('txQuantity').addEventListener('input', calcTxTotal);
  document.getElementById('txPrice').addEventListener('input', calcTxTotal);

  // Bond form: live preview + select on focus
  var previewIds = ['bondNominal','bondQuantity','bondBuyPrice','bondCouponSize','bondCouponFreq','bondBuyDate','bondMaturityDate','bondNKD','bondTaxFree','bondFloating'];
  previewIds.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updatePreview);
      el.addEventListener('change', updatePreview);
      el.addEventListener('focus', function() { this.select(); });
    }
  });

  // Название тоже выделять при фокусе
  document.getElementById('bondName').addEventListener('focus', function() { this.select(); });

  document.getElementById('bondBuyDate').value = todayStr();
  document.getElementById('txDate').value = todayStr();
}

// === Nav ===
function navigateTo(page) {
  currentPage = page;
  var items = document.querySelectorAll('.nav-item');
  for (var i = 0; i < items.length; i++) items[i].classList.remove('active');
  var active = document.querySelector('.nav-item[data-page="'+page+'"]');
  if (active) active.classList.add('active');
  var sections = document.querySelectorAll('.page-content > section');
  for (var j = 0; j < sections.length; j++) sections[j].classList.remove('active');
  var sec = document.getElementById('page-'+page);
  if (sec) sec.classList.add('active');
  var titles = { dashboard:'Дашборд', portfolio:'Портфель', calendar:'Календарь выплат', floating:'Плавающие купоны', analytics:'Доходность', finances:'Учёт финансов', transactions:'Транзакции', settings:'Настройки' };
  document.getElementById('pageTitle').textContent = titles[page] || page;
  renderAll();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

function renderAll() {
  renderDashboard();
  renderPortfolio();
  renderCalendar();
  renderAnalytics();
  renderTransactions();
  renderFloating();
  renderFinances();
}

// === Utils ===
function fmt(n, d) {
  d = d || 0;
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}
function rub(n) { return fmt(n, 2) + ' ₽'; }
function genId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
function daysFromNow(d) { return daysBetween(new Date(), new Date(d)); }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// === Купонные даты ===
function getCouponDates(bond) {
  if (!bond.maturityDate || !bond.buyDate) return [];
  var freq = bond.couponFreq || 2;
  if (freq <= 0) return [];
  var gap = Math.round(12 / freq);
  if (gap <= 0) gap = 1;

  var mat = new Date(bond.maturityDate);
  var buy = new Date(bond.buyDate);
  mat.setHours(0,0,0,0);
  buy.setHours(0,0,0,0);

  if (mat <= buy) return [];

  // Идём от даты погашения назад с шагом в купонный период
  // Дата погашения = последняя купонная выплата + возврат номинала
  var dates = [];
  var d = new Date(mat);
  var limit = 500;
  while (d > buy && limit-- > 0) {
    dates.push(new Date(d));
    var prev = new Date(d);
    prev.setMonth(prev.getMonth() - gap);
    d = prev;
  }
  dates.reverse();
  return dates;
}

// Получить размер купона для конкретной даты (индекс в расписании)
// Для плавающих: couponMap[i] если есть, иначе последний известный, иначе couponSize
function getCouponForDate(bond, dateIndex) {
  if (!bond.floating) return bond.couponSize || 0;
  var cm = bond.couponMap || {};
  // Есть запись для этого индекса?
  if (cm[dateIndex] !== undefined) return cm[dateIndex];
  // Ищем последний известный до этого индекса
  var last = bond.couponSize || 0;
  for (var k = 0; k < dateIndex; k++) {
    if (cm[k] !== undefined) last = cm[k];
  }
  return last;
}

function couponSchedule(bond, year) {
  var dates = getCouponDates(bond);
  var qty = bond.quantity || 1;
  var taxRate = bond.taxFree ? 0 : settings.taxRate / 100;
  var now = new Date();
  var result = [];
  for (var i = 0; i < dates.length; i++) {
    if (dates[i].getFullYear() === year) {
      var c = getCouponForDate(bond, i);
      var gross = c * qty;
      var net = gross * (1 - taxRate);
      result.push({
        date: dates[i], bondId: bond.id, bondName: bond.name,
        amountNet: net, month: dates[i].getMonth(), isPast: dates[i] <= now
      });
    }
  }
  return result;
}

// === Расчёт одной облигации ===
function calcOne(b) {
  var nom = b.nominalValue || 1000;
  var price = b.buyPrice || nom;
  var coup = b.couponSize || 0;
  var freq = b.couponFreq || 2;
  var qty = b.quantity || 1;
  var taxRate = b.taxFree ? 0 : settings.taxRate / 100;

  var fee = price * qty * (settings.brokerFee / 100);
  var nkd = settings.accountNKD ? (b.nkd || 0) : 0;
  var invested = price * qty + nkd + fee;

  var yearsTotal = 0;
  if (b.maturityDate && b.buyDate) {
    yearsTotal = Math.max(daysBetween(b.buyDate, b.maturityDate) / 365, 0.01);
  }

  var couponDates = getCouponDates(b);
  var numCoupons = couponDates.length;

  // Купонный доход к погашению
  var couponTotal = 0;
  if (b.floating) {
    // Плавающий: суммируем по каждой дате свой купон
    for (var i = 0; i < numCoupons; i++) couponTotal += getCouponForDate(b, i);
    couponTotal *= qty;
  } else {
    couponTotal = coup * freq * qty * yearsTotal;
  }

  var capitalGain = (nom - price) * qty;
  var grossIncome = couponTotal + capitalGain - fee;
  var ndfl = grossIncome > 0 ? grossIncome * taxRate : 0;
  var netIncome = grossIncome - ndfl;

  var annualPercent = 0;
  if (yearsTotal > 0 && invested > 0) {
    annualPercent = (netIncome / invested / yearsTotal) * 100;
  }

  // Текущий приток — по последнему известному купону
  var lastCoup = b.floating ? getCouponForDate(b, numCoupons > 0 ? numCoupons - 1 : 0) : coup;
  var annualCouponGross = lastCoup * freq * qty;
  var annualCouponNet = annualCouponGross * (1 - taxRate);
  var monthlyNet = annualCouponNet / 12;

  return {
    nom: nom, price: price, coup: coup, freq: freq, qty: qty,
    fee: fee, nkd: nkd, invested: invested,
    yearsTotal: yearsTotal,
    couponTotal: couponTotal, capitalGain: capitalGain,
    grossIncome: grossIncome, ndfl: ndfl, netIncome: netIncome,
    annualPercent: annualPercent,
    annualCouponGross: annualCouponGross, annualCouponNet: annualCouponNet,
    monthlyNet: monthlyNet, numCoupons: numCoupons
  };
}

// === Расчёт из формы для preview ===
function calcFromForm() {
  return calcOne({
    nominalValue: parseFloat(document.getElementById('bondNominal').value) || 1000,
    quantity: parseInt(document.getElementById('bondQuantity').value) || 1,
    buyPrice: parseFloat(document.getElementById('bondBuyPrice').value) || 1000,
    couponSize: parseFloat(document.getElementById('bondCouponSize').value) || 0,
    couponFreq: parseInt(document.getElementById('bondCouponFreq').value) || 2,
    buyDate: document.getElementById('bondBuyDate').value,
    maturityDate: document.getElementById('bondMaturityDate').value,
    nkd: parseFloat(document.getElementById('bondNKD').value) || 0,
    taxFree: document.getElementById('bondTaxFree').checked,
    floating: document.getElementById('bondFloating').checked
  });
}

function updatePreview() {
  var el = document.getElementById('bondPreview');
  var buyDate = document.getElementById('bondBuyDate').value;
  var matDate = document.getElementById('bondMaturityDate').value;
  if (!buyDate || !matDate) {
    el.innerHTML = '<span style="color:var(--text-muted)">Укажите даты покупки и погашения</span>';
    return;
  }
  var m = calcFromForm();
  el.innerHTML =
    '<div class="preview-row"><span>% годовых</span><strong class="' + (m.annualPercent >= 0 ? 'positive' : 'negative') + '">' + fmt(m.annualPercent, 2) + '%</strong></div>' +
    '<div class="preview-row"><span>Чистый доход</span><strong class="' + (m.netIncome >= 0 ? 'positive' : 'negative') + '">' + rub(m.netIncome) + '</strong></div>' +
    '<div class="preview-row"><span>Вложено</span><strong>' + rub(m.invested) + '</strong></div>' +
    '<div class="preview-row"><span>Приток / мес</span><strong class="positive">' + rub(m.monthlyNet) + '</strong></div>' +
    '<div class="preview-row"><span>Срок</span><strong>' + fmt(m.yearsTotal, 2) + ' лет</strong></div>';
}

// === Группировка по названию ===
function groupBonds() {
  var groups = {};
  for (var i = 0; i < bonds.length; i++) {
    var b = bonds[i];
    var key = b.name;
    if (!groups[key]) {
      groups[key] = {
        name: key, bonds: [],
        nom: b.nominalValue || 1000,
        coup: b.couponSize || 0,
        freq: b.couponFreq || 2,
        maturityDate: b.maturityDate
      };
    }
    groups[key].bonds.push(b);
  }

  var result = [];
  for (var k in groups) {
    var g = groups[k];
    // Сортировка покупок внутри группы по дате покупки (от ранней к поздней)
    g.bonds.sort(function(a, b) {
      return (a.buyDate || '').localeCompare(b.buyDate || '');
    });

    var totalQty = 0, totalInvested = 0, totalFee = 0, totalNetIncome = 0;
    var annualGross = 0, annualNet = 0, weightedPct = 0;
    var earliestBuyDate = g.bonds.length ? (g.bonds[0].buyDate || '') : '';

    for (var j = 0; j < g.bonds.length; j++) {
      var m = calcOne(g.bonds[j]);
      totalQty += m.qty;
      totalInvested += m.invested;
      totalFee += m.fee;
      totalNetIncome += m.netIncome;
      annualGross += m.annualCouponGross;
      annualNet += m.annualCouponNet;
      weightedPct += m.annualPercent * m.invested;
    }

    var avgPrice = totalQty > 0 ? g.bonds.reduce(function(s, b) { return s + b.buyPrice * b.quantity; }, 0) / totalQty : g.nom;
    var monthlyNet = annualNet / 12;
    var annualPercent = totalInvested > 0 ? weightedPct / totalInvested : 0;

    result.push({
      name: g.name, bonds: g.bonds,
      qty: totalQty, avgPrice: avgPrice, nom: g.nom, coup: g.coup, freq: g.freq,
      invested: totalInvested, fee: totalFee,
      annualGross: annualGross, annualNet: annualNet, monthlyNet: monthlyNet,
      netIncome: totalNetIncome, annualPercent: annualPercent,
      maturityDate: g.maturityDate,
      earliestBuyDate: earliestBuyDate
    });
  }
  return result;
}

function summary() {
  var groups = groupBonds();
  var invested = 0, gross = 0, net = 0, nominal = 0, fees = 0, totalNetIncome = 0, weightedPct = 0;
  for (var i = 0; i < groups.length; i++) {
    var g = groups[i];
    invested += g.invested;
    gross += g.annualGross;
    net += g.annualNet;
    nominal += g.nom * g.qty;
    fees += g.fee;
    totalNetIncome += g.netIncome;
    weightedPct += g.annualPercent * g.invested;
  }
  var avgPct = invested > 0 ? weightedPct / invested : 0;
  return { invested: invested, gross: gross, net: net, nominal: nominal, fees: fees, avgPct: avgPct, monthlyNet: net/12, count: bonds.length, netIncome: totalNetIncome };
}

// === DASHBOARD ===
function renderDashboard() {
  var s = summary();
  var pc = s.netIncome >= 0 ? 'positive' : 'negative';
  document.getElementById('summaryCards').innerHTML =
    '<div class="summary-card"><div class="card-label">Вложено</div><div class="card-value">' + rub(s.invested) + '</div><div class="card-sub">' + s.count + ' облигаций</div></div>' +
    '<div class="summary-card"><div class="card-label">% годовых</div><div class="card-value">' + fmt(s.avgPct,2) + '%</div><div class="card-sub">Средний по портфелю</div></div>' +
    '<div class="summary-card"><div class="card-label">Приток / месяц</div><div class="card-value positive">' + rub(s.monthlyNet) + '</div><div class="card-sub">Чистыми после налога</div></div>' +
    '<div class="summary-card"><div class="card-label">Приток / год</div><div class="card-value positive">' + rub(s.net) + '</div><div class="card-sub">До нал.: ' + rub(s.gross) + '</div></div>' +
    '<div class="summary-card"><div class="card-label">Чистый доход</div><div class="card-value ' + pc + '">' + rub(s.netIncome) + '</div><div class="card-sub">За всё время до погашения</div></div>';
  renderValueChart();
  updateCouponChart();
  renderTopYield();
  renderMaturities();
}

function renderValueChart() {
  var ctx = document.getElementById('chartPortfolioValue');
  if (charts.val) charts.val.destroy();
  var labels = [], data = [], now = new Date();
  for (var i = 12; i >= 0; i--) {
    var d = new Date(now); d.setMonth(d.getMonth() - i);
    labels.push(MS[d.getMonth()] + ' ' + d.getFullYear());
    var v = 0;
    for (var j = 0; j < bonds.length; j++) {
      if (new Date(bonds[j].buyDate || bonds[j].createdAt) <= d) v += calcOne(bonds[j]).invested;
    }
    data.push(v);
  }
  charts.val = new Chart(ctx, {
    type: 'line',
    data: { labels: labels, datasets: [{ data: data, borderColor: '#4e7cff', backgroundColor: 'rgba(78,124,255,0.1)', fill: true, tension: 0.4, pointRadius: 2, borderWidth: 2 }] },
    options: chartOpts(function(v){ return rub(v); }, function(v){ return fmt(v,0); })
  });
}

function updateCouponChart() {
  document.getElementById('couponYearLabel').textContent = couponYear;
  var ctx = document.getElementById('chartCouponIncome');
  if (charts.coup) charts.coup.destroy();
  var md = [0,0,0,0,0,0,0,0,0,0,0,0];
  for (var i = 0; i < bonds.length; i++) {
    var sch = couponSchedule(bonds[i], couponYear);
    for (var j = 0; j < sch.length; j++) md[sch[j].month] += sch[j].amountNet;
  }
  var now = new Date();
  var bg = md.map(function(_, i) {
    if (couponYear < now.getFullYear() || (couponYear === now.getFullYear() && i < now.getMonth())) return 'rgba(52,211,153,0.7)';
    if (couponYear === now.getFullYear() && i === now.getMonth()) return 'rgba(78,124,255,0.7)';
    return 'rgba(78,124,255,0.3)';
  });
  charts.coup = new Chart(ctx, {
    type: 'bar',
    data: { labels: MS, datasets: [{ data: md, backgroundColor: bg, borderRadius: 4, borderSkipped: false }] },
    options: chartOpts(function(v){ return rub(v); }, function(v){ return fmt(v,0); })
  });
}

function chartOpts(tipFn, yFn) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e2130', titleColor: '#e8e9f0', bodyColor: '#9ca0b8', borderColor: '#2d3048', borderWidth: 1, callbacks: { label: function(ctx) { return tipFn(ctx.raw); } } } },
    scales: { x: { grid: { color: 'rgba(45,48,72,0.3)' }, ticks: { color: '#6b6f8a', font: { size: 11 } } }, y: { grid: { color: 'rgba(45,48,72,0.5)' }, ticks: { color: '#6b6f8a', font: { size: 11 }, callback: yFn } } }
  };
}

function renderTopYield() {
  var el = document.getElementById('topYieldList');
  var groups = groupBonds();
  if (!groups.length) { el.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px">Нет данных</div>'; return; }
  groups.sort(function(a,b) { return b.annualPercent - a.annualPercent; });
  var top = groups.slice(0, 15);
  var mx = 1;
  for (var i = 0; i < top.length; i++) mx = Math.max(mx, Math.abs(top[i].annualPercent));
  var html = '<div class="bar-chart-horizontal">';
  for (var j = 0; j < top.length; j++) {
    html += '<div class="bar-row"><div class="bar-label">' + escHtml(top[j].name) + '</div><div class="bar-track"><div class="bar-fill" style="width:' + (Math.abs(top[j].annualPercent)/mx*100).toFixed(1) + '%"></div></div><div class="bar-value">' + fmt(top[j].annualPercent,2) + '%</div></div>';
  }
  el.innerHTML = html + '</div>';
}

function renderMaturities() {
  var el = document.getElementById('upcomingMaturities');
  var groups = groupBonds().filter(function(g) { return g.maturityDate; });
  var list = [];
  for (var i = 0; i < groups.length; i++) {
    var days = daysFromNow(groups[i].maturityDate);
    if (days >= 0) list.push({ g: groups[i], days: days });
  }
  list.sort(function(a,b) { return a.days - b.days; });
  list = list.slice(0, 5);
  if (!list.length) { el.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px">Нет погашений</div>'; return; }
  var html = '';
  for (var j = 0; j < list.length; j++) {
    var u = list[j], dt = new Date(u.g.maturityDate);
    var firstBuy = null;
    for (var k = 0; k < u.g.bonds.length; k++) {
      var bd = u.g.bonds[k].buyDate;
      if (bd && (!firstBuy || bd < firstBuy)) firstBuy = bd;
    }
    var pct = firstBuy ? Math.min(100, daysBetween(firstBuy, new Date()) / daysBetween(firstBuy, u.g.maturityDate) * 100) : 0;
    var badge = u.days <= 90 ? 'badge-yellow' : 'badge-blue';
    html += '<div style="padding:10px 0;border-bottom:1px solid rgba(45,48,72,0.4)"><div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-weight:600;font-size:14px">' + escHtml(u.g.name) + '</div><div style="font-size:12px;color:var(--text-muted)">' + dt.toLocaleDateString('ru-RU') + '</div></div><div style="text-align:right"><div style="font-weight:600">' + rub(u.g.nom * u.g.qty) + '</div><span class="badge ' + badge + '">' + u.days + ' дн.</span></div></div><div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%;background:linear-gradient(90deg,var(--accent-blue),var(--accent-green))"></div></div></div>';
  }
  el.innerHTML = html;
}

// === PORTFOLIO ===
function renderPortfolio() {
  var q = document.getElementById('portfolioSearch').value.toLowerCase();
  var groups = groupBonds().filter(function(g) { return g.name.toLowerCase().indexOf(q) !== -1; });

  if (!sortState.key) {
    groups.sort(function(a, b) {
      return (a.earliestBuyDate || '').localeCompare(b.earliestBuyDate || '');
    });
  }

  if (sortState.key) {
    groups.sort(function(a, b) {
      var va, vb;
      switch(sortState.key) {
        case 'name': return a.name.localeCompare(b.name) * sortState.dir;
        case 'quantity': va = a.qty; vb = b.qty; break;
        case 'buyPrice': va = a.avgPrice; vb = b.avgPrice; break;
        case 'nominalValue': va = a.nom; vb = b.nom; break;
        case 'couponSize': va = a.coup; vb = b.coup; break;
        case 'totalInvested': va = a.invested; vb = b.invested; break;
        case 'annualPercent': va = a.annualPercent; vb = b.annualPercent; break;
        case 'monthlyIncome': va = a.monthlyNet; vb = b.monthlyNet; break;
        case 'totalIncome': va = a.netIncome; vb = b.netIncome; break;
        case 'maturityDate': return (a.maturityDate||'').localeCompare(b.maturityDate||'') * sortState.dir;
        default: va = 0; vb = 0;
      }
      return ((va||0) - (vb||0)) * sortState.dir;
    });
  }

  var tbody = document.getElementById('portfolioBody');
  var empty = document.getElementById('portfolioEmpty');
  if (!groups.length && !bonds.length) { tbody.innerHTML = ''; empty.style.display = ''; return; }
  empty.style.display = 'none';

  var html = '';
  for (var i = 0; i < groups.length; i++) {
    var g = groups[i];
    var dt = g.maturityDate ? new Date(g.maturityDate) : null;
    var days = dt ? daysFromNow(g.maturityDate) : null;
    var firstId = g.bonds[0] ? g.bonds[0].id : '';
    var pctCls = g.annualPercent >= 0 ? 'positive' : 'negative';
    var profCls = g.netIncome >= 0 ? 'positive' : 'negative';
    var isFloat = g.bonds[0] && g.bonds[0].floating;
    var multi = g.bonds.length > 1;
    var uid = 'pg_' + i;

    var sub = '';
    if (isFloat) sub += '<span style="color:var(--accent-cyan);cursor:pointer" onclick="navigateTo(\'floating\')">⚡ плав.</span>';

    // Заголовочная строка группы
    var nameCell;
    if (multi) {
      nameCell = '<div style="display:flex;align-items:center;gap:6px;cursor:pointer" onclick="togglePortGroup(\'' + uid + '\')">' +
        '<span class="floating-arrow" id="arrow_' + uid + '">▶</span>' +
        '<div><div class="ticker">' + escHtml(g.name) + '</div>' +
        '<div style="font-size:11px;color:var(--text-muted)">' + g.bonds.length + ' покупки' + (sub ? ' · ' + sub : '') + '</div></div></div>';
    } else {
      nameCell = '<div class="ticker">' + escHtml(g.name) + '</div>' + (sub ? '<div style="font-size:11px;color:var(--text-muted)">' + sub + '</div>' : '');
    }

    // Кнопки для заглавной строки
    var headerBtns = '<button class="btn btn-secondary btn-sm btn-icon" onclick="duplicateBond(\'' + firstId + '\')" title="Дублировать">📋</button>';
    if (!multi) {
      headerBtns += '<button class="btn btn-secondary btn-sm btn-icon" onclick="editBond(\'' + firstId + '\')" title="Редактировать">✏️</button>' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteBond(\'' + firstId + '\')" title="Удалить">🗑</button>';
    } else {
      headerBtns += '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteGroupByName(this)" data-name="' + escHtml(g.name) + '" title="Удалить все">🗑</button>';
    }

    html += '<tr>' +
      '<td>' + nameCell + '</td>' +
      '<td>' + g.qty + '</td>' +
      '<td>' + rub(g.avgPrice) + '</td>' +
      '<td>' + rub(g.nom) + '</td>' +
      '<td>' + rub(g.coup) + '</td>' +
      '<td>' + rub(g.invested) + '</td>' +
      '<td class="' + pctCls + '">' + fmt(g.annualPercent, 2) + '%</td>' +
      '<td class="positive">' + rub(g.monthlyNet) + '</td>' +
      '<td class="' + profCls + '">' + rub(g.netIncome) + '</td>' +
      '<td><div class="maturity-info"><span class="maturity-date">' + (dt ? dt.toLocaleDateString('ru-RU') : '—') + '</span><span class="maturity-days">' + (days !== null ? days + ' дн.' : '') + '</span></div></td>' +
      '<td>' + headerBtns + '</td></tr>';

    // Развёрнутые подстроки для каждой покупки (скрыты)
    if (multi) {
      for (var j = 0; j < g.bonds.length; j++) {
        var b = g.bonds[j];
        var bm = calcOne(b);
        var bdt = b.buyDate ? new Date(b.buyDate).toLocaleDateString('ru-RU') : '—';
        var bMat = b.maturityDate ? new Date(b.maturityDate).toLocaleDateString('ru-RU') : (dt ? dt.toLocaleDateString('ru-RU') : '—');
        var bPctCls = bm.annualPercent >= 0 ? 'positive' : 'negative';
        var bProfCls = bm.netIncome >= 0 ? 'positive' : 'negative';

        html += '<tr class="port-sub ' + uid + '" style="display:none;background:var(--bg-primary)">' +
          '<td style="padding-left:36px"><span style="color:var(--text-muted);font-size:12px">↳ покупка ' + bdt + '</span></td>' +
          '<td>' + b.quantity + '</td>' +
          '<td>' + rub(b.buyPrice) + '</td>' +
          '<td>' + rub(bm.nom) + '</td>' +
          '<td>' + rub(b.couponSize) + '</td>' +
          '<td>' + rub(bm.invested) + '</td>' +
          '<td class="' + bPctCls + '">' + fmt(bm.annualPercent, 2) + '%</td>' +
          '<td class="positive">' + rub(bm.monthlyNet) + '</td>' +
          '<td class="' + bProfCls + '">' + rub(bm.netIncome) + '</td>' +
          '<td><span style="font-size:12px;color:var(--text-muted)">' + bMat + '</span></td>' +
          '<td>' +
            '<button class="btn btn-secondary btn-sm btn-icon" onclick="editBond(\'' + b.id + '\')" title="Редактировать">✏️</button>' +
            '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteBond(\'' + b.id + '\')" title="Удалить">🗑</button>' +
          '</td></tr>';
      }
    }
  }
  tbody.innerHTML = html;

}

// === CALENDAR ===
function renderCalendar() {
  document.getElementById('calYearLabel').textContent = calendarYear;
  var grid = document.getElementById('calendarGrid');
  var yearTotal = 0;
  var all = [];
  for (var i = 0; i < bonds.length; i++) {
    var sch = couponSchedule(bonds[i], calendarYear);
    for (var j = 0; j < sch.length; j++) all.push(sch[j]);
  }

  var html = '';
  for (var m = 0; m < 12; m++) {
    var paysRaw = all.filter(function(s) { return s.month === m; });
    // Группируем по имени облигации + дате
    var grouped = {};
    for (var p = 0; p < paysRaw.length; p++) {
      var key = paysRaw[p].bondName + '|' + paysRaw[p].date.getTime();
      if (!grouped[key]) {
        grouped[key] = { bondName: paysRaw[p].bondName, date: paysRaw[p].date, amountNet: 0, isPast: paysRaw[p].isPast };
      }
      grouped[key].amountNet += paysRaw[p].amountNet;
    }
    var pays = [];
    for (var k in grouped) pays.push(grouped[k]);
    pays.sort(function(a, b) { return a.date - b.date; });

    var tot = 0;
    for (var q = 0; q < pays.length; q++) tot += pays[q].amountNet;
    yearTotal += tot;
    html += '<div class="calendar-month"><div class="calendar-month-header"><span>' + MN[m] + '</span><span class="month-total">' + (tot > 0 ? '+' + rub(tot) : '—') + '</span></div>';
    if (!pays.length) {
      html += '<div class="calendar-no-payments">Нет выплат</div>';
    } else {
      for (var r2 = 0; r2 < pays.length; r2++) {
        var cls = pays[r2].isPast ? 'pay-past' : '';
        html += '<div class="calendar-payment ' + cls + '"><div><div class="pay-name">' + escHtml(pays[r2].bondName) + '</div><div class="pay-date">' + pays[r2].date.toLocaleDateString('ru-RU') + (pays[r2].isPast ? ' ✓' : '') + '</div></div><div class="pay-amount">+' + rub(pays[r2].amountNet) + '</div></div>';
      }
    }
    html += '</div>';
  }
  grid.innerHTML = html;
  document.getElementById('calYearTotal').textContent = rub(yearTotal);
}

// === ANALYTICS ===
function renderAnalytics() {
  // Coupon by year
  var ctx1 = document.getElementById('chartCouponDynamic');
  if (charts.dyn) charts.dyn.destroy();
  var cy = new Date().getFullYear();
  var yrs = [cy-2, cy-1, cy, cy+1];
  var yData = yrs.map(function(y) {
    var t = 0;
    for (var i = 0; i < bonds.length; i++) {
      var sch = couponSchedule(bonds[i], y);
      for (var j = 0; j < sch.length; j++) t += sch[j].amountNet;
    }
    return t;
  });
  var yBg = yrs.map(function(y) { return y < cy ? 'rgba(52,211,153,0.6)' : y === cy ? 'rgba(78,124,255,0.7)' : 'rgba(78,124,255,0.3)'; });
  charts.dyn = new Chart(ctx1, {
    type: 'bar',
    data: { labels: yrs.map(String), datasets: [{ data: yData, backgroundColor: yBg, borderRadius: 6, borderSkipped: false }] },
    options: chartOpts(function(v){ return rub(v); }, function(v){ return fmt(v,0); })
  });

  // Yield chart
  var ctx2 = document.getElementById('chartYield');
  if (charts.yld) charts.yld.destroy();
  var groups = groupBonds();
  if (!groups.length) {
    charts.yld = new Chart(ctx2, { type: 'bar', data: { labels: [], datasets: [{ data: [] }] }, options: { responsive: true, maintainAspectRatio: false } });
  } else {
    groups.sort(function(a,b) { return b.annualPercent - a.annualPercent; });
    var yLabels = groups.map(function(g) { return g.name; });
    var yVals = groups.map(function(g) { return g.annualPercent; });
    var yColors = groups.map(function(g) { return g.annualPercent >= 12 ? 'rgba(52,211,153,0.7)' : g.annualPercent >= 7 ? 'rgba(78,124,255,0.7)' : 'rgba(248,113,113,0.7)'; });
    charts.yld = new Chart(ctx2, {
      type: 'bar',
      data: { labels: yLabels, datasets: [{ data: yVals, backgroundColor: yColors, borderRadius: 4, borderSkipped: false }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e2130', titleColor: '#e8e9f0', bodyColor: '#9ca0b8', borderColor: '#2d3048', borderWidth: 1, callbacks: { label: function(c) { return c.raw.toFixed(2) + '%'; } } } },
        scales: { x: { grid: { color: 'rgba(45,48,72,0.5)' }, ticks: { color: '#6b6f8a', callback: function(v) { return v + '%'; } } }, y: { grid: { display: false }, ticks: { color: '#9ca0b8', font: { size: 11 } } } }
      }
    });
  }

  // Coupon by bond
  var el = document.getElementById('couponByBond');
  var groups2 = groupBonds();
  if (!groups2.length) { el.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">Нет данных</div>'; return; }
  groups2.sort(function(a,b) { return b.annualNet - a.annualNet; });
  var mx = 1;
  for (var ii = 0; ii < groups2.length; ii++) mx = Math.max(mx, groups2[ii].annualNet);
  var bhtml = '<div class="bar-chart-horizontal">';
  for (var jj = 0; jj < groups2.length; jj++) {
    var dd = groups2[jj];
    bhtml += '<div class="bar-row"><div class="bar-label">' + escHtml(dd.name) + '</div><div class="bar-track"><div class="bar-fill" style="width:' + (dd.annualNet/mx*100).toFixed(1) + '%;background:linear-gradient(90deg,var(--accent-green),var(--accent-cyan))"></div></div><div class="bar-value">' + rub(dd.annualNet) + '</div></div>';
  }
  el.innerHTML = bhtml + '</div>';
}

// === TRANSACTIONS ===
function renderTransactions() {
  var f = document.getElementById('txFilter').value;
  var list = f === 'all' ? transactions.slice() : transactions.filter(function(t) { return t.type === f; });
  list.sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
  var tbody = document.getElementById('txBody');
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px">Нет операций</td></tr>'; return; }
  var html = '';
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    var bond = bonds.find(function(b) { return b.id === t.bondId; });
    var inc = ['coupon','maturity','amortization','sell'].indexOf(t.type) !== -1;
    html += '<tr>' +
      '<td>' + new Date(t.date).toLocaleDateString('ru-RU') + '</td>' +
      '<td><span class="transaction-type"><span class="type-dot type-' + t.type + '"></span>' + (TX_LABELS[t.type]||t.type) + '</span></td>' +
      '<td>' + escHtml(bond ? bond.name : t.bondName || '—') + '</td>' +
      '<td>' + (t.quantity||'—') + '</td>' +
      '<td>' + (t.price ? rub(t.price) : '—') + '</td>' +
      '<td class="' + (inc?'positive':'') + '">' + (inc?'+':'') + rub(t.total) + '</td>' +
      '<td><button class="btn btn-danger btn-sm btn-icon" onclick="deleteTx(\'' + t.id + '\')">🗑</button></td></tr>';
  }
  tbody.innerHTML = html;
}

// === MODALS ===
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function openAddModal() {
  document.getElementById('bondModalTitle').textContent = 'Добавить облигацию';
  document.getElementById('bondEditId').value = '';
  document.getElementById('bondName').value = '';
  document.getElementById('bondNominal').value = '1000';
  document.getElementById('bondQuantity').value = '1';
  document.getElementById('bondBuyPrice').value = '1000';
  document.getElementById('bondCouponSize').value = '35';
  document.getElementById('bondCouponFreq').value = '2';
  document.getElementById('bondNKD').value = '0';
  document.getElementById('bondTaxFree').checked = false;
  document.getElementById('bondFloating').checked = false;
  document.getElementById('bondBuyDate').value = todayStr();
  document.getElementById('bondMaturityDate').value = '';
  document.getElementById('bondPreview').innerHTML = '<span style="color:var(--text-muted)">Укажите даты покупки и погашения</span>';
  openModal('bondModal');
}

function editBond(id) {
  var b = bonds.find(function(x) { return x.id === id; });
  if (!b) return;
  document.getElementById('bondModalTitle').textContent = 'Редактировать';
  document.getElementById('bondEditId').value = id;
  document.getElementById('bondName').value = b.name;
  document.getElementById('bondNominal').value = b.nominalValue;
  document.getElementById('bondQuantity').value = b.quantity;
  document.getElementById('bondBuyPrice').value = b.buyPrice;
  document.getElementById('bondCouponSize').value = b.couponSize;
  document.getElementById('bondCouponFreq').value = b.couponFreq;
  document.getElementById('bondBuyDate').value = b.buyDate || '';
  document.getElementById('bondMaturityDate').value = b.maturityDate || '';
  document.getElementById('bondNKD').value = b.nkd || 0;
  document.getElementById('bondTaxFree').checked = !!b.taxFree;
  document.getElementById('bondFloating').checked = !!b.floating;
  openModal('bondModal');
  updatePreview();
}

function duplicateBond(id) {
  var b = bonds.find(function(x) { return x.id === id; });
  if (!b) return;
  document.getElementById('bondModalTitle').textContent = 'Добавить (копия)';
  document.getElementById('bondEditId').value = '';
  document.getElementById('bondName').value = b.name;
  document.getElementById('bondNominal').value = b.nominalValue;
  document.getElementById('bondQuantity').value = '1';
  document.getElementById('bondBuyPrice').value = b.buyPrice;
  document.getElementById('bondCouponSize').value = b.couponSize;
  document.getElementById('bondCouponFreq').value = b.couponFreq;
  document.getElementById('bondBuyDate').value = todayStr();
  document.getElementById('bondMaturityDate').value = b.maturityDate || '';
  document.getElementById('bondNKD').value = '0';
  document.getElementById('bondTaxFree').checked = !!b.taxFree;
  document.getElementById('bondFloating').checked = !!b.floating;
  openModal('bondModal');
  updatePreview();
}

function saveBond() {
  var name = document.getElementById('bondName').value.trim();
  if (!name) { showToast('Введите название', 'error'); return; }
  var data = {
    name: name,
    nominalValue: parseFloat(document.getElementById('bondNominal').value) || 1000,
    quantity: parseInt(document.getElementById('bondQuantity').value) || 1,
    buyPrice: parseFloat(document.getElementById('bondBuyPrice').value) || 1000,
    couponSize: parseFloat(document.getElementById('bondCouponSize').value) || 0,
    couponFreq: parseInt(document.getElementById('bondCouponFreq').value) || 2,
    buyDate: document.getElementById('bondBuyDate').value,
    maturityDate: document.getElementById('bondMaturityDate').value,
    nkd: parseFloat(document.getElementById('bondNKD').value) || 0,
    taxFree: document.getElementById('bondTaxFree').checked,
    floating: document.getElementById('bondFloating').checked
  };
  var eid = document.getElementById('bondEditId').value;
  if (eid) {
    var idx = bonds.findIndex(function(b) { return b.id === eid; });
    if (idx !== -1) { bonds[idx] = Object.assign({}, bonds[idx], data); showToast('Обновлено', 'success'); }
  } else {
    data.id = genId();
    data.createdAt = new Date().toISOString();
    bonds.push(data);
    var fee = data.buyPrice * data.quantity * (settings.brokerFee / 100);
    transactions.push({ id: genId(), type: 'buy', bondId: data.id, bondName: data.name, date: data.buyDate || todayStr(), quantity: data.quantity, price: data.buyPrice, total: data.buyPrice * data.quantity + fee + (data.nkd || 0) });
    showToast('Облигация добавлена', 'success');
  }
  saveStorage(); closeModal('bondModal'); renderAll();
}

function deleteBond(id) {
  var bond = bonds.find(function(b) { return b.id === id; });
  if (!bond) return;
  document.getElementById('confirmTitle').textContent = 'Удалить';
  document.getElementById('confirmText').textContent = 'Удалить «' + bond.name + '» и все операции?';
  document.getElementById('confirmOkBtn').onclick = function() {
    bonds = bonds.filter(function(b) { return b.id !== id; });
    transactions = transactions.filter(function(t) { return t.bondId !== id; });
    saveStorage(); closeModal('confirmModal'); renderAll(); showToast('Удалено', 'info');
  };
  openModal('confirmModal');
}

function deleteGroupByName(btn) {
  var name = btn.getAttribute('data-name');
  document.getElementById('confirmTitle').textContent = 'Удалить';
  document.getElementById('confirmText').textContent = 'Удалить все покупки «' + name + '» и их операции?';
  document.getElementById('confirmOkBtn').onclick = function() {
    var ids = bonds.filter(function(b) { return b.name === name; }).map(function(b) { return b.id; });
    bonds = bonds.filter(function(b) { return b.name !== name; });
    transactions = transactions.filter(function(t) { return ids.indexOf(t.bondId) === -1; });
    saveStorage(); closeModal('confirmModal'); renderAll(); showToast('Удалено', 'info');
  };
  openModal('confirmModal');
}

// TX
function openTxModal() {
  var sel = document.getElementById('txBond');
  if (bonds.length) {
    sel.innerHTML = bonds.map(function(b) { return '<option value="' + b.id + '">' + escHtml(b.name) + ' (' + (b.buyDate||'') + ')</option>'; }).join('');
  } else {
    sel.innerHTML = '<option value="">Сначала добавьте облигацию</option>';
  }
  document.getElementById('txDate').value = todayStr();
  document.getElementById('txQuantity').value = '1';
  document.getElementById('txPrice').value = '0';
  document.getElementById('txTotal').value = '0';
  document.getElementById('txType').value = 'coupon';
  openModal('txModal');
}

function calcTxTotal() {
  var q = parseFloat(document.getElementById('txQuantity').value) || 0;
  var p = parseFloat(document.getElementById('txPrice').value) || 0;
  document.getElementById('txTotal').value = (q * p).toFixed(2);
}

function saveTx() {
  var bondId = document.getElementById('txBond').value;
  if (!bondId) { showToast('Выберите облигацию', 'error'); return; }
  var bond = bonds.find(function(b) { return b.id === bondId; });
  transactions.push({
    id: genId(), type: document.getElementById('txType').value,
    bondId: bondId, bondName: bond ? bond.name : '',
    date: document.getElementById('txDate').value,
    quantity: parseInt(document.getElementById('txQuantity').value) || 1,
    price: parseFloat(document.getElementById('txPrice').value) || 0,
    total: parseFloat(document.getElementById('txTotal').value) || 0
  });
  saveStorage(); closeModal('txModal'); renderAll(); showToast('Операция добавлена', 'success');
}

function deleteTx(id) {
  transactions = transactions.filter(function(t) { return t.id !== id; });
  saveStorage(); renderTransactions(); showToast('Удалено', 'info');
}

// === Floating Coupons Page ===
function renderFloating() {
  // Показать/скрыть пункт меню
  var hasFloating = bonds.some(function(b) { return b.floating; });
  document.getElementById('navFloating').style.display = hasFloating ? '' : 'none';

  var el = document.getElementById('floatingList');
  if (!el) return;

  // Группируем плавающие по имени
  var groups = {};
  bonds.forEach(function(b) {
    if (!b.floating) return;
    if (!groups[b.name]) groups[b.name] = { name: b.name, bonds: [], totalQty: 0 };
    groups[b.name].bonds.push(b);
    groups[b.name].totalQty += b.quantity || 1;
  });

  var gArr = [];
  for (var k in groups) gArr.push(groups[k]);

  if (!gArr.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">⚡</div><h3>Нет плавающих облигаций</h3><p>Добавьте облигацию с включённым переключателем «Плавающий купон»</p></div>';
    return;
  }

  var html = '';
  for (var i = 0; i < gArr.length; i++) {
    var g = gArr[i];
    var refBond = g.bonds[0];
    var dates = getCouponDates(refBond);
    var m = calcOne(refBond);
    var cm = refBond.couponMap || {};
    var filledCount = 0;
    for (var kk in cm) filledCount++;
    var lastCoup = getCouponForDate(refBond, dates.length > 0 ? dates.length - 1 : 0);
    var uid = 'floating_' + i;

    html += '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-header floating-header" onclick="toggleFloating(\'' + uid + '\')" style="cursor:pointer;user-select:none">' +
        '<div style="display:flex;align-items:center;gap:8px"><span class="floating-arrow" id="arrow_' + uid + '">▶</span><h3 style="margin:0">⚡ ' + escHtml(g.name) + '</h3></div>' +
        '<div style="font-size:13px;color:var(--text-muted)">' + g.totalQty + ' шт · посл. купон ' + rub(lastCoup) + ' · ' + filledCount + '/' + dates.length + ' указано · ' + fmt(m.annualPercent, 2) + '%</div>' +
      '</div>' +
      '<div class="floating-body" id="' + uid + '" style="display:none">' +
        '<div class="card-body"><div class="table-wrapper"><table class="data-table"><thead><tr><th>Дата</th><th>Купон ₽/шт</th><th>Статус</th></tr></thead><tbody>';

    for (var j = 0; j < dates.length; j++) {
      var d = dates[j];
      var isPast = d <= new Date();
      var val = getCouponForDate(refBond, j);
      var isSet = cm[j] !== undefined;
      var statusCls = isSet ? 'badge-green' : (isPast ? 'badge-yellow' : '');
      var statusTxt = isSet ? '✓ Указан' : (isPast ? 'Не указан' : 'Будущий');

      html += '<tr><td>' + d.toLocaleDateString('ru-RU') + '</td>' +
        '<td><input type="number" class="floating-input" value="' + (isSet ? val : '') + '" placeholder="' + fmt(val, 2) + '" step="0.01" min="0" data-bond="' + escHtml(refBond.name) + '" data-idx="' + j + '" onchange="onFloatingInput(this)" onfocus="this.select()"></td>' +
        '<td><span class="badge ' + statusCls + '">' + statusTxt + '</span></td></tr>';
    }

    html += '</tbody></table></div></div></div></div>';
  }
  el.innerHTML = html;
}

function togglePortGroup(uid) {
  var rows = document.querySelectorAll('.' + uid);
  var arrow = document.getElementById('arrow_' + uid);
  var visible = rows.length > 0 && rows[0].style.display !== 'none';
  for (var i = 0; i < rows.length; i++) {
    rows[i].style.display = visible ? 'none' : '';
  }
  if (arrow) arrow.textContent = visible ? '▶' : '▼';
}

function toggleFloating(uid) {
  var body = document.getElementById(uid);
  var arrow = document.getElementById('arrow_' + uid);
  if (body.style.display === 'none') {
    body.style.display = '';
    arrow.textContent = '▼';
  } else {
    body.style.display = 'none';
    arrow.textContent = '▶';
  }
}

function onFloatingInput(input) {
  var bondName = input.getAttribute('data-bond');
  var idx = parseInt(input.getAttribute('data-idx'));
  var val = input.value.trim();

  // Обновляем couponMap для всех облигаций с этим именем
  bonds.forEach(function(b) {
    if (b.name !== bondName || !b.floating) return;
    if (!b.couponMap) b.couponMap = {};
    if (val === '') {
      delete b.couponMap[idx];
    } else {
      b.couponMap[idx] = parseFloat(val) || 0;
    }
  });
  saveStorage();
  renderAll();
}

// === FINANCES ===
function getMonthsList() {
  // От марта 2026 до текущего месяца включительно
  var months = [];
  var start = new Date(2026, 2, 1); // март 2026
  var now = new Date();
  var end = new Date(now.getFullYear(), now.getMonth(), 1); // текущий месяц
  var d = new Date(start);
  while (d <= end) {
    months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}

function getBondsInvestedAtMonth(monthKey) {
  // Сумма invested всех облигаций, купленных до конца этого месяца
  var parts = monthKey.split('-');
  var y = parseInt(parts[0]), m = parseInt(parts[1]);
  var endOfMonth = new Date(y, m, 0, 23, 59, 59); // последний день месяца
  var total = 0;
  bonds.forEach(function(b) {
    if (!b.buyDate) return;
    var buyDate = new Date(b.buyDate);
    if (buyDate <= endOfMonth) {
      total += calcOne(b).invested;
    }
  });
  return total;
}

// Получить значение поля: если заполнено — берём, иначе — из предыдущего месяца
function getFinValue(field, monthIndex, months) {
  for (var i = monthIndex; i >= 0; i--) {
    var fin = finData[months[i]] || {};
    if (fin[field] !== undefined && fin[field] !== 0) return fin[field];
  }
  return 0;
}

function renderFinances() {
  var months = getMonthsList();
  var tbody = document.getElementById('finBody');
  var summaryEl = document.getElementById('finSummary');

  var rows = [];
  var prevTotal = 0;

  for (var i = 0; i < months.length; i++) {
    var key = months[i];
    var fin = finData[key] || {};
    var bondsVal = getBondsInvestedAtMonth(key);
    // Если не заполнено — подтягиваем из предыдущего месяца
    var depositsSet = fin.deposits !== undefined && fin.deposits !== 0;
    var piggySet = fin.piggybank !== undefined && fin.piggybank !== 0;
    var deposits = depositsSet ? fin.deposits : getFinValue('deposits', i - 1, months);
    var piggy = piggySet ? fin.piggybank : getFinValue('piggybank', i - 1, months);
    var total = bondsVal + deposits + piggy;
    var profit = i === 0 ? 0 : total - prevTotal;
    var profitPct = prevTotal > 0 ? (profit / prevTotal * 100) : 0;

    rows.push({
      key: key, bondsVal: bondsVal,
      deposits: deposits, piggy: piggy,
      depositsSet: depositsSet, piggySet: piggySet,
      total: total, profit: profit, profitPct: profitPct
    });
    prevTotal = total;
  }

  // Summary cards
  var lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
  var firstRow = rows.length > 0 ? rows[0] : null;
  var totalGrowthAbs = (lastRow && firstRow) ? lastRow.total - firstRow.total : 0;
  var totalGrowthPct = (firstRow && firstRow.total > 0) ? (totalGrowthAbs / firstRow.total * 100) : 0;

  // Средний прирост в месяц: и в рублях, и в процентах
  var pctSum = 0, pctCount = 0, moneySum = 0, moneyCount = 0;
  for (var p = 1; p < rows.length; p++) {
    moneySum += rows[p].profit;
    moneyCount++;
    if (rows[p - 1].total > 0) {
      pctSum += rows[p].profitPct;
      pctCount++;
    }
  }
  var avgPctMonth = pctCount > 0 ? pctSum / pctCount : 0;
  var avgMoneyMonth = moneyCount > 0 ? moneySum / moneyCount : 0;

  var lastLabel = '';
  if (lastRow) {
    var lp = lastRow.key.split('-');
    lastLabel = MN[parseInt(lp[1]) - 1] + ' ' + lp[0];
  }

  summaryEl.innerHTML =
    '<div class="summary-card"><div class="card-label">Текущий капитал</div><div class="card-value">' + rub(lastRow ? lastRow.total : 0) + '</div><div class="card-sub">На конец ' + lastLabel + '</div></div>' +
    '<div class="summary-card"><div class="card-label">Прирост с марта 2026</div><div class="card-value ' + (totalGrowthAbs >= 0 ? 'positive' : 'negative') + '">' + (totalGrowthAbs >= 0 ? '+' : '') + rub(totalGrowthAbs) + '</div><div class="card-sub">В деньгах</div></div>' +
    '<div class="summary-card"><div class="card-label">Прирост с марта 2026</div><div class="card-value ' + (totalGrowthPct >= 0 ? 'positive' : 'negative') + '">' + (totalGrowthPct >= 0 ? '+' : '') + fmt(totalGrowthPct, 1) + '%</div><div class="card-sub">В процентах</div></div>' +
    '<div class="summary-card"><div class="card-label">Ср. прирост / мес</div><div class="card-value ' + (avgMoneyMonth >= 0 ? 'positive' : 'negative') + '">' + (avgMoneyMonth >= 0 ? '+' : '') + rub(avgMoneyMonth) + '</div><div class="card-sub">Средний в деньгах</div></div>' +
    '<div class="summary-card"><div class="card-label">Ср. прирост / мес</div><div class="card-value ' + (avgPctMonth >= 0 ? 'positive' : 'negative') + '">' + (avgPctMonth >= 0 ? '+' : '') + fmt(avgPctMonth, 2) + '%</div><div class="card-sub">Средний в процентах</div></div>';

  // Table
  var html = '';
  for (var j = 0; j < rows.length; j++) {
    var r2 = rows[j];
    var parts = r2.key.split('-');
    var label = MN[parseInt(parts[1]) - 1] + ' ' + parts[0];
    var profCls = r2.profit > 0 ? 'positive' : (r2.profit < 0 ? 'negative' : '');
    var dynIcon = r2.profit > 0 ? '↑' : (r2.profit < 0 ? '↓' : '→');
    var dynCls = r2.profit > 0 ? 'positive' : (r2.profit < 0 ? 'negative' : '');

    // Показываем в value только если явно задано, иначе пустое (placeholder покажет унаследованное)
    var depRaw = finData[r2.key] && finData[r2.key].deposits ? finData[r2.key].deposits : '';
    var pigRaw = finData[r2.key] && finData[r2.key].piggybank ? finData[r2.key].piggybank : '';

    html += '<tr>' +
      '<td style="font-weight:600">' + label + '</td>' +
      '<td>' + rub(r2.bondsVal) + '</td>' +
      '<td><input type="number" class="floating-input" value="' + depRaw + '" placeholder="' + fmt(r2.deposits, 2) + '" step="0.01" data-month="' + r2.key + '" data-field="deposits" onchange="onFinInput(this)" onfocus="this.select()"></td>' +
      '<td><input type="number" class="floating-input" value="' + pigRaw + '" placeholder="' + fmt(r2.piggy, 2) + '" step="0.01" data-month="' + r2.key + '" data-field="piggybank" onchange="onFinInput(this)" onfocus="this.select()"></td>' +
      '<td style="font-weight:600">' + rub(r2.total) + '</td>' +
      '<td class="' + profCls + '">' + (j > 0 ? (r2.profit >= 0 ? '+' : '') + rub(r2.profit) : '—') + '</td>' +
      '<td class="' + dynCls + '" style="font-weight:600">' + (j > 0 ? dynIcon + ' ' + fmt(r2.profitPct, 1) + '%' : '—') + '</td>' +
    '</tr>';
  }
  tbody.innerHTML = html;

  // Chart
  renderFinChart(rows);
}

function renderFinChart(rows) {
  var ctx = document.getElementById('chartFinances');
  if (charts.fin) charts.fin.destroy();
  if (!rows.length) return;

  var labels = rows.map(function(r) {
    var p = r.key.split('-');
    return MS[parseInt(p[1]) - 1] + ' ' + p[0].slice(2);
  });

  charts.fin = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        { label: 'Итого', data: rows.map(function(r) { return r.total; }), borderColor: '#4e7cff', backgroundColor: 'rgba(78,124,255,0.1)', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 3 },
        { label: 'Облигации', data: rows.map(function(r) { return r.bondsVal; }), borderColor: '#34d399', backgroundColor: 'transparent', tension: 0.3, borderWidth: 2, pointRadius: 2, borderDash: [4, 2] },
        { label: 'Вклады', data: rows.map(function(r) { return r.deposits; }), borderColor: '#fbbf24', backgroundColor: 'transparent', tension: 0.3, borderWidth: 2, pointRadius: 2, borderDash: [4, 2] },
        { label: 'Копилка', data: rows.map(function(r) { return r.piggy; }), borderColor: '#a78bfa', backgroundColor: 'transparent', tension: 0.3, borderWidth: 2, pointRadius: 2, borderDash: [4, 2] }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: '#9ca0b8', font: { size: 12 } } },
        tooltip: { backgroundColor: '#1e2130', titleColor: '#e8e9f0', bodyColor: '#9ca0b8', borderColor: '#2d3048', borderWidth: 1, callbacks: { label: function(c) { return c.dataset.label + ': ' + rub(c.raw); } } }
      },
      scales: {
        x: { grid: { color: 'rgba(45,48,72,0.3)' }, ticks: { color: '#6b6f8a', font: { size: 11 } } },
        y: { grid: { color: 'rgba(45,48,72,0.5)' }, ticks: { color: '#6b6f8a', font: { size: 11 }, callback: function(v) { return fmt(v, 0); } } }
      }
    }
  });
}

function onFinInput(input) {
  var month = input.getAttribute('data-month');
  var field = input.getAttribute('data-field');
  var val = parseFloat(input.value) || 0;

  if (!finData[month]) finData[month] = {};
  finData[month][field] = val;
  saveStorage();
  renderFinances();
}

// === CLOUD SYNC ===
function getSyncUrl() {
  var url = document.getElementById('settingsSyncUrl').value.trim();
  if (url) {
    settings.syncUrl = url;
    saveStorage();
  }
  return settings.syncUrl || '';
}

function cloudSave() {
  var url = getSyncUrl();
  if (!url) { showToast('Укажите URL Google Apps Script', 'error'); return; }

  var btn = document.getElementById('cloudSaveBtn');
  btn.textContent = '⏳ Сохраняю...';
  btn.disabled = true;

  var now = new Date().toISOString();
  settings.lastSaved = now;
  saveStorageLocal();

  var payload = {
    action: 'save',
    data: {
      bonds: bonds,
      transactions: transactions,
      settings: settings,
      finData: finData,
      savedAt: now
    }
  };

  cloudPostViaForm(url, payload)
  .then(function() {
    btn.textContent = '☁️ Сохранить';
    btn.disabled = false;
    showToast('Данные отправлены в облако', 'success');
  })
  .catch(function(err) {
    btn.textContent = '☁️ Сохранить';
    btn.disabled = false;
    showToast('Ошибка: ' + err.message, 'error');
  });
}

function cloudLoad() {
  var url = getSyncUrl();
  if (!url) { showToast('Укажите URL Google Apps Script', 'error'); return; }

  var btn = document.getElementById('cloudLoadBtn');
  btn.textContent = '⏳ Загружаю...';
  btn.disabled = true;

  cloudGet(url)
  .then(function(res) {
    btn.textContent = '☁️ Загрузить';
    btn.disabled = false;
    if (res.status === 'ok' && res.data) {
      var d = res.data;
      var syncUrl = settings.syncUrl;
      if (d.bonds) bonds = d.bonds;
      if (d.transactions) transactions = d.transactions;
      if (d.settings) settings = Object.assign({}, settings, d.settings);
      if (d.finData) finData = d.finData;
      settings.syncUrl = syncUrl;
      saveStorageLocal();
      loadStorage();
      renderAll();
      showToast('Данные загружены из облака', 'success');
    } else {
      showToast('В облаке нет данных', 'info');
    }
  })
  .catch(function(err) {
    btn.textContent = '☁️ Загрузить';
    btn.disabled = false;
    showToast('Ошибка сети: ' + err.message, 'error');
  });
}

function exportData() {
  var data = {
    bonds: bonds,
    transactions: transactions,
    settings: settings,
    finData: finData,
    exportDate: new Date().toISOString()
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'bondtracker-' + todayStr() + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Данные выгружены', 'success');
}

function importData(input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      if (data.bonds) bonds = data.bonds;
      if (data.transactions) transactions = data.transactions;
      if (data.settings) settings = Object.assign({}, settings, data.settings);
      if (data.finData) finData = data.finData;
      saveStorage();
      loadStorage();
      renderAll();
      showToast('Данные загружены', 'success');
    } catch(err) {
      showToast('Ошибка: неверный формат файла', 'error');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

function clearAllData() {
  document.getElementById('confirmTitle').textContent = 'Очистить все данные';
  document.getElementById('confirmText').textContent = 'Все облигации и транзакции будут удалены безвозвратно.';
  document.getElementById('confirmOkBtn').onclick = function() {
    bonds = []; transactions = []; finData = {}; saveStorage(); closeModal('confirmModal'); renderAll(); showToast('Очищено', 'info');
  };
  openModal('confirmModal');
}

function showToast(msg, type) {
  type = type || 'info';
  var c = document.getElementById('toastContainer');
  var t = document.createElement('div');
  t.className = 'toast ' + type;
  var icons = { success: '✅', error: '❌', info: 'ℹ️' };
  t.innerHTML = '<span>' + (icons[type]||'') + '</span><span>' + msg + '</span>';
  c.appendChild(t);
  setTimeout(function() {
    t.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(function() { t.remove(); }, 300);
  }, 3000);
}
