/* =====================================================
   LUMORA — Smart Expense Tracker
   script.js — complete app logic (vanilla JS)
   Auth layer updated: real account list + password check
   ===================================================== */

'use strict';

/* =====================================================
   1. CONSTANTS
   ===================================================== */
const STORAGE_KEY = 'lumora_state_v1';
const SESSION_KEY = 'lumora_session_v1';

const CURRENCY_SYMBOLS = { INR: '₹', USD: '$', EUR: '€' };

const EXPENSE_CATEGORIES = [
  'Food', 'Travel', 'Shopping', 'Bills',
  'Education', 'Health', 'Entertainment', 'Other'
];

const INCOME_CATEGORIES = [
  'Salary', 'Freelance', 'Business', 'Gift', 'Other'
];

const CATEGORY_ICONS = {
  Food: '🍔', Travel: '✈️', Shopping: '🛍️', Bills: '🧾',
  Education: '📚', Health: '💊', Entertainment: '🎬', Other: '📦',
  Salary: '💼', Freelance: '💻', Business: '🏢', Gift: '🎁'
};

const CATEGORY_COLORS = [
  '#805ad5', '#b794f6', '#ff9fd4', '#f472b6', '#38b2ac',
  '#f6ad55', '#63b3ed', '#a3a3a3'
];

const PAYMENT_METHODS = ['Cash', 'Card', 'UPI', 'Net Banking', 'Wallet', 'Other'];

const TIPS = [
  'Save at least 20% of your income every month.',
  'Track every small expense — they add up faster than you think.',
  'Set a monthly budget per category to spot overspending early.',
  'Pay yourself first: transfer savings on the day you get paid.',
  'Review subscriptions every 3 months and cancel unused ones.',
  'Use the 50/30/20 rule: 50% needs, 30% wants, 20% savings.',
  'Cook at home 3 extra days a week — instant savings.',
  'Wait 24 hours before any non-essential purchase over your limit.',
  'Build a 3–6 month emergency fund before investing.',
  'Automate one small transfer to savings every week.'
];

/* =====================================================
   2. STATE + LOCALSTORAGE (safe)
   -----------------------------------------------------
   Shape:
   {
     user: { name, email, currency, theme },   // currently logged-in user
     accounts: [ { name, email, passwordHash, salt, createdAt } ],
     transactions: [...], budgets: [...], goals: [...], chat: [...],
     initialized: bool
   }
   ===================================================== */
let state = null;
let session = null;

function defaultState() {
  return {
    user: {
      name: 'Guest',
      email: '',
      currency: 'INR',
      theme: 'light'
    },
    accounts: [],
    transactions: [],
    budgets: [],
    goals: [],
    chat: [],
    initialized: false
  };
}

function safeParse(json, fallback) {
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') return parsed;
    return fallback;
  } catch {
    return fallback;
  }
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const data = safeParse(raw, null);
  if (!data) {
    state = defaultState();
    saveState();
    return;
  }

  // Merge with defaults so missing fields don't crash.
  const def = defaultState();
  state = {
    user: { ...def.user, ...(data.user || {}) },
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
    transactions: Array.isArray(data.transactions) ? data.transactions : [],
    budgets: Array.isArray(data.budgets) ? data.budgets : [],
    goals: Array.isArray(data.goals) ? data.goals : [],
    chat: Array.isArray(data.chat) ? data.chat : [],
    initialized: !!data.initialized
  };

  // Legacy migration: if an old single-user account existed but no accounts
  // array, don't invent a password. Just leave accounts as-is; users will be
  // prompted to sign up. We *do not* delete any existing transactions,
  // budgets, or goals.
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save state', e);
  }
}

