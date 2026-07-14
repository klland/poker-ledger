(function () {
  'use strict';

  const STORAGE_KEY = 'poker-ledger-v1';
  const CLUBS = {
    flush: { name: '花順', rate: 1, suit: '♠' },
    malay: { name: '馬來', rate: 8, suit: '♦' }
  };
  const emptyClub = () => ({ balance: 0, deposits: 0, withdrawals: 0, events: [], settlements: [] });
  const initialState = () => ({ version: 1, activeClub: 'flush', clubs: { flush: emptyClub(), malay: emptyClub() } });
  let state = loadState();
  let period = 'week';
  let statsClub = 'all';
  let historyFilter = 'all';
  let toastTimer;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const formatNumber = (n) => Math.round(Number(n) || 0).toLocaleString('zh-TW');
  const formatMoney = (n, signed = false) => {
    const value = Math.round(Number(n) || 0);
    const prefix = signed && value > 0 ? '+' : value < 0 ? '−' : '';
    return `${prefix}NT$${formatNumber(Math.abs(value))}`;
  };
  const toInt = (value) => Math.max(0, Math.round(Number(String(value).replace(/,/g, '')) || 0));
  const dayKey = (date) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const recordTime = (record) => new Date(record.timestamp).getTime() || 0;
  const createdTime = (record) => new Date(record.createdAt || record.timestamp).getTime() || recordTime(record);
  const compareRecords = (a, b) => recordTime(a) - recordTime(b) || createdTime(a) - createdTime(b);
  const toDateTimeInput = (date = new Date()) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 19);
  };
  const toTimestamp = (value) => new Date(value).toISOString();

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved?.clubs?.flush || !saved?.clubs?.malay) return initialState();
      return saved;
    } catch (_) { return initialState(); }
  }
  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function currentClub() { return state.clubs[state.activeClub]; }
  function clubMeta(key = state.activeClub) { return CLUBS[key]; }
  function totalPnl(key) {
    const club = state.clubs[key];
    const rate = CLUBS[key].rate;
    return (club.balance * rate) + club.withdrawals - club.deposits;
  }
  function recalculateClub(key) {
    const club = state.clubs[key];
    const rate = CLUBS[key].rate;
    club.events.sort(compareRecords);
    club.settlements.sort(compareRecords);
    club.deposits = club.events.filter((event) => event.type === 'deposit').reduce((sum, event) => sum + event.chips * rate, 0);
    club.withdrawals = club.events.filter((event) => event.type === 'withdrawal').reduce((sum, event) => sum + event.chips * rate, 0);

    let eventIndex = 0;
    let previousClose = 0;
    club.settlements.forEach((settlement) => {
      let deposits = 0;
      let withdrawals = 0;
      while (eventIndex < club.events.length && compareRecords(club.events[eventIndex], settlement) <= 0) {
        const event = club.events[eventIndex];
        if (event.type === 'deposit') deposits += event.chips;
        if (event.type === 'withdrawal') withdrawals += event.chips;
        eventIndex += 1;
      }
      settlement.depositsChips = deposits;
      settlement.withdrawalsChips = withdrawals;
      settlement.pnlChips = settlement.endBalance + withdrawals - previousClose - deposits;
      settlement.pnlCash = settlement.pnlChips * rate;
      settlement.eventCount = eventIndex;
      previousClose = settlement.endBalance;
    });

    let balance = club.settlements.length ? club.settlements.at(-1).endBalance : 0;
    while (eventIndex < club.events.length) {
      const event = club.events[eventIndex];
      balance += event.type === 'deposit' ? event.chips : -event.chips;
      eventIndex += 1;
    }
    club.balance = balance;
  }
  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }
  function signedClass(n) { return n > 0 ? 'positive' : n < 0 ? 'negative' : 'neutral'; }
  function formatDateTime(timestamp) {
    return new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp));
  }

  function renderHome() {
    const key = state.activeClub;
    const isCombined = key === 'all';
    $$('.club-tab').forEach((tab) => {
      const active = tab.dataset.club === key;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active);
    });
    $('#quickActions').hidden = isCombined;
    $('#combinedActions').hidden = !isCombined;
    $('#combinedBreakdown').hidden = !isCombined;
    $('#valueLine').hidden = isCombined;
    $('.balance-card').classList.toggle('combined-mode', isCombined);

    if (isCombined) {
      const flush = state.clubs.flush;
      const malay = state.clubs.malay;
      const flushValue = flush.balance * CLUBS.flush.rate;
      const malayValue = malay.balance * CLUBS.malay.rate;
      const pnl = totalPnl('flush') + totalPnl('malay');
      $('#activeClubLabel').textContent = '兩館合計帳戶';
      $('#activeRateLabel').textContent = '統一換算台幣';
      $('#balanceLabel').textContent = '目前籌碼總價值';
      $('#chipBalance').textContent = formatMoney(flushValue + malayValue);
      $('#balanceUnit').textContent = '台幣';
      $('#combinedFlushValue').textContent = `${formatNumber(flush.balance)} 籌碼 · ${formatMoney(flushValue)}`;
      $('#combinedMalayValue').textContent = `${formatNumber(malay.balance)} 籌碼 · ${formatMoney(malayValue)}`;
      $('#totalProfit').textContent = formatMoney(pnl, true);
      $('#profitStamp').className = `profit-stamp ${signedClass(pnl)}`;
      $('#totalDeposits').textContent = formatMoney(flush.deposits + malay.deposits);
      $('#totalWithdrawals').textContent = formatMoney(flush.withdrawals + malay.withdrawals);
      $('#settlementCount').textContent = formatNumber(flush.settlements.length + malay.settlements.length);
      renderRecent();
      return;
    }

    const club = currentClub();
    const meta = clubMeta();
    const pnl = totalPnl(key);
    $('#activeClubLabel').textContent = `${meta.name}俱樂部`;
    $('#activeRateLabel').textContent = `1 籌碼 = NT$${meta.rate}`;
    $('#balanceLabel').textContent = '目前持有籌碼';
    $('#chipBalance').textContent = formatNumber(club.balance);
    $('#balanceUnit').textContent = '籌碼';
    $('#chipValue').textContent = formatMoney(club.balance * meta.rate);
    $('#totalProfit').textContent = formatMoney(pnl, true);
    $('#profitStamp').className = `profit-stamp ${signedClass(pnl)}`;
    $('#totalDeposits').textContent = formatMoney(club.deposits);
    $('#totalWithdrawals').textContent = formatMoney(club.withdrawals);
    $('#settlementCount').textContent = formatNumber(club.settlements.length);
    renderRecent();
  }

  function allLedgerItems() {
    const items = [];
    Object.entries(state.clubs).forEach(([key, club]) => {
      club.events.forEach((event) => items.push({ ...event, clubKey: key }));
      club.settlements.forEach((settlement) => items.push({ ...settlement, type: 'settlement', clubKey: key }));
    });
    return items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }
  function ledgerRow(item) {
    const meta = CLUBS[item.clubKey];
    const isSettle = item.type === 'settlement';
    const isDeposit = item.type === 'deposit';
    const value = isSettle ? item.pnlCash : item.cash;
    const title = isSettle ? (value > 0 ? '牌局獲利' : value < 0 ? '牌局虧損' : '牌局平手') : isDeposit ? '新增籌碼' : '領出籌碼';
    const icon = isSettle ? (value >= 0 ? '✓' : '↓') : isDeposit ? '+' : '↗';
    const valueText = isSettle ? formatMoney(value, true) : `${isDeposit ? '+' : '−'}${formatNumber(item.chips)} 籌碼`;
    const subText = isSettle ? `${value >= 0 ? '+' : '−'}${formatNumber(Math.abs(item.pnlChips))} 籌碼` : formatMoney(item.cash);
    const loss = isSettle && value < 0 ? ' loss' : '';
    return `<article class="ledger-row ${item.type}${loss}">
      <span class="ledger-icon">${icon}</span>
      <div class="ledger-main"><strong>${meta.suit} ${meta.name} · ${title}</strong><small>${formatDateTime(item.timestamp)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small></div>
      <div class="ledger-value ${isSettle ? signedClass(value) : ''}"><strong>${valueText}</strong><small>${subText}</small></div>
    </article>`;
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }
  function renderRecent() {
    const items = allLedgerItems().filter((item) => state.activeClub === 'all' || item.clubKey === state.activeClub).slice(0, 4);
    $('#recentEmpty').hidden = items.length > 0;
    $('#recentList').innerHTML = items.map(ledgerRow).join('');
  }

  function renderHistory() {
    let items = allLedgerItems();
    if (historyFilter !== 'all') items = items.filter((item) => item.type === historyFilter);
    $('#historyList').innerHTML = items.length ? items.map(ledgerRow).join('') : '<div class="empty-state"><span>♣</span><p>沒有符合的紀錄</p><small>完成操作後會顯示在這裡。</small></div>';
  }

  function periodStart() {
    const now = new Date();
    if (period === 'all') return new Date(0);
    if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - weekday);
    return start;
  }
  function filteredDailyResults() {
    const start = periodStart();
    const grouped = {};
    Object.entries(state.clubs).forEach(([key, club]) => {
      if (statsClub !== 'all' && statsClub !== key) return;
      club.settlements.forEach((s) => {
        if (new Date(s.timestamp) < start) return;
        const date = dayKey(s.timestamp);
        if (!grouped[date]) grouped[date] = { date, cash: 0, flush: 0, malay: 0 };
        grouped[date].cash += s.pnlCash;
        grouped[date][key] += s.pnlCash;
      });
    });
    return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
  }
  function renderStats() {
    const days = filteredDailyResults();
    const total = days.reduce((sum, day) => sum + day.cash, 0);
    const wins = days.filter((day) => day.cash > 0).length;
    const best = days.length ? days.reduce((a, b) => b.cash > a.cash ? b : a) : null;
    const avg = days.length ? total / days.length : null;
    $('#periodProfit').textContent = formatMoney(total, true);
    $('#periodProfit').className = signedClass(total);
    $('#periodSubline').textContent = days.length ? `共 ${days.length} 個結算日` : '尚無結算';
    $('#winRate').textContent = days.length ? `${Math.round((wins / days.length) * 100)}%` : '—';
    $('#winRecord').textContent = `${wins} 勝 / ${days.length} 天`;
    $('#bestDay').textContent = best ? formatMoney(best.cash, true) : '—';
    $('#bestDayDate').textContent = best ? best.date.replaceAll('-', '/') : '尚無資料';
    $('#avgDay').textContent = avg === null ? '—' : formatMoney(avg, true);
    $('#chartTotal').textContent = formatMoney(total, true);
    renderChart(days);
    renderBreakdown();
  }
  function renderChart(days) {
    const svg = $('#profitChart');
    if (!days.length) {
      svg.innerHTML = '<text x="180" y="92" text-anchor="middle" class="chart-label">完成每日結算後，走勢會顯示在這裡</text>';
      return;
    }
    let running = 0;
    const values = days.map((day) => ({ ...day, running: (running += day.cash) }));
    const data = values.length === 1 ? [{ ...values[0], date: '' , running: 0 }, values[0]] : values;
    const min = Math.min(0, ...data.map((d) => d.running));
    const max = Math.max(0, ...data.map((d) => d.running));
    const range = max - min || 1;
    const left = 18, right = 342, top = 15, bottom = 160;
    const x = (i) => left + (i / Math.max(1, data.length - 1)) * (right - left);
    const y = (v) => bottom - ((v - min) / range) * (bottom - top);
    const points = data.map((d, i) => `${x(i)},${y(d.running)}`).join(' ');
    const area = `${left},${bottom} ${points} ${right},${bottom}`;
    const labelIndexes = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];
    svg.innerHTML = `<defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#23725b" stop-opacity=".25"/><stop offset="1" stop-color="#23725b" stop-opacity="0"/></linearGradient></defs>
      <line x1="${left}" y1="${y(0)}" x2="${right}" y2="${y(0)}" class="chart-grid" />
      <line x1="${left}" y1="${top + (bottom-top)/2}" x2="${right}" y2="${top + (bottom-top)/2}" class="chart-grid" />
      <polygon points="${area}" class="chart-area" />
      <polyline points="${points}" class="chart-line" />
      ${data.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.running)}" r="3" class="chart-dot" />`).join('')}
      ${labelIndexes.map((i) => `<text x="${x(i)}" y="181" text-anchor="${i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}" class="chart-label">${data[i].date ? data[i].date.slice(5).replace('-', '/') : ''}</text>`).join('')}`;
  }
  function renderBreakdown() {
    const start = periodStart();
    const totals = { flush: 0, malay: 0 };
    Object.entries(state.clubs).forEach(([key, club]) => club.settlements.forEach((s) => { if (new Date(s.timestamp) >= start) totals[key] += s.pnlCash; }));
    const max = Math.max(1, ...Object.values(totals).map(Math.abs));
    $('#clubBreakdown').innerHTML = Object.keys(CLUBS).map((key) => `<div class="breakdown-row"><div class="breakdown-label"><span>${CLUBS[key].suit} ${CLUBS[key].name}</span><strong class="${signedClass(totals[key])}">${formatMoney(totals[key], true)}</strong></div><div class="breakdown-track"><div class="breakdown-fill ${totals[key] < 0 ? 'negative' : ''}" style="width:${Math.max(2, Math.abs(totals[key]) / max * 100)}%"></div></div></div>`).join('');
  }

  function renderAll() { renderHome(); renderHistory(); renderStats(); }

  function openDialog(id) {
    const dialog = document.getElementById(id);
    if (id === 'settingsDialog') {
      dialog.showModal();
      return;
    }
    if (state.activeClub === 'all') {
      showToast('請先選擇花順或馬來俱樂部');
      return;
    }
    const club = currentClub();
    const meta = clubMeta();
    const nowValue = toDateTimeInput();
    if (id === 'depositDialog') {
      $('#depositForm').reset(); $('#depositForm [name="timestamp"]').value = nowValue; $('#depositPreview').textContent = 'NT$0';
    } else if (id === 'withdrawDialog') {
      $('#withdrawForm').reset(); $('#withdrawForm [name="timestamp"]').value = nowValue; $('#availableChips').textContent = `目前可領出 ${formatNumber(club.balance)} 籌碼`; $('#withdrawPreview').textContent = 'NT$0';
    } else if (id === 'settleDialog') {
      $('#settleForm').reset(); $('#settleForm [name="timestamp"]').value = nowValue; $('#settleForm [name="chips"]').value = club.balance; $('#bookBalance').textContent = formatNumber(club.balance); updateSettlePreview();
    }
    dialog.dataset.rate = meta.rate;
    dialog.showModal();
    setTimeout(() => $('input[name="chips"]', dialog)?.focus(), 180);
  }

  function addDeposit(chips, note, timestamp) {
    const club = currentClub(), cash = chips * clubMeta().rate;
    club.events.push({ id: uid(), type: 'deposit', chips, cash, note, timestamp, createdAt: new Date().toISOString() });
    recalculateClub(state.activeClub);
    saveState(); renderAll(); showToast(`已新增 ${formatNumber(chips)} 籌碼`);
  }
  function addWithdrawal(chips, note, timestamp) {
    const club = currentClub();
    const cash = chips * clubMeta().rate;
    const event = { id: uid(), type: 'withdrawal', chips, cash, note, timestamp, createdAt: new Date().toISOString() };
    club.events.push(event);
    recalculateClub(state.activeClub);
    if (club.balance < 0) {
      club.events = club.events.filter((item) => item.id !== event.id);
      recalculateClub(state.activeClub);
      return showToast('這筆領出會讓目前籌碼變成負數'), false;
    }
    saveState(); renderAll(); showToast(`已領出 ${formatMoney(cash)}`); return true;
  }
  function estimateSettlement(endBalance, timestamp) {
    const club = currentClub();
    const candidate = { timestamp: timestamp || new Date().toISOString(), createdAt: new Date().toISOString() };
    const last = [...club.settlements].filter((settlement) => compareRecords(settlement, candidate) < 0).sort(compareRecords).at(-1);
    const previousClose = last ? last.endBalance : 0;
    const flows = club.events.filter((event) => (!last || compareRecords(event, last) > 0) && compareRecords(event, candidate) <= 0).reduce((acc, event) => {
      if (event.type === 'deposit') acc.deposits += event.chips;
      if (event.type === 'withdrawal') acc.withdrawals += event.chips;
      return acc;
    }, { deposits: 0, withdrawals: 0 });
    const pnlChips = endBalance + flows.withdrawals - previousClose - flows.deposits;
    return { previousClose, flows, pnlChips, pnlCash: pnlChips * clubMeta().rate };
  }
  function addSettlement(endBalance, note, timestamp) {
    const club = currentClub();
    const settlement = { id: uid(), timestamp, endBalance, note, createdAt: new Date().toISOString() };
    club.settlements.push(settlement);
    recalculateClub(state.activeClub);
    saveState(); renderAll(); showToast(`本次結算：${formatMoney(settlement.pnlCash, true)}`);
  }
  function updateSettlePreview() {
    const chips = toInt($('#settleForm [name="chips"]').value);
    const timestampValue = $('#settleForm [name="timestamp"]').value;
    const result = estimateSettlement(chips, timestampValue ? toTimestamp(timestampValue) : new Date().toISOString());
    $('#bookBalance').textContent = formatNumber(result.previousClose + result.flows.deposits - result.flows.withdrawals);
    const box = $('#settleResultPreview');
    box.className = `result-preview ${signedClass(result.pnlCash)}`;
    $('strong', box).textContent = formatMoney(result.pnlCash, true);
    $('small', box).textContent = `${result.pnlChips > 0 ? '+' : result.pnlChips < 0 ? '−' : ''}${formatNumber(Math.abs(result.pnlChips))} 籌碼`;
  }

  function navigate(view) {
    $$('.view').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
    $$('.bottom-nav button').forEach((el) => el.classList.toggle('active', el.dataset.nav === view));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (view === 'stats') renderStats();
    if (view === 'history') renderHistory();
  }

  $$('.club-tab').forEach((button) => button.addEventListener('click', () => { state.activeClub = button.dataset.club; saveState(); renderHome(); }));
  $$('[data-select-club]').forEach((button) => button.addEventListener('click', () => { state.activeClub = button.dataset.selectClub; saveState(); renderHome(); }));
  $$('[data-open]').forEach((button) => button.addEventListener('click', () => openDialog(button.dataset.open)));
  $('#settingsButton').addEventListener('click', () => openDialog('settingsDialog'));
  $$('.bottom-nav button').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.nav)));
  $$('[data-nav-target]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.navTarget)));
  $('#depositForm [name="chips"]').addEventListener('input', (e) => $('#depositPreview').textContent = formatMoney(toInt(e.target.value) * clubMeta().rate));
  $('#withdrawForm [name="chips"]').addEventListener('input', (e) => $('#withdrawPreview').textContent = formatMoney(toInt(e.target.value) * clubMeta().rate));
  $('#settleForm [name="chips"]').addEventListener('input', updateSettlePreview);
  $('#settleForm [name="timestamp"]').addEventListener('input', updateSettlePreview);
  $('#depositForm').addEventListener('submit', (e) => { e.preventDefault(); const data = new FormData(e.currentTarget), chips = toInt(data.get('chips')); if (!chips) return showToast('請輸入新增籌碼量'); addDeposit(chips, data.get('note').trim(), toTimestamp(data.get('timestamp'))); $('#depositDialog').close(); });
  $('#withdrawForm').addEventListener('submit', (e) => { e.preventDefault(); const data = new FormData(e.currentTarget), chips = toInt(data.get('chips')); if (!chips) return showToast('請輸入領出籌碼量'); if (addWithdrawal(chips, data.get('note').trim(), toTimestamp(data.get('timestamp')))) $('#withdrawDialog').close(); });
  $('#settleForm').addEventListener('submit', (e) => { e.preventDefault(); const data = new FormData(e.currentTarget); addSettlement(toInt(data.get('chips')), data.get('note').trim(), toTimestamp(data.get('timestamp'))); $('#settleDialog').close(); });
  $('#periodTabs').addEventListener('click', (e) => { const button = e.target.closest('button'); if (!button) return; period = button.dataset.period; $$('#periodTabs button').forEach((b) => b.classList.toggle('active', b === button)); renderStats(); });
  $('.stats-club-filter').addEventListener('click', (e) => { const button = e.target.closest('button'); if (!button) return; statsClub = button.dataset.statsClub; $$('.stats-club-filter button').forEach((b) => b.classList.toggle('active', b === button)); renderStats(); });
  $('#historyFilters').addEventListener('click', (e) => { const button = e.target.closest('button'); if (!button) return; historyFilter = button.dataset.historyFilter; $$('#historyFilters button').forEach((b) => b.classList.toggle('active', b === button)); renderHistory(); });
  $$('.sheet').forEach((dialog) => dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }));

  $('#exportButton').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `牌桌帳房備份-${dayKey(new Date())}.json`; link.click(); URL.revokeObjectURL(link.href); showToast('備份檔已匯出');
  });
  $('#importInput').addEventListener('change', async (e) => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (!data?.clubs?.flush || !data?.clubs?.malay) throw new Error('invalid');
      state = data; Object.keys(CLUBS).forEach(recalculateClub); saveState(); renderAll(); $('#settingsDialog').close(); showToast('備份已成功匯入');
    } catch (_) { showToast('無法讀取這個備份檔'); }
    e.target.value = '';
  });
  $('#resetButton').addEventListener('click', () => {
    if (!window.confirm('確定要清除所有籌碼與結算紀錄嗎？此動作無法復原。')) return;
    state = initialState(); saveState(); renderAll(); $('#settingsDialog').close(); showToast('所有資料已清除');
  });

  $('#todayLabel').textContent = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
  Object.keys(CLUBS).forEach(recalculateClub);
  saveState();
  renderAll();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
})();
