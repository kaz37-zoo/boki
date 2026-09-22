(() => {
  'use strict';

  const STORAGE_KEY = 'boki-reflex-quiz-v2';
  const classes = ['資産', '負債', '純資産', '収益', '費用'];
  const increaseSide = { '資産': '借方', '負債': '貸方', '純資産': '貸方', '収益': '貸方', '費用': '借方' };
  const accounts = [
    ['現金','資産'], ['当座預金','資産'], ['普通預金','資産'], ['定期預金','資産'], ['小口現金','資産'],
    ['売掛金','資産'], ['受取手形','資産'], ['電子記録債権','資産'], ['未収入金','資産'], ['貸付金','資産'],
    ['立替金','資産'], ['仮払金','資産'], ['前払金','資産'], ['前払費用','資産'], ['未収収益','資産'],
    ['繰越商品','資産'], ['貯蔵品','資産'], ['建物','資産'], ['備品','資産'], ['車両運搬具','資産'],
    ['土地','資産'], ['差入保証金','資産'],
    ['買掛金','負債'], ['支払手形','負債'], ['電子記録債務','負債'], ['未払金','負債'], ['借入金','負債'],
    ['預り金','負債'], ['仮受金','負債'], ['前受金','負債'], ['未払費用','負債'], ['前受収益','負債'],
    ['当座借越','負債'], ['商品券','負債'],
    ['資本金','純資産'], ['利益準備金','純資産'], ['繰越利益剰余金','純資産'],
    ['売上','収益'], ['受取利息','収益'], ['受取手数料','収益'], ['受取家賃','収益'], ['雑益','収益'],
    ['固定資産売却益','収益'], ['償却債権取立益','収益'],
    ['仕入','費用'], ['給料','費用'], ['法定福利費','費用'], ['広告宣伝費','費用'], ['発送費','費用'],
    ['旅費交通費','費用'], ['通信費','費用'], ['消耗品費','費用'], ['水道光熱費','費用'], ['支払家賃','費用'],
    ['支払地代','費用'], ['租税公課','費用'], ['保険料','費用'], ['支払利息','費用'], ['雑費','費用'],
    ['貸倒損失','費用'], ['減価償却費','費用'], ['固定資産売却損','費用']
  ].map(([name, cls]) => ({ name, cls }));

  const questionBank = accounts.flatMap(account => [
    { id: `c:${account.name}`, type: 'classify', account },
    { id: `s:${account.name}:inc`, type: 'side', account, direction: '増加' },
    { id: `s:${account.name}:dec`, type: 'side', account, direction: '減少' }
  ]);

  const defaultState = () => ({ history: {}, confidence: {}, settings: { showCategory: true, timeLimit: 0 } });
  let state = loadState();
  let mode = 'mixed';
  let reviewFilter = null;
  let current = null;
  let lastQuestionId = null;
  let answered = false;
  let rated = false;
  let session = { correct: 0, total: 0, streak: 0 };
  let timerId = null;
  let timerDeadline = 0;
  let activeTab = 'quiz';
  let swipeStart = null;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const els = {
    questionType: $('#questionType'), questionCount: $('#questionCount'), questionText: $('#questionText'),
    answerGrid: $('#answerGrid'), feedback: $('#feedback'), feedbackIcon: $('#feedbackIcon'),
    feedbackTitle: $('#feedbackTitle'), feedbackText: $('#feedbackText'), nextButton: $('#nextButton'),
    sessionScore: $('#sessionScore'), sessionStreak: $('#sessionStreak'), reviewBadge: $('#reviewBadge'),
    unsureCount: $('#unsureCount'), revisitCount: $('#revisitCount'), reviewEmpty: $('#reviewEmpty'),
    startWeakReview: $('#startWeakReview'), clearReview: $('#clearReview'), headerToday: $('#headerToday'),
    todayCorrect: $('#todayCorrect'), todayRate: $('#todayRate'), todayTotal: $('#todayTotal'),
    studyDays: $('#studyDays'), historyList: $('#historyList'), trendChart: $('#trendChart'),
    confirmDialog: $('#confirmDialog'), questionCard: $('#questionCard'), categoryToggle: $('#categoryToggle'),
    timerRange: $('#timerRange'), timerValue: $('#timerValue'), countdown: $('#countdown'),
    countdownValue: $('#countdownValue'), timerTrack: $('#timerTrack'), timerFill: $('#timerFill'),
    entryLabel: $('#entryLabel'), entryValue: $('#entryValue'), mainContent: $('#mainContent')
  };

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || !parsed.history || !parsed.confidence) return defaultState();
      const defaults = defaultState();
      return { ...defaults, ...parsed, settings: { ...defaults.settings, ...(parsed.settings || {}) } };
    } catch (_) { return defaultState(); }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* Storage may be unavailable. */ }
    refreshSummaries();
  }

  function localDate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function sideFor(cls, direction) {
    const side = increaseSide[cls];
    return direction === '増加' ? side : (side === '借方' ? '貸方' : '借方');
  }

  function timerLabel(seconds) {
    return seconds ? `${seconds}秒` : 'なし';
  }

  function stopTimer() {
    if (timerId) window.clearInterval(timerId);
    timerId = null;
  }

  function startTimer() {
    stopTimer();
    const seconds = Number(state.settings.timeLimit) || 0;
    const enabled = seconds > 0 && !answered && activeTab === 'quiz';
    els.countdown.hidden = !enabled;
    els.timerTrack.hidden = !enabled;
    els.countdown.classList.remove('is-urgent');
    els.timerFill.classList.remove('is-urgent');
    els.timerFill.style.width = '100%';
    if (!enabled) return;
    timerDeadline = Date.now() + seconds * 1000;
    const update = () => {
      const remainingMs = Math.max(0, timerDeadline - Date.now());
      const remaining = Math.ceil(remainingMs / 1000);
      els.countdownValue.textContent = String(remaining);
      els.timerFill.style.width = `${remainingMs / (seconds * 1000) * 100}%`;
      const urgent = remainingMs <= 5000;
      els.countdown.classList.toggle('is-urgent', urgent);
      els.timerFill.classList.toggle('is-urgent', urgent);
      if (remainingMs <= 0) {
        stopTimer();
        answerQuestion(null, false, true);
      }
    };
    update();
    timerId = window.setInterval(update, 100);
  }

  function renderQuestionText() {
    if (!current) return;
    if (current.type === 'classify') {
      els.questionText.textContent = `「${current.account.name}」はどのグループ？`;
      return;
    }
    const hint = state.settings.showCategory ? `（${current.account.cls}）` : '';
    els.questionText.textContent = `「${current.account.name}${hint}」が${current.direction}した。記入するのは？`;
  }

  function eligibleQuestions() {
    if (reviewFilter) {
      const accepted = reviewFilter === 'weak' ? ['unsure', 'review'] : [reviewFilter];
      return questionBank.filter(q => accepted.includes(state.confidence[q.id]));
    }
    if (mode === 'mixed') return questionBank;
    return questionBank.filter(q => q.type === mode);
  }

  function pickQuestion() {
    const pool = eligibleQuestions();
    if (!pool.length) return null;
    const candidates = pool.length > 1 ? pool.filter(q => q.id !== lastQuestionId) : pool;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function renderQuestion() {
    current = pickQuestion();
    if (!current) {
      reviewFilter = null;
      switchTab('review');
      return;
    }
    lastQuestionId = current.id;
    answered = false;
    rated = false;
    els.questionCard.classList.remove('is-answered');
    els.feedback.hidden = true;
    els.nextButton.hidden = true;
    $$('.confidence-buttons button').forEach(button => button.classList.remove('is-selected'));
    els.answerGrid.innerHTML = '';
    els.answerGrid.classList.toggle('two-options', current.type === 'side');
    const poolSize = eligibleQuestions().length;
    els.questionCount.textContent = reviewFilter ? `復習 ${poolSize}問` : `全${poolSize}問`;

    if (current.type === 'classify') {
      els.questionType.textContent = '5分類';
      renderQuestionText();
      classes.forEach(label => addAnswer(label, label === current.account.cls));
    } else {
      els.questionType.textContent = '増減 → 借方・貸方';
      renderQuestionText();
      const answer = sideFor(current.account.cls, current.direction);
      ['借方', '貸方'].forEach(label => addAnswer(label, label === answer));
    }
    startTimer();
  }

  function addAnswer(label, isCorrect) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'answer-button';
    button.textContent = label;
    button.addEventListener('click', () => answerQuestion(button, isCorrect));
    els.answerGrid.append(button);
  }

  function answerQuestion(selected, isCorrect, timedOut = false) {
    if (answered) return;
    answered = true;
    stopTimer();
    els.countdown.hidden = true;
    els.timerTrack.hidden = true;
    els.questionCard.classList.add('is-answered');
    session.total += 1;
    session.streak = isCorrect ? session.streak + 1 : 0;
    if (isCorrect) session.correct += 1;

    const today = localDate();
    if (!state.history[today]) state.history[today] = { correct: 0, total: 0 };
    state.history[today].total += 1;
    if (isCorrect) state.history[today].correct += 1;

    $$('.answer-button').forEach(button => {
      button.disabled = true;
      if (button === selected && !isCorrect) button.classList.add('is-wrong');
      const correctLabel = current.type === 'classify' ? current.account.cls : sideFor(current.account.cls, current.direction);
      if (button.textContent === correctLabel) button.classList.add('is-correct');
    });

    const result = $('.feedback-result');
    result.classList.toggle('is-wrong', !isCorrect);
    els.feedbackIcon.textContent = isCorrect ? '✓' : '!';
    els.feedbackTitle.textContent = isCorrect ? '正解！' : (timedOut ? '時間切れ' : '不正解');
    if (current.type === 'classify') {
      els.entryLabel.textContent = '分類';
      els.entryValue.textContent = current.account.cls;
      els.feedbackText.textContent = `「${current.account.name}」は${current.account.cls}です。まず5分類を判断してから、左右を考えましょう。`;
    } else {
      const inc = increaseSide[current.account.cls];
      const answer = sideFor(current.account.cls, current.direction);
      els.entryLabel.textContent = '仕訳';
      els.entryValue.textContent = `${answer}に記入`;
      els.feedbackText.textContent = current.direction === '増加'
        ? `${current.account.cls}は増加すると${inc}。答えは${answer}です。`
        : `${current.account.cls}は増加すると${inc}なので、減少は反対側の${answer}です。`;
    }
    els.feedback.hidden = false;
    els.nextButton.hidden = true;
    updateSession();
    saveState();
  }

  function rateQuestion(value, button) {
    if (!answered) return;
    rated = true;
    state.confidence[current.id] = value;
    $$('.confidence-buttons button').forEach(item => item.classList.toggle('is-selected', item === button));
    els.nextButton.hidden = false;
    els.nextButton.disabled = false;
    els.nextButton.textContent = '次の問題';
    saveState();
  }

  function updateSession() {
    els.sessionScore.textContent = `${session.correct} / ${session.total}`;
    els.sessionStreak.textContent = `連続 ${session.streak}`;
  }

  function switchTab(name) {
    if (!['quiz', 'review', 'stats'].includes(name)) return;
    if (activeTab === 'quiz' && name !== 'quiz') stopTimer();
    activeTab = name;
    $$('.tab').forEach(tab => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    $$('.panel').forEach(panel => {
      const active = panel.id === `${name}Panel`;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    if (name === 'stats') renderStats();
    if (name === 'review') refreshReview();
    if (name === 'quiz' && current && !answered) startTimer();
  }

  function startReview(filter) {
    const accepted = filter === 'weak' ? ['unsure', 'review'] : [filter];
    if (!questionBank.some(q => accepted.includes(state.confidence[q.id]))) return;
    reviewFilter = filter;
    switchTab('quiz');
    renderQuestion();
  }

  function refreshSummaries() {
    const today = state.history[localDate()] || { correct: 0, total: 0 };
    els.headerToday.textContent = `${today.correct}問正解`;
    const weakCount = Object.values(state.confidence).filter(v => v === 'unsure' || v === 'review').length;
    els.reviewBadge.textContent = weakCount;
    refreshReview();
  }

  function refreshReview() {
    const unsure = Object.values(state.confidence).filter(v => v === 'unsure').length;
    const revisit = Object.values(state.confidence).filter(v => v === 'review').length;
    els.unsureCount.textContent = unsure;
    els.revisitCount.textContent = revisit;
    $('[data-review-mode="unsure"]').disabled = unsure === 0;
    $('[data-review-mode="review"]').disabled = revisit === 0;
    els.startWeakReview.disabled = unsure + revisit === 0;
    els.reviewEmpty.hidden = unsure + revisit > 0;
  }

  function renderStats() {
    const today = state.history[localDate()] || { correct: 0, total: 0 };
    els.todayCorrect.textContent = today.correct;
    els.todayTotal.textContent = today.total;
    els.todayRate.textContent = today.total ? `${Math.round(today.correct / today.total * 100)}%` : '—';
    els.studyDays.textContent = Object.keys(state.history).filter(key => state.history[key].total > 0).length;
    renderChart();
    renderHistory();
  }

  function lastSevenDays() {
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = localDate(date);
      days.push({ key, label: `${date.getMonth() + 1}/${date.getDate()}`, ...(state.history[key] || { correct: 0, total: 0 }) });
    }
    return days;
  }

  function renderChart() {
    const canvas = els.trendChart;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const width = rect.width;
    const height = rect.height;
    const pad = { top: 18, right: 18, bottom: 32, left: 18 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const data = lastSevenDays();
    const maxCorrect = Math.max(5, ...data.map(d => d.correct));
    const slot = plotW / data.length;

    ctx.font = '12px "BIZ UDPGothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#e1e2d8';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = pad.top + plotH * i / 4;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    }
    data.forEach((d, i) => {
      const barW = Math.min(28, slot * .46);
      const barH = d.correct / maxCorrect * plotH;
      const x = pad.left + slot * i + (slot - barW) / 2;
      const y = pad.top + plotH - barH;
      ctx.fillStyle = '#1f6b4f';
      roundedRect(ctx, x, y, barW, barH, 5);
      ctx.fillStyle = '#68766f';
      ctx.fillText(d.label, pad.left + slot * (i + .5), height - 12);
    });

    ctx.strokeStyle = '#a77224';
    ctx.fillStyle = '#a77224';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    data.forEach((d, i) => {
      const rate = d.total ? d.correct / d.total : 0;
      const x = pad.left + slot * (i + .5);
      const y = pad.top + plotH * (1 - rate);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    data.forEach((d, i) => {
      const rate = d.total ? d.correct / d.total : 0;
      const x = pad.left + slot * (i + .5);
      const y = pad.top + plotH * (1 - rate);
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    });
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    if (height <= 0) return;
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, r);
    ctx.fill();
  }

  function renderHistory() {
    const entries = Object.entries(state.history).filter(([, value]) => value.total > 0).sort(([a], [b]) => b.localeCompare(a));
    if (!entries.length) {
      els.historyList.innerHTML = '<div class="history-empty">最初の1問を解くと、ここに記録されます。</div>';
      return;
    }
    els.historyList.innerHTML = entries.map(([date, value]) => {
      const [year, month, day] = date.split('-');
      const rate = Math.round(value.correct / value.total * 100);
      return `<div class="history-row"><time datetime="${date}">${year}/${Number(month)}/${Number(day)}</time><span>${value.correct} / ${value.total}問</span><strong>${rate}%</strong></div>`;
    }).join('');
  }

  function syncSettingsControls() {
    els.categoryToggle.checked = Boolean(state.settings.showCategory);
    els.timerRange.value = String(state.settings.timeLimit);
    els.timerValue.textContent = timerLabel(Number(state.settings.timeLimit));
  }

  function swipeIsBlocked(target) {
    return Boolean(target && typeof target.closest === 'function' && target.closest('.no-tab-swipe, button, input, label, canvas, dialog'));
  }

  function beginTabSwipe(event) {
    if (event.touches.length !== 1 || swipeIsBlocked(event.target)) {
      swipeStart = null;
      return;
    }
    const touch = event.touches[0];
    swipeStart = { x: touch.clientX, y: touch.clientY };
  }

  function finishTabSwipe(event) {
    if (!swipeStart || !event.changedTouches.length) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - swipeStart.x;
    const dy = touch.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.35) return;
    const tabs = ['quiz', 'review', 'stats'];
    const index = tabs.indexOf(activeTab);
    const nextIndex = dx < 0 ? index + 1 : index - 1;
    if (nextIndex >= 0 && nextIndex < tabs.length) switchTab(tabs[nextIndex]);
  }

  $$('.tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
  $$('#modeButtons button').forEach(button => button.addEventListener('click', () => {
    mode = button.dataset.mode;
    reviewFilter = null;
    $$('#modeButtons button').forEach(item => item.classList.toggle('is-active', item === button));
    renderQuestion();
  }));
  els.categoryToggle.addEventListener('change', () => {
    state.settings.showCategory = els.categoryToggle.checked;
    renderQuestionText();
    saveState();
  });
  els.timerRange.addEventListener('input', () => {
    state.settings.timeLimit = Number(els.timerRange.value);
    els.timerValue.textContent = timerLabel(state.settings.timeLimit);
    saveState();
    startTimer();
  });
  els.mainContent.addEventListener('touchstart', beginTabSwipe, { passive: true });
  els.mainContent.addEventListener('touchend', finishTabSwipe, { passive: true });
  els.mainContent.addEventListener('touchcancel', () => { swipeStart = null; }, { passive: true });
  $$('.confidence-buttons button').forEach(button => button.addEventListener('click', () => rateQuestion(button.dataset.confidence, button)));
  els.nextButton.addEventListener('click', () => { if (rated) renderQuestion(); });
  $$('[data-review-mode]').forEach(button => button.addEventListener('click', () => startReview(button.dataset.reviewMode)));
  els.startWeakReview.addEventListener('click', () => startReview('weak'));
  els.clearReview.addEventListener('click', () => {
    state.confidence = {};
    reviewFilter = null;
    saveState();
  });
  $('#resetData').addEventListener('click', () => els.confirmDialog.showModal());
  els.confirmDialog.addEventListener('close', () => {
    if (els.confirmDialog.returnValue !== 'confirm') return;
    state = defaultState();
    session = { correct: 0, total: 0, streak: 0 };
    reviewFilter = null;
    syncSettingsControls();
    saveState();
    updateSession();
    renderStats();
    renderQuestion();
  });
  window.addEventListener('resize', () => { if (!$('#statsPanel').hidden) renderChart(); });

  els.questionCount.textContent = `全${questionBank.length}問`;
  syncSettingsControls();
  updateSession();
  refreshSummaries();
  renderQuestion();
})();