function loadSession() {
  session = safeParse(localStorage.getItem(SESSION_KEY), null);
}
function saveSession() {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

/* =====================================================
   3. PASSWORD HASHING (demo-grade, via Web Crypto)
   -----------------------------------------------------
   We never store plaintext passwords. We store:
     - a random per-account salt (hex)
     - a SHA-256 hash of (salt + password) (hex)
   This is NOT production-grade (SHA-256 is fast, so it's weak against
   offline brute force) but it is a real improvement over plaintext and
   satisfies the "do not store plaintext if practical" requirement.
   ===================================================== */
function randomSaltHex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, saltHex) {
  const data = new TextEncoder().encode(saltHex + '::' + password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/* =====================================================
   4. HELPERS
   ===================================================== */
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

function currencySymbol() {
  return CURRENCY_SYMBOLS[state.user.currency] || '₹';
}

function formatMoney(amount) {
  const symbol = currencySymbol();
  const n = Number(amount) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${symbol}${abs.toLocaleString(undefined, {
    maximumFractionDigits: 2, minimumFractionDigits: 0
  })}`;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function sameMonth(dateA, dateB) {
  return dateA.getFullYear() === dateB.getFullYear() &&
         dateA.getMonth() === dateB.getMonth();
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- TOASTS ---------- */
function toast(message, type = 'info') {
  const wrap = $('#toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️';
  el.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(30px)';
    setTimeout(() => el.remove(), 320);
  }, 3400);
}

/* ---------- MODAL ---------- */
function openModal(title, bodyHtml) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  $('#modalOverlay').classList.remove('hidden');
}
function closeModal() {
  $('#modalOverlay').classList.add('hidden');
  $('#modalBody').innerHTML = '';
}
function confirmAction(message, onConfirm) {
  openModal('Please confirm', `
    <p style="margin-bottom:16px">${escapeHtml(message)}</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="confirmNo">Cancel</button>
      <button class="btn btn-danger" id="confirmYes">Yes, continue</button>
    </div>
  `);
  $('#confirmNo').onclick = closeModal;
  $('#confirmYes').onclick = () => { closeModal(); onConfirm(); };
}

/* =====================================================
   5. AUTH  (strict: accounts list + password verification)
   ===================================================== */
function showAuthScreen() {
  $('#authScreen').classList.remove('hidden');
  $('#appScreen').classList.add('hidden');
  // Reset forms and make sure login is the visible one.
  const loginForm = $('#loginForm');
  const signupForm = $('#signupForm');
  if (loginForm) loginForm.classList.remove('hidden');
  if (signupForm) signupForm.classList.add('hidden');
  ['#loginPassword', '#signupPassword', '#signupConfirm'].forEach(sel => {
    const el = $(sel); if (el) el.value = '';
  });
}

function showAppScreen() {
  $('#authScreen').classList.add('hidden');
  $('#appScreen').classList.remove('hidden');
  applyTheme(state.user.theme);
  refreshUserChip();
  showPage('dashboard');
  renderAll();
}

function findAccount(email) {
  const target = String(email || '').trim().toLowerCase();
  return state.accounts.find(a => a.email === target) || null;
}

/* ---------- LOGIN ---------- */
async function handleLogin(email, password) {
  const cleanEmail = String(email || '').trim().toLowerCase();

  // Basic field validation
  if (!cleanEmail || !password) {
    return toast('Please enter both email and password.', 'error');
  }
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
    return toast('Please enter a valid email address.', 'error');
  }

  const account = findAccount(cleanEmail);

  // Requirement 5: account not found
  if (!account) {
    return toast('No account found. Please create an account first.', 'error');
  }

  // Verify password
  const hash = await hashPassword(password, account.salt);
  if (hash !== account.passwordHash) {
    // Requirement 4: wrong password
    return toast('Incorrect password. Please try again.', 'error');
  }

  // Success — set the active user for this session.
  state.user = {
    ...state.user,
    name: account.name,
    email: account.email
  };
  saveState();

  session = { email: account.email, loginAt: Date.now() };
  saveSession();

  toast(`Welcome back, ${account.name}!`, 'success');
  showAppScreen();
}

/* ---------- SIGN UP ---------- */
async function handleSignup(name, email, password, confirm) {
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();

  // Requirement 1: validate all fields
  if (!cleanName || !cleanEmail || !password || !confirm) {
    return toast('Please fill in all fields.', 'error');
  }
  if (cleanName.length < 2) {
    return toast('Please enter your full name.', 'error');
  }
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
    return toast('Please enter a valid email address.', 'error');
  }
  if (password.length < 6) {
    return toast('Password must be at least 6 characters.', 'error');
  }
  if (password !== confirm) {
    return toast('Passwords do not match.', 'error');
  }

  // Requirement 2: duplicate email
  if (findAccount(cleanEmail)) {
    return toast('An account with this email already exists. Please log in.', 'error');
  }

  // Create the account with hashed password.
  const salt = randomSaltHex();
  const passwordHash = await hashPassword(password, salt);

  const account = {
    name: cleanName,
    email: cleanEmail,
    passwordHash,
    salt,
    createdAt: Date.now()
  };
  state.accounts.push(account);

  // Do NOT wipe transactions/budgets/goals — Requirement 9.
  // Just log the new user in.
  state.user = {
    ...state.user,
    name: cleanName,
    email: cleanEmail
  };
  saveState();

  session = { email: cleanEmail, loginAt: Date.now() };
  saveSession();

  toast('Account created 🎉 Welcome to LUMORA!', 'success');
  showAppScreen();
}

/* ---------- DEMO ACCOUNT ---------- */
async function handleDemoLogin() {
  const DEMO_EMAIL = 'demo@lumora.app';
  const DEMO_PASSWORD = 'demo1234';

  // If the demo account doesn't exist yet, create it (and seed demo data
  // only if the store is empty — do not wipe the user's own data).
  if (!findAccount(DEMO_EMAIL)) {
    const salt = randomSaltHex();
    const passwordHash = await hashPassword(DEMO_PASSWORD, salt);
    state.accounts.push({
      name: 'Demo User',
      email: DEMO_EMAIL,
      passwordHash,
      salt,
      createdAt: Date.now()
    });

    // Only seed sample data if the user hasn't entered anything yet.
    if (state.transactions.length === 0 &&
        state.budgets.length === 0 &&
        state.goals.length === 0) {
      seedDemoData();
    }
    saveState();
  }

  await handleLogin(DEMO_EMAIL, DEMO_PASSWORD);
  // Friendly note about how to log in again later.
  setTimeout(() => toast('Demo login: demo@lumora.app / demo1234', 'info'), 400);
}

/* ---------- LOGOUT ---------- */
function handleLogout() {
  session = null;
  saveSession();

  // Reset the in-memory "current user" so the login screen starts clean,
  // but keep accounts, transactions, budgets, goals intact.
  state.user = {
    ...state.user,
    name: 'Guest',
    email: ''
  };
  saveState();

  toast('Logged out', 'info');
  showAuthScreen();
}

/* =====================================================
   6. DEMO DATA (unchanged behaviour)
   ===================================================== */
function seedDemoData() {
  const today = new Date();
  const tx = [];
  const addDays = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  tx.push({ id: uid(), type: 'income', title: 'Monthly Salary',
    amount: 45000, category: 'Salary', date: addDays(5),
    payment: 'Net Banking', notes: 'Primary income', createdAt: Date.now() - 5000 });

  const sample = [
    ['Groceries',     1250, 'Food',          'UPI',  1],
    ['Coffee shop',    180, 'Food',          'Cash', 2],
    ['Bus pass',       900, 'Travel',        'Card', 3],
    ['New shoes',     2200, 'Shopping',      'Card', 4],
    ['Electricity',   1450, 'Bills',         'UPI',  6],
    ['Online course', 1999, 'Education',     'Card', 8],
    ['Pharmacy',       450, 'Health',        'Cash', 10],
    ['Movie night',    600, 'Entertainment', 'UPI',  12],
    ['Lunch out',      320, 'Food',          'UPI',  14],
    ['Groceries',     1100, 'Food',          'Card', 16],
    ['Taxi ride',      280, 'Travel',        'UPI',  18],
    ['T-shirt',        799, 'Shopping',      'Card', 20],
    ['Internet bill',  899, 'Bills',         'Net Banking', 22],
    ['Books',          540, 'Education',     'Cash', 25],
    ['Snacks',         210, 'Food',          'Cash', 27],
    ['Gym',            800, 'Health',        'Card', 30],
    ['Streaming',      499, 'Entertainment', 'Card', 33],
    ['Groceries',     1350, 'Food',          'UPI',  36],
    ['Winter jacket', 1800, 'Shopping',      'Card', 40],
    ['Dinner out',     720, 'Food',          'UPI',  43]
  ];

  sample.forEach((row, i) => {
    tx.push({
      id: uid(), type: 'expense', title: row[0], amount: row[1],
      category: row[2], payment: row[3], date: addDays(row[4]),
      notes: '', createdAt: Date.now() - (sample.length - i) * 1000
    });
  });

  tx.push({ id: uid(), type: 'income', title: 'Freelance project',
    amount: 8000, category: 'Freelance', date: addDays(15),
    payment: 'UPI', notes: '', createdAt: Date.now() - 100 });

  state.transactions = tx;

  state.budgets = [
    { id: uid(), category: 'Food', amount: 5000 },
    { id: uid(), category: 'Shopping', amount: 3000 },
    { id: uid(), category: 'Travel', amount: 2000 }
  ];

  state.goals = [
    { id: uid(), name: 'New Laptop', target: 60000, current: 22000,
      deadline: addDays(-180), createdAt: Date.now() },
    { id: uid(), name: 'Emergency Fund', target: 50000, current: 15000,
      deadline: addDays(-365), createdAt: Date.now() }
  ];

  state.initialized = true;
}

/* =====================================================
   7. NAVIGATION
   ===================================================== */
const PAGE_TITLES = {
  dashboard: 'Dashboard',
  transactions: 'Transactions',
  budgets: 'Budgets',
  goals: 'Savings Goals',
  reports: 'Reports',
  assistant: 'Lumi Assistant',
  profile: 'Profile',
  settings: 'Settings'
};

function showPage(page) {
  $$('.page').forEach(p => p.classList.add('hidden'));
  const el = $(`#page-${page}`);
  if (el) el.classList.remove('hidden');

  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const titleEl = $('#pageTitle');
  if (titleEl) titleEl.textContent = PAGE_TITLES[page] || 'LUMORA';

  $('#sidebar').classList.remove('open');

  if (page === 'dashboard') renderDashboard();
  if (page === 'transactions') renderTransactions();
  if (page === 'budgets') renderBudgets();
  if (page === 'goals') renderGoals();
  if (page === 'reports') renderReports();
  if (page === 'assistant') renderChat();
  if (page === 'profile') renderProfile();
  if (page === 'settings') renderSettings();
}

/* =====================================================
   8. TRANSACTIONS
   ===================================================== */
function getFilteredTransactions() {
  const search = ($('#searchInput')?.value || '').toLowerCase().trim();
  const type = $('#filterType')?.value || '';
  const category = $('#filterCategory')?.value || '';
  const range = $('#filterRange')?.value || 'all';
  const sort = $('#sortBy')?.value || 'newest';

  let list = state.transactions.slice();

  if (search) {
    list = list.filter(t =>
      t.title.toLowerCase().includes(search) ||
      (t.notes || '').toLowerCase().includes(search) ||
      t.category.toLowerCase().includes(search)
    );
  }
  if (type) list = list.filter(t => t.type === type);
  if (category) list = list.filter(t => t.category === category);

  if (range !== 'all') {
    const days = parseInt(range, 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    list = list.filter(t => new Date(t.date) >= cutoff);
  }

  switch (sort) {
    case 'oldest':  list.sort((a, b) => new Date(a.date) - new Date(b.date)); break;
    case 'highest': list.sort((a, b) => b.amount - a.amount); break;
    case 'lowest':  list.sort((a, b) => a.amount - b.amount); break;
    default:        list.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  return list;
}

function renderTransactions() {
  const catSelect = $('#filterCategory');
  if (catSelect && catSelect.options.length <= 1) {
    const all = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
    catSelect.innerHTML = '<option value="">All categories</option>' +
      all.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  const list = getFilteredTransactions();
  const container = $('#txList');
  if (!container) return;

  let inc = 0, exp = 0;
  list.forEach(t => t.type === 'income' ? inc += t.amount : exp += t.amount);
  $('#txTotalIncome').textContent = formatMoney(inc);
  $('#txTotalExpense').textContent = formatMoney(exp);
  $('#txTotalNet').textContent = formatMoney(inc - exp);

  if (list.length === 0) {
    container.innerHTML = emptyState('📭', 'No transactions found',
      'Try changing filters or add a new transaction.');
    return;
  }

  container.innerHTML = list.map(t => txListItem(t)).join('');
  attachTxActions();
}

function txListItem(t) {
  const icon = CATEGORY_ICONS[t.category] || (t.type === 'income' ? '💰' : '💸');
  const sign = t.type === 'income' ? '+' : '−';
  return `
    <div class="list-item">
      <div class="item-icon ${t.type}">${icon}</div>
      <div class="item-body">
        <div class="item-title">${escapeHtml(t.title)}</div>
        <div class="item-sub">
          ${escapeHtml(t.category)} · ${formatDate(t.date)}
          ${t.payment ? ' · ' + escapeHtml(t.payment) : ''}
        </div>
      </div>
      <div class="item-amount ${t.type}">${sign}${formatMoney(t.amount).replace('-', '')}</div>
      <div class="item-actions">
        <button data-edit="${t.id}" title="Edit">✏️</button>
        <button data-del="${t.id}" class="danger" title="Delete">🗑️</button>
      </div>
    </div>`;
}

function attachTxActions() {
  $$('[data-edit]').forEach(b => {
    b.onclick = () => openTxModal(state.transactions.find(t => t.id === b.dataset.edit));
  });
  $$('[data-del]').forEach(b => {
    b.onclick = () => confirmAction('Delete this transaction permanently?', () => {
      state.transactions = state.transactions.filter(t => t.id !== b.dataset.del);
      saveState();
      toast('Transaction deleted', 'success');
      renderAll();
    });
  });
}

function openTxModal(tx = null) {
  const isEdit = !!tx;
  const t = tx || { type: 'expense', category: 'Food', date: new Date().toISOString().slice(0, 10) };
  const isExpense = t.type === 'expense';
  const cats = isExpense ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  openModal(isEdit ? 'Edit transaction' : 'New transaction', `
    <form id="txForm">
      <div class="form-row">
        <label>Type
          <select id="txType">
            <option value="expense" ${t.type === 'expense' ? 'selected' : ''}>Expense</option>
            <option value="income"  ${t.type === 'income'  ? 'selected' : ''}>Income</option>
          </select>
        </label>
        <label>Category
          <select id="txCategory">
            ${cats.map(c => `<option value="${c}" ${t.category === c ? 'selected' : ''}>${CATEGORY_ICONS[c] || ''} ${c}</option>`).join('')}
          </select>
        </label>
      </div>
      <label>Title
        <input id="txTitle" required maxlength="60" value="${escapeHtml(t.title || '')}"
               placeholder="e.g. Groceries" />
      </label>
      <div class="form-row">
        <label>Amount
          <input id="txAmount" type="number" min="0.01" step="0.01" required
                 value="${t.amount || ''}" placeholder="0.00" />
        </label>
        <label>Date
          <input id="txDate" type="date" required value="${t.date}" />
        </label>
      </div>
      <div class="form-row">
        <label>Payment method
          <select id="txPayment">
            ${PAYMENT_METHODS.map(p => `<option value="${p}" ${t.payment === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
        </label>
      </div>
      <label>Notes (optional)
        <textarea id="txNotes" maxlength="200" placeholder="Add a note...">${escapeHtml(t.notes || '')}</textarea>
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="txCancel">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save changes' : 'Add transaction'}</button>
      </div>
    </form>
  `);

  $('#txType').onchange = (e) => {
    const list = e.target.value === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    $('#txCategory').innerHTML = list.map(c =>
      `<option value="${c}">${CATEGORY_ICONS[c] || ''} ${c}</option>`).join('');
  };

  $('#txCancel').onclick = closeModal;

  $('#txForm').onsubmit = (e) => {
    e.preventDefault();
    const amount = parseFloat($('#txAmount').value);
    if (isNaN(amount) || amount <= 0) return toast('Enter a valid amount', 'error');

    const payload = {
      type: $('#txType').value,
      title: $('#txTitle').value.trim(),
      amount: Math.round(amount * 100) / 100,
      category: $('#txCategory').value,
      date: $('#txDate').value,
      payment: $('#txPayment').value,
      notes: $('#txNotes').value.trim()
    };
    if (!payload.title) return toast('Please enter a title', 'error');
    if (!payload.date) return toast('Please select a date', 'error');

    if (isEdit) {
      Object.assign(tx, payload);
      toast('Transaction updated', 'success');
    } else {
      state.transactions.push({ id: uid(), createdAt: Date.now(), ...payload });
      toast('Transaction added', 'success');
    }
    saveState();
    closeModal();
    renderAll();
  };
}

/* =====================================================
   9. BUDGETS
   ===================================================== */
function spentThisMonthForCategory(cat) {
  const now = new Date();
  return state.transactions
    .filter(t => t.type === 'expense' && t.category === cat)
    .filter(t => sameMonth(new Date(t.date), now))
    .reduce((s, t) => s + t.amount, 0);
}

function renderBudgets() {
  const container = $('#budgetList');
  if (!container) return;

  if (state.budgets.length === 0) {
    container.innerHTML = emptyState('🎯', 'No budgets yet',
      'Click "New Budget" to add your first monthly budget.');
    return;
  }

  container.innerHTML = state.budgets.map(b => {
    const spent = spentThisMonthForCategory(b.category);
    const pct = b.amount > 0 ? Math.min((spent / b.amount) * 100, 999) : 0;
    const remaining = b.amount - spent;

    let badge = '<span class="badge badge-ok">On track</span>';
    let fillClass = '';
    if (pct >= 100) { badge = '<span class="badge badge-danger">Exceeded</span>'; fillClass = 'danger'; }
    else if (pct >= 75) { badge = '<span class="badge badge-warn">Almost there</span>'; fillClass = 'warn'; }

    return `
      <div class="budget-card">
        <div class="budget-head">
          <div>
            <div class="budget-cat">${CATEGORY_ICONS[b.category] || ''} ${escapeHtml(b.category)}</div>
            <div class="budget-amounts">
              Spent ${formatMoney(spent)} of ${formatMoney(b.amount)}
            </div>
          </div>
          ${badge}
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${fillClass}" style="width:${Math.min(pct, 100)}%"></div>
        </div>
        <div class="budget-amounts">
          ${remaining >= 0
            ? `${formatMoney(remaining)} remaining · ${pct.toFixed(0)}% used`
            : `${formatMoney(Math.abs(remaining))} over budget · ${pct.toFixed(0)}% used`}
        </div>
        <div class="goal-actions">
          <button class="btn btn-ghost" data-edit-budget="${b.id}">Edit</button>
          <button class="btn btn-danger" data-del-budget="${b.id}">Delete</button>
        </div>
      </div>`;
  }).join('');

  $$('[data-edit-budget]').forEach(btn => {
    btn.onclick = () => openBudgetModal(state.budgets.find(b => b.id === btn.dataset.editBudget));
  });
  $$('[data-del-budget]').forEach(btn => {
    btn.onclick = () => confirmAction('Delete this budget?', () => {
      state.budgets = state.budgets.filter(b => b.id !== btn.dataset.delBudget);
      saveState();
      toast('Budget deleted', 'success');
      renderAll();
    });
  });
}

function openBudgetModal(budget = null) {
  const isEdit = !!budget;
  const b = budget || { category: 'Food', amount: '' };

  openModal(isEdit ? 'Edit budget' : 'New monthly budget', `
    <form id="budgetForm">
      <label>Category
        <select id="budgetCategory" ${isEdit ? 'disabled' : ''}>
          ${EXPENSE_CATEGORIES.map(c =>
            `<option value="${c}" ${b.category === c ? 'selected' : ''}>${CATEGORY_ICONS[c] || ''} ${c}</option>`
          ).join('')}
        </select>
      </label>
      <label>Monthly limit
        <input id="budgetAmount" type="number" min="1" step="1" required
               value="${b.amount}" placeholder="e.g. 5000" />
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="budgetCancel">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Create'}</button>
      </div>
    </form>
  `);

  $('#budgetCancel').onclick = closeModal;
  $('#budgetForm').onsubmit = (e) => {
    e.preventDefault();
    const amount = parseFloat($('#budgetAmount').value);
    if (isNaN(amount) || amount <= 0) return toast('Enter a valid amount', 'error');

    if (isEdit) {
      budget.amount = amount;
      toast('Budget updated', 'success');
    } else {
      const category = $('#budgetCategory').value;
      const exists = state.budgets.find(x => x.category === category);
      if (exists) return toast('A budget for this category already exists', 'error');
      state.budgets.push({ id: uid(), category, amount });
      toast('Budget created', 'success');
    }
    saveState();
    closeModal();
    renderAll();
  };
}

/* =====================================================
   10. GOALS
   ===================================================== */
function renderGoals() {
  const container = $('#goalList');
  if (!container) return;

  if (state.goals.length === 0) {
    container.innerHTML = emptyState('🐷', 'No savings goals yet',
      'Click "New Goal" to start tracking your savings.');
    return;
  }

  container.innerHTML = state.goals.map(g => {
    const pct = g.target > 0 ? Math.min((g.current / g.target) * 100, 100) : 0;
    const done = g.current >= g.target;
    const remaining = Math.max(g.target - g.current, 0);

    return `
      <div class="goal-card">
        <div class="goal-head">
          <div>
            <div class="goal-name">${escapeHtml(g.name)}</div>
            <div class="budget-amounts">
              ${formatMoney(g.current)} of ${formatMoney(g.target)}
              ${g.deadline ? ' · by ' + formatDate(g.deadline) : ''}
            </div>
          </div>
          ${done
            ? '<span class="badge badge-ok">🎉 Achieved</span>'
            : `<span class="badge badge-ok">${pct.toFixed(0)}%</span>`}
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${done ? 'success' : ''}" style="width:${pct}%"></div>
        </div>
        <div class="budget-amounts">
          ${done ? 'Amazing! You reached your goal 🎉' : `${formatMoney(remaining)} to go`}
        </div>
        <div class="goal-actions">
          <button class="btn btn-primary" data-add-goal="${g.id}">+ Add money</button>
          <button class="btn btn-ghost" data-wd-goal="${g.id}">− Withdraw</button>
          <button class="btn btn-ghost" data-edit-goal="${g.id}">Edit</button>
          <button class="btn btn-danger" data-del-goal="${g.id}">Delete</button>
        </div>
      </div>`;
  }).join('');

  $$('[data-add-goal]').forEach(b => b.onclick = () => openGoalAmountModal(b.dataset.addGoal, 'add'));
  $$('[data-wd-goal]').forEach(b => b.onclick = () => openGoalAmountModal(b.dataset.wdGoal, 'withdraw'));
  $$('[data-edit-goal]').forEach(b => b.onclick = () => openGoalModal(state.goals.find(g => g.id === b.dataset.editGoal)));
  $$('[data-del-goal]').forEach(b => b.onclick = () => confirmAction('Delete this goal?', () => {
    state.goals = state.goals.filter(g => g.id !== b.dataset.delGoal);
    saveState();
    toast('Goal deleted', 'success');
    renderAll();
  }));
}

function openGoalModal(goal = null) {
  const isEdit = !!goal;
  const g = goal || { name: '', target: '', current: 0, deadline: '' };

  openModal(isEdit ? 'Edit goal' : 'New savings goal', `
    <form id="goalForm">
      <label>Goal name
        <input id="goalName" required maxlength="40" value="${escapeHtml(g.name)}"
               placeholder="e.g. New Laptop" />
      </label>
      <div class="form-row">
        <label>Target amount
          <input id="goalTarget" type="number" min="1" step="1" required
                 value="${g.target}" placeholder="60000" />
        </label>
        <label>Already saved
          <input id="goalCurrent" type="number" min="0" step="1"
                 value="${g.current}" placeholder="0" />
        </label>
      </div>
      <label>Target date (optional)
        <input id="goalDeadline" type="date" value="${g.deadline || ''}" />
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="goalCancel">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Create goal'}</button>
      </div>
    </form>
  `);

  $('#goalCancel').onclick = closeModal;
  $('#goalForm').onsubmit = (e) => {
    e.preventDefault();
    const target = parseFloat($('#goalTarget').value);
    const current = parseFloat($('#goalCurrent').value) || 0;
    if (isNaN(target) || target <= 0) return toast('Enter a valid target', 'error');
    if (current < 0) return toast('Saved amount cannot be negative', 'error');

    const payload = {
      name: $('#goalName').value.trim(),
      target,
      current,
      deadline: $('#goalDeadline').value || ''
    };
    if (!payload.name) return toast('Please enter a goal name', 'error');

    if (isEdit) {
      Object.assign(goal, payload);
      toast('Goal updated', 'success');
    } else {
      state.goals.push({ id: uid(), createdAt: Date.now(), ...payload });
      toast('Goal created', 'success');
    }
    saveState();
    closeModal();
    renderAll();
  };
}

function openGoalAmountModal(goalId, mode) {
  const g = state.goals.find(x => x.id === goalId);
  if (!g) return;

  openModal(mode === 'add' ? 'Add money to goal' : 'Withdraw from goal', `
    <form id="goalAmountForm">
      <p class="muted small" style="margin-bottom:10px">
        ${escapeHtml(g.name)} — current: ${formatMoney(g.current)}
      </p>
      <label>Amount
        <input id="goalAmountInput" type="number" min="0.01" step="1" required
               placeholder="Enter amount" />
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="gaCancel">Cancel</button>
        <button type="submit" class="btn btn-primary">${mode === 'add' ? 'Add' : 'Withdraw'}</button>
      </div>
    </form>
  `);

  $('#gaCancel').onclick = closeModal;
  $('#goalAmountForm').onsubmit = (e) => {
    e.preventDefault();
    const amt = parseFloat($('#goalAmountInput').value);
    if (isNaN(amt) || amt <= 0) return toast('Enter a valid amount', 'error');

    if (mode === 'add') {
      g.current += amt;
      toast(`Added ${formatMoney(amt)} to ${g.name}`, 'success');
      if (g.current >= g.target) setTimeout(() => toast(`🎉 Goal "${g.name}" achieved!`, 'success'), 400);
    } else {
      if (amt > g.current) return toast('Cannot withdraw more than saved', 'error');
      g.current -= amt;
      toast(`Withdrew ${formatMoney(amt)} from ${g.name}`, 'success');
    }
    saveState();
    closeModal();
    renderAll();
  };
}

/* =====================================================
   11. DASHBOARD
   ===================================================== */
function computeTotals() {
  let income = 0, expense = 0;
  state.transactions.forEach(t => {
    if (t.type === 'income') income += t.amount;
    else expense += t.amount;
  });
  return { income, expense, balance: income - expense };
}

function renderDashboard() {
  const totals = computeTotals();
  $('#statBalance').textContent = formatMoney(totals.balance);
  $('#statIncome').textContent = formatMoney(totals.income);
  $('#statExpense').textContent = formatMoney(totals.expense);
  const rate = totals.income > 0 ? (totals.balance / totals.income) * 100 : 0;
  $('#statSavings').textContent = `${rate.toFixed(0)}%`;

  renderMonthlyChart();
  renderCategoryDonut();
  renderRecentList();
  renderBudgetProgress();
  renderTip();
}

function renderMonthlyChart() {
  const container = $('#monthlyChart');
  if (!container) return;

  const months = [];
  const today = new Date();
  for (let i = 5; i >= 0; i--) {
    months.push(new Date(today.getFullYear(), today.getMonth() - i, 1));
  }
  const values = months.map(m => state.transactions
    .filter(t => t.type === 'expense' && sameMonth(new Date(t.date), m))
    .reduce((s, t) => s + t.amount, 0));
  const max = Math.max(...values, 1);

  container.innerHTML = months.map((m, i) => {
    const h = (values[i] / max) * 100;
    const label = m.toLocaleDateString(undefined, { month: 'short' });
    return `
      <div class="bar-item">
        <div class="bar-value">${formatMoney(values[i])}</div>
        <div class="bar" style="height:${h}%"></div>
        <span class="bar-label">${label}</span>
      </div>`;
  }).join('');
}

function renderCategoryDonut() {
  const donut = $('#categoryDonut');
  const legend = $('#categoryLegend');
  if (!donut || !legend) return;

  const now = new Date();
  const totals = {};
  state.transactions
    .filter(t => t.type === 'expense' && sameMonth(new Date(t.date), now))
    .forEach(t => { totals[t.category] = (totals[t.category] || 0) + t.amount; });

  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const sum = entries.reduce((s, [, v]) => s + v, 0);

  if (sum === 0) {
    donut.style.background = 'var(--surface-soft)';
    donut.innerHTML = `<div class="donut-center"><strong>No data</strong>this month</div>`;
    legend.innerHTML = '';
    return;
  }

  let acc = 0;
  const stops = entries.map(([, val], i) => {
    const start = (acc / sum) * 360;
    acc += val;
    const end = (acc / sum) * 360;
    const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
    return `${color} ${start}deg ${end}deg`;
  }).join(', ');

  donut.style.background = `conic-gradient(${stops})`;
  donut.innerHTML = `<div class="donut-center"><strong>${formatMoney(sum)}</strong>this month</div>`;

  legend.innerHTML = entries.slice(0, 6).map(([cat, val], i) => {
    const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
    const pct = ((val / sum) * 100).toFixed(0);
    return `
      <div class="donut-legend-item">
        <div class="donut-legend-left">
          <span class="legend-dot" style="background:${color}"></span>
          <span class="donut-legend-name">${escapeHtml(cat)}</span>
        </div>
        <span>${pct}%</span>
      </div>`;
  }).join('');
}

function renderRecentList() {
  const container = $('#recentList');
  if (!container) return;
  const recent = state.transactions
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  if (recent.length === 0) {
    container.innerHTML = emptyState('📭', 'No transactions yet', 'Use Quick Add to log your first one.');
    return;
  }
  container.innerHTML = recent.map(t => txListItem(t)).join('');
}

function renderBudgetProgress() {
  const container = $('#budgetProgressList');
  if (!container) return;

  if (state.budgets.length === 0) {
    container.innerHTML = emptyState('🎯', 'No budgets set', 'Create one on the Budgets page.');
    return;
  }

  container.innerHTML = state.budgets.map(b => {
    const spent = spentThisMonthForCategory(b.category);
    const pct = b.amount > 0 ? Math.min((spent / b.amount) * 100, 100) : 0;
    let fillClass = '';
    if (pct >= 100) fillClass = 'danger';
    else if (pct >= 75) fillClass = 'warn';

    return `
      <div>
        <div style="display:flex;justify-content:space-between;font-size:.84rem;margin-bottom:2px">
          <span>${CATEGORY_ICONS[b.category] || ''} ${escapeHtml(b.category)}</span>
          <span class="muted">${formatMoney(spent)} / ${formatMoney(b.amount)}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${fillClass}" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join('');
}

function renderTip() {
  const el = $('#tipText');
  if (!el) return;
  el.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
}

/* =====================================================
   12. REPORTS
   ===================================================== */
function renderReports() {
  const months = parseInt($('#reportRange')?.value || '6', 10);
  const today = new Date();

  const monthList = [];
  for (let i = months - 1; i >= 0; i--) {
    monthList.push(new Date(today.getFullYear(), today.getMonth() - i, 1));
  }

  const incs = monthList.map(m => state.transactions
    .filter(t => t.type === 'income' && sameMonth(new Date(t.date), m))
    .reduce((s, t) => s + t.amount, 0));
  const exps = monthList.map(m => state.transactions
    .filter(t => t.type === 'expense' && sameMonth(new Date(t.date), m))
    .reduce((s, t) => s + t.amount, 0));

  const max = Math.max(...incs, ...exps, 1);

  const bar = $('#reportBarChart');
  if (bar) {
    bar.innerHTML = `
      <div style="position:absolute;top:-24px;left:0;font-size:.78rem;color:var(--text-soft)">
        <span class="legend-dot" style="background:#10b981"></span> Income
        &nbsp;&nbsp;
        <span class="legend-dot" style="background:#f472b6"></span> Expense
      </div>
    ` + monthList.map((m, i) => {
      const hInc = (incs[i] / max) * 100;
      const hExp = (exps[i] / max) * 100;
      const label = m.toLocaleDateString(undefined, { month: 'short' });
      return `
        <div class="bar-item" style="flex-direction:row;align-items:flex-end;gap:4px">
          <div class="bar income" style="height:${hInc}%" title="Income ${formatMoney(incs[i])}"></div>
          <div class="bar expense" style="height:${hExp}%" title="Expense ${formatMoney(exps[i])}"></div>
          <span class="bar-label" style="left:50%;transform:translateX(-50%)">${label}</span>
        </div>`;
    }).join('');
  }

  const catList = $('#reportCategoryList');
  if (catList) {
    const now = new Date();
    const totals = {};
    state.transactions
      .filter(t => t.type === 'expense' && sameMonth(new Date(t.date), now))
      .forEach(t => { totals[t.category] = (totals[t.category] || 0) + t.amount; });

    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const sum = entries.reduce((s, [, v]) => s + v, 0);

    if (entries.length === 0) {
      catList.innerHTML = emptyState('📊', 'No expenses this month', 'Add transactions to see the breakdown.');
    } else {
      catList.innerHTML = entries.map(([cat, val], i) => {
        const pct = ((val / sum) * 100).toFixed(0);
        const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
        return `
          <div>
            <div style="display:flex;justify-content:space-between;font-size:.85rem">
              <span><span class="legend-dot" style="background:${color}"></span>${escapeHtml(cat)}</span>
              <span>${formatMoney(val)} · ${pct}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width:${pct}%;background:${color}"></div>
            </div>
          </div>`;
      }).join('');
    }
  }

  const sumEl = $('#reportSummary');
  if (sumEl) {
    const totalInc = incs.reduce((s, v) => s + v, 0);
    const totalExp = exps.reduce((s, v) => s + v, 0);
    const totalSav = totalInc - totalExp;
    const rate = totalInc > 0 ? (totalSav / totalInc) * 100 : 0;

    sumEl.innerHTML = `
      <div class="list">
        <div class="list-item">
          <div class="item-icon income">💰</div>
          <div class="item-body">
            <div class="item-title">Total income</div>
            <div class="item-sub">Last ${months} months</div>
          </div>
          <div class="item-amount income">${formatMoney(totalInc)}</div>
        </div>
        <div class="list-item">
          <div class="item-icon expense">💸</div>
          <div class="item-body">
            <div class="item-title">Total expenses</div>
            <div class="item-sub">Last ${months} months</div>
          </div>
          <div class="item-amount expense">${formatMoney(totalExp)}</div>
        </div>
        <div class="list-item">
          <div class="item-icon">🏦</div>
          <div class="item-body">
            <div class="item-title">Net savings</div>
            <div class="item-sub">Savings rate: ${rate.toFixed(1)}%</div>
          </div>
          <div class="item-amount income">${formatMoney(totalSav)}</div>
        </div>
      </div>`;
  }
}

/* =====================================================
   13. CSV EXPORT
   ===================================================== */
function exportCSV() {
  if (state.transactions.length === 0) {
    toast('No transactions to export', 'error');
    return;
  }

  const rows = [['Date', 'Type', 'Title', 'Category', 'Amount', 'Payment', 'Notes']];
  const list = state.transactions.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  list.forEach(t => {
    rows.push([
      t.date, t.type, t.title, t.category, t.amount, t.payment || '',
      (t.notes || '').replace(/[\r\n]+/g, ' ')
    ]);
  });

  const csv = rows.map(r => r.map(cell => {
    const s = String(cell);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lumora_transactions_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('CSV downloaded', 'success');
}

/* =====================================================
   14. LUMI CHATBOT
   ===================================================== */
function renderChat() {
  const win = $('#chatWindow');
  if (!win) return;

  if (state.chat.length === 0) {
    state.chat.push({
      id: uid(),
      role: 'bot',
      text: "Hi! I'm Lumi 👋 — your demo money assistant. Ask me things like \"How much did I spend this month?\" or tap a suggestion below."
    });
    saveState();
  }

  win.innerHTML = state.chat.map(m =>
    `<div class="chat-msg ${m.role}">${escapeHtml(m.text)}</div>`
  ).join('');
  win.scrollTop = win.scrollHeight;
}

function lumiReply(userText) {
  const q = userText.toLowerCase();
  const totals = computeTotals();
  const now = new Date();

  const monthExpense = state.transactions
    .filter(t => t.type === 'expense' && sameMonth(new Date(t.date), now))
    .reduce((s, t) => s + t.amount, 0);
  const monthIncome = state.transactions
    .filter(t => t.type === 'income' && sameMonth(new Date(t.date), now))
    .reduce((s, t) => s + t.amount, 0);

  const catTotals = {};
  state.transactions
    .filter(t => t.type === 'expense' && sameMonth(new Date(t.date), now))
    .forEach(t => { catTotals[t.category] = (catTotals[t.category] || 0) + t.amount; });
  const sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
  const topCat = sortedCats[0];

  if (/^(hi|hello|hey|yo|hola)\b/.test(q)) {
    return `Hey there! 👋 How can I help with your money today?`;
  }
  if (q.includes('how much') && (q.includes('spend') || q.includes('spent') || q.includes('expense'))) {
    if (q.includes('month')) {
      return `This month you've spent ${formatMoney(monthExpense)} so far. ` +
             (monthIncome > 0 ? `You've earned ${formatMoney(monthIncome)}.` : '');
    }
    return `Your total expenses are ${formatMoney(totals.expense)}.`;
  }
  if ((q.includes('top') && q.includes('category')) || q.includes('biggest') || q.includes('most')) {
    if (!topCat) return `No expenses logged this month yet. Add a few and ask me again!`;
    return `Your top spending category this month is ${topCat[0]} at ${formatMoney(topCat[1])}.`;
  }
  if (q.includes('save') || q.includes('saving')) {
    const rate = totals.income > 0 ? ((totals.balance / totals.income) * 100).toFixed(0) : 0;
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    return `Your savings rate is ${rate}%. A common target is 20%. 💡 Tip: ${tip}`;
  }
  if (q.includes('add') && (q.includes('expense') || q.includes('transaction'))) {
    return `To add an expense:\n1. Click "+ Quick Add" in the top bar, or\n2. Go to Transactions → "+ Add", then fill in the details and save.`;
  }
  if (q.includes('budget')) {
    return `Budgets let you set a monthly limit per category. Go to the Budgets page → "New Budget", pick a category and amount. LUMORA will warn you at 75% and 100% usage.`;
  }
  if (q.includes('income') || q.includes('earn')) {
    return `Your total income is ${formatMoney(totals.income)}. This month you've earned ${formatMoney(monthIncome)}.`;
  }
  if (q.includes('balance') || q.includes('left')) {
    return `Your balance (income − expenses) is ${formatMoney(totals.balance)}.`;
  }
  if (q.includes('goal')) {
    if (state.goals.length === 0) return `You don't have any savings goals yet. Head to the Goals page and create one!`;
    return `You have ${state.goals.length} savings goal(s). Open the Goals page to add or withdraw money.`;
  }
  if (q.includes('categor')) {
    return `Categories include: Food, Travel, Shopping, Bills, Education, Health, Entertainment and Other. You can pick one when adding a transaction.`;
  }
  if (q.includes('help') || q.includes('what can you do')) {
    return `I can tell you:\n• How much you spent this month\n• Your top category\n• Your savings rate\n• How to add transactions or budgets\nJust ask!`;
  }
  return `I'm not sure I understood that. Try asking:\n• "How much did I spend this month?"\n• "What's my top category?"\n• "How do I save more?"\n• "How do I add an expense?"`;
}

function sendChat(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return;

  state.chat.push({ id: uid(), role: 'user', text: trimmed });
  saveState();
  renderChat();

  setTimeout(() => {
    const reply = lumiReply(trimmed);
    state.chat.push({ id: uid(), role: 'bot', text: reply });
    saveState();
    renderChat();
  }, 420);
}

/* =====================================================
   15. PROFILE / SETTINGS
   ===================================================== */
function renderProfile() {
  $('#profileAvatar').textContent = (state.user.name || 'U').charAt(0).toUpperCase();
  $('#profileName').textContent = state.user.name;
  $('#profileEmail').textContent = state.user.email;
  $('#profileNameInput').value = state.user.name;
  $('#profileEmailInput').value = state.user.email;
  $('#profileCurrency').value = state.user.currency;
  $('#profileTheme').value = state.user.theme;
}

function renderSettings() {
  // Nothing dynamic
}

function refreshUserChip() {
  $('#userNameSide').textContent = state.user.name;
  $('#userEmailSide').textContent = state.user.email;
  $('#userAvatar').textContent = (state.user.name || 'U').charAt(0).toUpperCase();
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.user.theme = theme;
  saveState();
  const btn = $('#themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

/* =====================================================
   16. EMPTY STATE HELPER
   ===================================================== */
function emptyState(icon, title, sub) {
  return `
    <div class="empty">
      <div class="empty-icon">${icon}</div>
      <div class="empty-title">${escapeHtml(title)}</div>
      <div class="empty-sub">${escapeHtml(sub || '')}</div>
    </div>`;
}

/* =====================================================
   17. RENDER ALL
   ===================================================== */
function renderAll() {
  renderDashboard();
  renderTransactions();
  renderBudgets();
  renderGoals();
  renderReports();
  renderChat();
  refreshUserChip();
}

/* =====================================================
   18. EVENT WIRING
   ===================================================== */
function wireEvents() {

  /* ---------- AUTH ---------- */
  $('#loginForm').onsubmit = (e) => {
    e.preventDefault();
    handleLogin($('#loginEmail').value, $('#loginPassword').value);
  };
  $('#signupForm').onsubmit = (e) => {
    e.preventDefault();
    handleSignup(
      $('#signupName').value,
      $('#signupEmail').value,
      $('#signupPassword').value,
      $('#signupConfirm').value
    );
  };
  $('#demoLoginBtn').onclick = handleDemoLogin;

  $('#showSignup').onclick = (e) => {
    e.preventDefault();
    $('#loginForm').classList.add('hidden');
    $('#signupForm').classList.remove('hidden');
  };
  $('#showLogin').onclick = (e) => {
    e.preventDefault();
    $('#signupForm').classList.add('hidden');
    $('#loginForm').classList.remove('hidden');
  };

  /* ---------- NAV ---------- */
  $$('.nav-item').forEach(btn => {
    btn.onclick = () => showPage(btn.dataset.page);
  });
  $$('[data-goto]').forEach(btn => {
    btn.onclick = () => showPage(btn.dataset.goto);
  });
  $('#logoutBtn').onclick = handleLogout;

  $('#menuToggle').onclick = () => $('#sidebar').classList.toggle('open');

  /* ---------- THEME ---------- */
  $('#themeToggle').onclick = () => {
    applyTheme(state.user.theme === 'dark' ? 'light' : 'dark');
  };

  /* ---------- QUICK ADD ---------- */
  $('#quickAddBtn').onclick = () => openTxModal();
  $('#addTxBtn').onclick = () => openTxModal();

  /* ---------- FILTERS ---------- */
  ['#searchInput', '#filterType', '#filterCategory', '#filterRange', '#sortBy']
    .forEach(sel => {
      const el = $(sel);
      if (el) {
        el.oninput = renderTransactions;
        el.onchange = renderTransactions;
      }
    });

  /* ---------- EXPORT ---------- */
  $('#exportCsvBtn').onclick = exportCSV;
  $('#exportAllBtn').onclick = exportCSV;

  /* ---------- BUDGETS / GOALS ---------- */
  $('#addBudgetBtn').onclick = () => openBudgetModal();
  $('#addGoalBtn').onclick = () => openGoalModal();

  /* ---------- REPORTS ---------- */
  $('#reportRange').onchange = renderReports;

  /* ---------- PROFILE FORM ---------- */
  $('#profileForm').onsubmit = (e) => {
    e.preventDefault();
    const name = $('#profileNameInput').value.trim();
    const email = $('#profileEmailInput').value.trim();
    const currency = $('#profileCurrency').value;
    const theme = $('#profileTheme').value;

    if (!name || !email) return toast('Name and email are required', 'error');
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Please enter a valid email', 'error');

    state.user.name = name;
    state.user.email = email;
    state.user.currency = currency;
    saveState();

    applyTheme(theme);
    refreshUserChip();
    renderAll();
    toast('Profile updated', 'success');
  };

  /* ---------- SETTINGS ---------- */
  $('#resetDemoBtn').onclick = () => {
    confirmAction(
      'This will wipe all accounts, transactions, budgets, goals and chat from this browser. Continue?',
      () => {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(SESSION_KEY);
        state = defaultState();
        saveState();
        session = null;
        saveSession();
        showAuthScreen();
        toast('All data reset', 'success');
      }
    );
  };

  /* ---------- MODAL ---------- */
  $('#modalClose').onclick = closeModal;
  $('#modalOverlay').onclick = (e) => {
    if (e.target === $('#modalOverlay')) closeModal();
  };

  /* ---------- CHAT ---------- */
  $('#chatForm').onsubmit = (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    sendChat(input.value);
    input.value = '';
  };
  $$('#chatSuggestions .chip').forEach(chip => {
    chip.onclick = () => sendChat(chip.textContent);
  });

  /* ---------- ESC to close modal ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

/* =====================================================
   19. BOOT
   ===================================================== */
function boot() {
  loadState();
  loadSession();
  wireEvents();

  // Verify the session actually points to a registered account.
  if (session && session.email && findAccount(session.email)) {
    const account = findAccount(session.email);
    state.user = {
      ...state.user,
      name: account.name,
      email: account.email
    };
    saveState();
    showAppScreen();
  } else {
    // No valid session — clear any stale one.
    if (session) {
      session = null;
      saveSession();
    }
    showAuthScreen();
    applyTheme(state.user.theme);
  }
}

document.addEventListener('DOMContentLoaded', boot);