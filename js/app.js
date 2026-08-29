
const MONTHS = [
  "janeiro","fevereiro","março","abril","maio","junho",
  "julho","agosto","setembro","outubro","novembro","dezembro"
];
const MONTHS_SHORT = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];

const DEFAULT_CATEGORIES = [
  "Moradia","Alimentação","Transporte","Lazer","Saúde","Educação","Cartão","Viagem","Pet","Outros"
];

const KEYS = {
  categories: "lc:v3:categories",
  theme: "lc:v3:theme",
  palette: "lc:v4:palette",
  month: "lc:v3:month",
  entriesPrefix: "lc:v3:entries:",
  budgetPrefix: "lc:v3:budget:",
  lastBackup: "lc:v3:lastBackup",
  cards: "lc:v3:cards",
  recurring: "lc:v3:recurring",
  textZoom: "lc:v3:textZoom",
  createdMonths: "lc:v4:createdMonths",
  monthNavigationMigration: "lc:v4:monthNavigationV1"
};
const PAYMENT_LABELS={cash:"Dinheiro",pix:"Pix",debit:"Cartão de débito",credit:"Cartão de crédito",crypto:"Criptomoeda",unspecified:"Não informado"};

const PALETTES = {
  "classic-light": { name: "Clássico (Pergaminho)", dark: false },
  "classic-dark": { name: "Clássico Noturno", dark: true },
  "red-light": { name: "Branco & Vermelho", dark: false },
  "red-dark": { name: "Preto & Carmim", dark: true },
  "rose-light": { name: "Branco & Rosé", dark: false },
  "rose-dark": { name: "Preto & Magenta", dark: true }
};

let categories = [];
let currentDate = new Date();
let entries = [];
let ledgerFilter = "all";
let ledgerStatus = "all";
let ledgerCategory = "all";
let ledgerPayment = "all";
let ledgerSort = "date-desc";
let ledgerSearch = "";
let ledgerDayFilter = null;
let cards = [];
let recurringRules = [];
let isSelectMode = false;
let selectedEntryIds = new Set();

const $ = id => document.getElementById(id);

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), delay);
  };
}

function formatBRL(value){
  return Number(value || 0).toLocaleString("pt-BR", {style:"currency", currency:"BRL"});
}

function formatCompactBRL(value){
  const n = Number(value || 0);
  if(Math.abs(n) >= 1000000) return `R$ ${(n/1000000).toFixed(1).replace(".",",")} mi`;
  if(Math.abs(n) >= 1000) return `R$ ${(n/1000).toFixed(1).replace(".",",")} mil`;
  return formatBRL(n);
}

function dateKey(date){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
}

function todayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function escapeHtml(value=""){
  return String(value).replace(/[&<>"']/g, c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}

function getMonthKey(){
  return dateKey(currentDate);
}

function entryStorageKey(monthKey=getMonthKey()){
  return KEYS.entriesPrefix + monthKey;
}

function budgetStorageKey(monthKey=getMonthKey()){
  return KEYS.budgetPrefix + monthKey;
}

function isValidMonthKey(value){
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value||""));
}

function dateFromMonthKey(monthKey){
  const [year,month] = monthKey.split("-").map(Number);
  return new Date(year,month-1,1);
}

function offsetMonthKey(monthKey,delta){
  const date = dateFromMonthKey(monthKey);
  return dateKey(new Date(date.getFullYear(),date.getMonth()+delta,1));
}

function showToast(message){
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(()=>toast.classList.remove("show"), 1900);
}
globalThis.showToast = showToast;

function loadCategories(){
  try{
    const raw = localStorage.getItem(KEYS.categories);
    categories = raw ? JSON.parse(raw) : [...DEFAULT_CATEGORIES];
    if(!Array.isArray(categories) || !categories.length) categories = [...DEFAULT_CATEGORIES];
  }catch{
    categories = [...DEFAULT_CATEGORIES];
  }
  saveCategories();
}

function saveCategories(){
  localStorage.setItem(KEYS.categories, JSON.stringify(categories));
}

function safeArray(key){
  try{ const value=JSON.parse(localStorage.getItem(key)||"[]"); return Array.isArray(value)?value:[]; }
  catch{ return []; }
}

function explicitlyCreatedMonths(){
  return safeArray(KEYS.createdMonths).filter(isValidMonthKey);
}

function saveExplicitlyCreatedMonths(months){
  const unique = [...new Set(months.filter(isValidMonthKey))].sort();
  localStorage.setItem(KEYS.createdMonths,JSON.stringify(unique));
}

function storedMonthKeys(){
  const months = new Set();
  for(let i=0;i<localStorage.length;i++){
    const key = localStorage.key(i)||"";
    let monthKey = "";
    if(key.startsWith(KEYS.entriesPrefix)) monthKey = key.slice(KEYS.entriesPrefix.length);
    else if(key.startsWith(KEYS.budgetPrefix)) monthKey = key.slice(KEYS.budgetPrefix.length);
    else if(key.startsWith("expenses:")) monthKey = key.slice("expenses:".length);
    if(isValidMonthKey(monthKey)) months.add(monthKey);
  }
  return [...months];
}

function monthHasSavedData(monthKey){
  return localStorage.getItem(entryStorageKey(monthKey)) !== null ||
    localStorage.getItem(budgetStorageKey(monthKey)) !== null ||
    localStorage.getItem(`expenses:${monthKey}`) !== null;
}

function availableMonthKeys(){
  const months = new Set([
    todayISO().slice(0,7),
    ...storedMonthKeys(),
    ...explicitlyCreatedMonths()
  ]);
  return [...months].filter(isValidMonthKey).sort();
}

function cleanupLegacyAutoCreatedFutureMonths(){
  if(localStorage.getItem(KEYS.monthNavigationMigration)) return;

  const currentKey = todayISO().slice(0,7);
  const keys = [];
  for(let i=0;i<localStorage.length;i++) keys.push(localStorage.key(i)||"");

  keys.forEach(key=>{
    if(!key.startsWith(KEYS.entriesPrefix)) return;
    const monthKey = key.slice(KEYS.entriesPrefix.length);
    if(!isValidMonthKey(monthKey) || monthKey<=currentKey) return;

    const monthEntries = safeArray(key);
    const containsOnlyAutomaticEntries = monthEntries.every(entry=>Boolean(entry.recurringId));
    const hasBudget = localStorage.getItem(budgetStorageKey(monthKey)) !== null;
    const hasLegacyEntries = localStorage.getItem(`expenses:${monthKey}`) !== null;

    if(containsOnlyAutomaticEntries && !hasBudget && !hasLegacyEntries){
      localStorage.removeItem(key);
      localStorage.removeItem(`lc:v3:ignoredRec:${monthKey}`);
    }
  });

  const storedMonth = localStorage.getItem(KEYS.month);
  if(isValidMonthKey(storedMonth) && storedMonth>currentKey && !monthHasSavedData(storedMonth)){
    localStorage.setItem(KEYS.month,currentKey);
  }

  localStorage.setItem(KEYS.monthNavigationMigration,"1");
}

function loadPlanningData(){
  cards=safeArray(KEYS.cards);
  recurringRules=safeArray(KEYS.recurring);
}
function saveCards(){ localStorage.setItem(KEYS.cards,JSON.stringify(cards)); }
function saveRecurring(){ localStorage.setItem(KEYS.recurring,JSON.stringify(recurringRules)); }
function uid(prefix="id"){ return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }

function materializeRecurringMonth(monthKey){
  const [year,month]=monthKey.split("-").map(Number);
  const key=entryStorageKey(monthKey);
  let monthEntries=safeArray(key);
  let changed=false;
  const currentKey = todayISO().slice(0,7);
  const ignoredKey = `lc:v3:ignoredRec:${monthKey}`;
  const ignoredRules = safeArray(ignoredKey);

  recurringRules.filter(r=>r.active!==false && monthKey>=r.startDate.slice(0,7)).forEach(rule=>{
    if(monthEntries.some(e=>e.recurringId===rule.id) || ignoredRules.includes(rule.id)) return;
    const day=Math.min(Number(rule.day)||1,new Date(year,month,0).getDate());
    
    // Contas fixas/recorrentes em meses futuros ou despesas iniciam como pendentes (a pagar)
    const initialPaid = false;

    monthEntries.push({
      id: uid("rec"),
      type: rule.type,
      description: rule.description,
      value: Number(rule.value),
      category: rule.category,
      date: `${monthKey}-${String(day).padStart(2,"0")}`,
      note: rule.note||"",
      paymentMethod: rule.paymentMethod||(rule.cardId?"credit":"unspecified"),
      cardId: rule.cardId||"",
      recurringId: rule.id,
      paid: initialPaid,
      createdAt: Date.now()
    });
    changed=true;
  });
  if(changed) localStorage.setItem(key,JSON.stringify(monthEntries));
}

function migrateLegacyMonth(monthKey){
  const newKey = entryStorageKey(monthKey);
  if(localStorage.getItem(newKey)) return;

  const oldKey = `expenses:${monthKey}`;
  const raw = localStorage.getItem(oldKey);
  if(!raw) return;

  try{
    const oldEntries = JSON.parse(raw);
    if(!Array.isArray(oldEntries) || !oldEntries.length) return;

    const migrated = oldEntries.map(item=>({
      id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      type: "expense",
      description: item.desc || item.description || "Despesa",
      value: Number(item.value) || 0,
      category: item.category || "Outros",
      date: item.date || `${monthKey}-01`,
      note: "",
      paid: true,
      createdAt: Date.now()
    })).filter(item=>item.value > 0);

    if(migrated.length){
      localStorage.setItem(newKey, JSON.stringify(migrated));
    }
  }catch{}
}

function loadEntriesForMonth(monthKey){
  migrateLegacyMonth(monthKey);
  try{
    const raw = localStorage.getItem(entryStorageKey(monthKey));
    const arr = raw ? JSON.parse(raw) : [];
    if(!Array.isArray(arr)) return [];
    const currentKey = todayISO().slice(0,7);

    // Preserva o estado já escolhido. Apenas dados antigos sem status recebem um padrão.
    return arr.map(e=>{
      // Criar cópia do item para evitar modificações diretas no localStorage
      const entry = {...e};

      if(typeof entry.paid !== "boolean"){
        const isFutureMonth = monthKey > currentKey;
        entry.paid = isFutureMonth || entry.recurringId ? false : true;
      }
      return entry;
    });
  }catch{
    return [];
  }
}

function deleteEntryById(id, monthKey = getMonthKey()){
  const entry = entries.find(e => e.id === id);
  if(entry && entry.recurringId){
    const ignoredKey = `lc:v3:ignoredRec:${monthKey}`;
    let ignored = safeArray(ignoredKey);
    if(!ignored.includes(entry.recurringId)){
      ignored.push(entry.recurringId);
      localStorage.setItem(ignoredKey, JSON.stringify(ignored));
    }
  }
  entries = entries.filter(e => e.id !== id);
}

function loadMonthData(){
  materializeRecurringMonth(getMonthKey());
  entries = loadEntriesForMonth(getMonthKey());
  ledgerDayFilter = null;
  renderAll();
}

function saveMonthData(){
  localStorage.setItem(entryStorageKey(), JSON.stringify(entries));
}

function getBudget(){
  const raw = localStorage.getItem(budgetStorageKey());
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function saveBudget(value){
  if(value > 0) localStorage.setItem(budgetStorageKey(), String(value));
  else localStorage.removeItem(budgetStorageKey());
}

function calculateTotals(items){
  const incomeItems = items.filter(e=>e.type==="income");
  const expenseItems = items.filter(e=>e.type==="expense");
  const income = incomeItems.reduce((s,e)=>s+Number(e.value||0),0);
  const expense = expenseItems.reduce((s,e)=>s+Number(e.value||0),0);
  return {
    income, expense, balance:income-expense,
    incomeCount:incomeItems.length, expenseCount:expenseItems.length
  };
}

function totals(){ return calculateTotals(entries); }

function previousMonthKey(){
  const d = new Date(currentDate.getFullYear(), currentDate.getMonth()-1, 1);
  return dateKey(d);
}

function percentChange(current, previous){
  if(previous === 0){
    if(current === 0) return {text:"0%", raw:0, comparable:true};
    return {text:"novo", raw:null, comparable:false};
  }
  const raw = ((current-previous)/Math.abs(previous))*100;
  const abs = Math.abs(raw);
  return {text:`${raw>0?"+":raw<0?"−":""}${Math.round(abs)}%`, raw, comparable:true};
}

function renderMonthHeader(){
  const label = `${MONTHS[currentDate.getMonth()]} · ${currentDate.getFullYear()}`;
  $("monthLabel").textContent = label;
  $("ledgerMonthLabel").textContent = label;
  localStorage.setItem(KEYS.month, getMonthKey());
  renderMonthNavigation();
}

function renderMonthNavigation(){
  const months = availableMonthKeys();
  const currentKey = getMonthKey();
  const currentIndex = months.indexOf(currentKey);
  const previousButton = $("prevMonth");
  const nextButton = $("nextMonth");
  const createButton = $("createNextMonthBtn");

  previousButton.disabled = currentIndex<=0;
  nextButton.disabled = currentIndex<0 || currentIndex>=months.length-1;

  const isLatestMonth = currentIndex===months.length-1;
  createButton.hidden = !isLatestMonth;
  if(isLatestMonth){
    const nextKey = offsetMonthKey(currentKey,1);
    const nextDate = dateFromMonthKey(nextKey);
    createButton.textContent = `＋ Criar ${MONTHS[nextDate.getMonth()]} de ${nextDate.getFullYear()}`;
  }
}

function renderSummary(){
  const t = totals();
  $("balanceValue").textContent = formatBRL(t.balance);
  $("incomeValue").textContent = formatBRL(t.income);
  $("expenseValue").textContent = formatBRL(t.expense);
  $("incomeCount").textContent = `${t.incomeCount} entrada${t.incomeCount===1?"":"s"}`;
  $("expenseCount").textContent = `${t.expenseCount} saída${t.expenseCount===1?"":"s"}`;
  $("balanceCaption").textContent = t.balance < 0 ? "saldo negativo" : "disponível no mês";
  $("balanceStamp").classList.toggle("negative", t.balance < 0);

  $("statsBalance").textContent = formatBRL(t.balance);

  const expenseOnly = entries.filter(e=>e.type==="expense");
  if(expenseOnly.length){
    const largest = [...expenseOnly].sort((a,b)=>b.value-a.value)[0];
    $("largestExpense").textContent = formatBRL(largest.value);
    $("largestExpenseDesc").textContent = largest.description;
  }else{
    $("largestExpense").textContent = "—";
    $("largestExpenseDesc").textContent = "sem registros";
  }

  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 0).getDate();
  $("dailyAverage").textContent = formatBRL(daysInMonth ? t.expense/daysInMonth : 0);
  $("weeklyAverage").textContent = formatBRL(t.expense / 4.345);

  if(t.income > 0){
    const rate = ((t.income-t.expense)/t.income)*100;
    $("savingsRate").textContent = `${Math.round(rate)}%`;
    $("savingsRate").style.color = rate >= 0 ? "var(--green)" : "var(--red)";
    $("savingsRateNote").textContent = rate >= 0 ? "percentual preservado dos proventos" : "despesas acima dos proventos";
  }else{
    $("savingsRate").textContent = "—";
    $("savingsRate").style.color = "";
    $("savingsRateNote").textContent = "sem proventos";
  }

  const byCategory = {};
  expenseOnly.forEach(e=>byCategory[e.category]=(byCategory[e.category]||0)+e.value);
  const catEntries = Object.entries(byCategory).sort((a,b)=>b[1]-a[1]);
  if(catEntries.length){
    $("dominantCategory").textContent = catEntries[0][0];
    $("dominantCategoryValue").textContent = formatBRL(catEntries[0][1]);
  }else{
    $("dominantCategory").textContent = "—";
    $("dominantCategoryValue").textContent = "sem despesas";
  }
}

function renderComparison(){
  const current = totals();
  const prev = calculateTotals(loadEntriesForMonth(previousMonthKey()));

  const exp = percentChange(current.expense, prev.expense);
  const inc = percentChange(current.income, prev.income);
  const bal = percentChange(current.balance, prev.balance);

  function apply(el, change, invert=false){
    el.textContent = change.text;
    el.classList.remove("good","bad");
    if(change.raw === null) return;
    if(change.raw === 0) return;
    const good = invert ? change.raw < 0 : change.raw > 0;
    el.classList.add(good ? "good" : "bad");
  }

  apply($("expenseComparison"), exp, true);
  apply($("incomeComparison"), inc, false);
  apply($("balanceComparison"), bal, false);

  const badge = $("comparisonBadge");
  badge.classList.remove("good","bad");
  if(prev.expense===0 && prev.income===0 && prev.balance===0){
    badge.textContent = "sem histórico";
  }else if(current.balance > prev.balance){
    badge.textContent = "saldo melhor";
    badge.classList.add("good");
  }else if(current.balance < prev.balance){
    badge.textContent = "saldo menor";
    badge.classList.add("bad");
  }else{
    badge.textContent = "saldo estável";
  }
}

function renderBudget(){
  const budget = getBudget();
  const expense = totals().expense;

  $("budgetSpent").textContent = `${formatBRL(expense)} gastos`;
  $("budgetLimit").textContent = budget ? `de ${formatBRL(budget)}` : "Sem limite";

  if(!budget){
    $("budgetBar").style.width = "0%";
    $("budgetBar").classList.remove("over");
    $("budgetPercent").textContent = "0% utilizado";
    $("budgetRemaining").textContent = "Defina um orçamento mensal";
    $("editBudgetBtn").textContent = "definir";
    return;
  }

  const percent = (expense/budget)*100;
  $("budgetBar").style.width = `${Math.min(percent,100)}%`;
  $("budgetBar").classList.toggle("over", percent>100);
  $("budgetPercent").textContent = `${Math.round(percent)}% utilizado`;

  const remaining = budget-expense;
  $("budgetRemaining").textContent = remaining>=0
    ? `${formatBRL(remaining)} restantes`
    : `${formatBRL(Math.abs(remaining))} acima do limite`;

  $("editBudgetBtn").textContent = "alterar";
}

function renderCalendar(){
  const container = $("calendarDays");
  container.innerHTML = "";

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const first = new Date(year,month,1);
  const days = new Date(year,month+1,0).getDate();
  const leading = (first.getDay()+6)%7;
  const today = todayISO();

  for(let i=0;i<leading;i++){
    const empty = document.createElement("div");
    empty.className = "calendar-day empty";
    container.appendChild(empty);
  }

  const map = {};
  entries.forEach(e=>{
    const day = Number(e.date.slice(8,10));
    map[day] ||= {income:false,expense:false};
    map[day][e.type] = true;
  });

  for(let day=1; day<=days; day++){
    const iso = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "calendar-day";
    if(iso===today) el.classList.add("today");
    if(map[day]) el.classList.add("has-entry");

    const dots = map[day] ? `
      <span class="day-dots">
        ${map[day].income?'<i class="income"></i>':''}
        ${map[day].expense?'<i class="expense"></i>':''}
      </span>` : '<span class="day-dots"></span>';

    el.innerHTML = `<span>${day}</span>${dots}`;

    if(map[day]){
      el.addEventListener("click", ()=>{
        ledgerDayFilter = iso;
        activateView("ledger");
        renderTransactions();
      });
    }

    container.appendChild(el);
  }
}

function renderCategoryBreakdown(){
  const target = $("categoryBreakdown");
  const expenseOnly = entries.filter(e=>e.type==="expense");

  if(!expenseOnly.length){
    target.innerHTML = `<div class="empty-state">Nenhuma despesa registrada neste mês.</div>`;
    return;
  }

  const byCategory = {};
  expenseOnly.forEach(e=>byCategory[e.category]=(byCategory[e.category]||0)+e.value);
  const rows = Object.entries(byCategory).sort((a,b)=>b[1]-a[1]);
  const max = rows[0][1];

  target.innerHTML = rows.map(([name,value])=>`
    <div class="category-row">
      <div class="category-line">
        <span class="category-name">${escapeHtml(name)}</span>
        <span class="category-dots"></span>
        <span class="category-value">${formatBRL(value)}</span>
      </div>
      <div class="category-bar"><span style="width:${max ? value/max*100 : 0}%"></span></div>
    </div>
  `).join("");
}

function normalizeText(value){
  return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
}

function filteredTransactions(){
  let filtered = [...entries];

  if(ledgerFilter!=="all") filtered = filtered.filter(e=>e.type===ledgerFilter);
  if(ledgerStatus==="paid") filtered = filtered.filter(e=>e.paid!==false);
  if(ledgerStatus==="pending") filtered = filtered.filter(e=>e.paid===false);
  if(ledgerCategory!=="all") filtered = filtered.filter(e=>e.category===ledgerCategory);
  if(ledgerPayment!=="all") filtered = filtered.filter(e=>(e.paymentMethod||(e.cardId?"credit":"unspecified"))===ledgerPayment);
  if(ledgerDayFilter) filtered = filtered.filter(e=>e.date===ledgerDayFilter);

  if(ledgerSearch.trim()){
    const q = normalizeText(ledgerSearch);
    filtered = filtered.filter(e=>
      normalizeText(e.description).includes(q) ||
      normalizeText(e.category).includes(q) ||
      normalizeText(e.note).includes(q)
    );
  }

  filtered.sort((a,b)=>{
    if(ledgerSort==="date-asc"){
      return a.date.localeCompare(b.date) || (a.createdAt||0)-(b.createdAt||0);
    }
    if(ledgerSort==="value-desc"){
      return b.value-a.value || b.date.localeCompare(a.date);
    }
    if(ledgerSort==="value-asc"){
      return a.value-b.value || b.date.localeCompare(a.date);
    }
    return b.date.localeCompare(a.date) || (b.createdAt||0)-(a.createdAt||0);
  });

  return filtered;
}

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), delay);
  };
}

function updateSelectionUI(){
  const count = selectedEntryIds.size;
  if($("selectionCount")) $("selectionCount").textContent = `${count} selecionado${count===1?"":"s"}`;
  if($("deleteCountBadge")) $("deleteCountBadge").textContent = count;
  if($("deleteSelectedBtn")) $("deleteSelectedBtn").disabled = count === 0;
}

function renderTransactions(){
  const list = $("transactionList");
  const filtered = filteredTransactions();

  $("resultsCount").textContent = `${filtered.length} lançamento${filtered.length===1?"":"s"}`;
  const signedTotal = filtered.reduce((sum,e)=>sum+(e.type==="income"?e.value:-e.value),0);
  $("resultsTotal").textContent = `líquido ${formatBRL(signedTotal)}`;

  if(ledgerDayFilter){
    const [y,m,d] = ledgerDayFilter.split("-");
    $("activeFilterNote").hidden = false;
    $("activeFilterText").textContent = `Somente ${d}/${m}/${y}`;
  }else{
    $("activeFilterNote").hidden = true;
  }

  if(list){
    list.classList.toggle("ledger-selecting", isSelectMode);
  }

  if(!filtered.length){
    list.innerHTML = `<div class="empty-state">Nenhum lançamento encontrado com esses filtros.</div>`;
    updateSelectionUI();
    return;
  }

  list.innerHTML = filtered.map(e=>{
    const [y,m,d] = e.date.split("-");
    const monthShort = MONTHS_SHORT[Number(m)-1];
    const sign = e.type==="expense"?"−":"+";
    const card = cards.find(c=>c.id===e.cardId);
    const payment=e.paymentMethod||(e.cardId?"credit":"unspecified");
    const isPaid = e.paid !== false;
    const stampText = isPaid ? "✓ PAGO" : "⏳ A PAGAR";
    const stampClass = isPaid ? "paid" : "pending";
    const isSelected = selectedEntryIds.has(e.id);

    return `
      <div class="tx-row ${isSelected ? 'selected' : ''}" data-entry-id="${escapeHtml(e.id)}">
        <div class="tx-swipe-action tx-action-left">
          <button type="button" class="tx-swipe-btn" data-swipe-edit="${escapeHtml(e.id)}" aria-label="Editar">
            <span>✎</span>
            Editar
          </button>
        </div>

        <article class="tx" data-entry-id="${escapeHtml(e.id)}">
          <label class="tx-check" onclick="event.stopPropagation()">
            <input type="checkbox" data-select-id="${escapeHtml(e.id)}" ${isSelected ? 'checked' : ''}>
          </label>
          <div class="tx-date"><strong>${d}</strong>${monthShort}</div>
          <div class="tx-info">
            <div class="tx-title-row">
              <span class="tx-title">${escapeHtml(e.description)}</span>
              <button type="button" class="stamp-badge ${stampClass}" data-toggle-paid="${escapeHtml(e.id)}" title="Clique para alternar pago/pendente">
                ${stampText}
              </button>
            </div>
            <span class="tx-meta">${escapeHtml(e.category)} · ${PAYMENT_LABELS[payment]||"Não informado"}${card?` · ${escapeHtml(card.name)}`:""}${e.recurringId?` · ${e.type==="income"?"provento fixo":"despesa fixa"}`:""}${e.note?" · com observação":""}</span>
          </div>
          <span class="tx-value ${e.type}">${sign} ${formatBRL(e.value)}</span>
        </article>

        <div class="tx-swipe-action tx-action-right">
          <button type="button" class="tx-swipe-btn" data-swipe-delete="${escapeHtml(e.id)}" aria-label="Apagar">
            <span>🗑</span>
            Apagar
          </button>
        </div>
      </div>`;
  }).join("");

  updateSelectionUI();
}

function renderCategoryControls(){
  const select = $("entryCategory");
  const previous = select.value;
  select.innerHTML = categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  if(categories.includes(previous)) select.value = previous;

  const chips = $("categoryChips");
  chips.innerHTML = categories.map(c=>`
    <span class="category-chip">
      ${escapeHtml(c)}
      <button type="button" data-remove-category="${encodeURIComponent(c)}" aria-label="Remover ${escapeHtml(c)}">×</button>
    </span>
  `).join("");

  const filter = $("categoryFilter");
  const prevFilter = ledgerCategory;
  filter.innerHTML = `<option value="all">Todas</option>` +
    categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  filter.value = categories.includes(prevFilter) ? prevFilter : "all";

  const cardSelect=$("entryCard");
  const selected=cardSelect.value;
  cardSelect.innerHTML='<option value="">Selecione um cartão</option>'+cards.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("");
  if(cards.some(c=>c.id===selected)) cardSelect.value=selected;
}

function allStoredEntries(){
  const result=[];
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i)||"";
    if(!key.startsWith(KEYS.entriesPrefix)) continue;
    safeArray(key).forEach(entry=>result.push(entry));
  }
  return result;
}

function renderPlanning(){
  const cardTarget=$("creditCardList");
  if(!cards.length) cardTarget.innerHTML='<div class="empty-planning">Nenhum cartão cadastrado. Adicione quantos precisar.</div>';
  else cardTarget.innerHTML=cards.map(card=>{
    const spent=entries.filter(e=>e.type==="expense"&&e.cardId===card.id).reduce((sum,e)=>sum+Number(e.value||0),0);
    const available=Number(card.limit||0)-spent;
    return `<article class="credit-card-item" data-card-id="${escapeHtml(card.id)}"><header><div><small>Cartão de crédito</small><h3>${escapeHtml(card.name)}</h3></div><strong>${formatBRL(spent)}</strong></header><div class="card-numbers"><span>Fecha<strong>dia ${card.closingDay}</strong></span><span>Vence<strong>dia ${card.dueDay}</strong></span>${card.limit?`<span>Disponível<strong>${formatBRL(available)}</strong></span>`:""}</div></article>`;
  }).join("");

  const recurringTarget=$("recurringList");
  const activeRules=recurringRules.filter(r=>r.active!==false);
  recurringTarget.innerHTML=activeRules.length?activeRules.map(rule=>`<article class="planning-item"><span class="planning-date"><strong>${String(rule.day).padStart(2,"0")}</strong>todo mês</span><span class="planning-copy"><strong>${escapeHtml(rule.description)}</strong><small>${escapeHtml(rule.category)} · ${PAYMENT_LABELS[rule.paymentMethod||(rule.cardId?"credit":"unspecified")]} · <span class="recurring-badge">${rule.type==="income"?"provento fixo":"despesa fixa"}</span></small></span><strong class="planning-value">${rule.type==="income"?"+":"−"} ${formatBRL(rule.value)}</strong><span class="planning-actions"><button class="mini-action" type="button" data-stop-recurring="${escapeHtml(rule.id)}">cancelar recorrência</button></span></article>`).join(""):'<div class="empty-planning">Nenhum lançamento fixo ativo.</div>';

  const currentKey=getMonthKey();
  const future=allStoredEntries().filter(e=>e.date&&e.date.slice(0,7)>currentKey).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,30);
  const futureTarget=$("futureList");
  futureTarget.innerHTML=future.length?future.map(e=>{const [y,m,d]=e.date.split("-");const payment=e.paymentMethod||(e.cardId?"credit":"unspecified");return `<article class="planning-item"><span class="planning-date"><strong>${d}</strong>${MONTHS_SHORT[Number(m)-1]} ${y}</span><span class="planning-copy"><strong>${escapeHtml(e.description)}</strong><small>${escapeHtml(e.category)} · ${PAYMENT_LABELS[payment]} · <span class="future-badge">futuro</span></small></span><strong class="planning-value">${e.type==="income"?"+":"−"} ${formatBRL(e.value)}</strong></article>`}).join(""):'<div class="empty-planning">Nenhum lançamento futuro cadastrado.</div>';
}

function openCardModal(card=null){
  $("cardModal").hidden=false; document.body.classList.add("modal-open");
  $("cardId").value=card?.id||""; $("cardName").value=card?.name||""; $("cardClosingDay").value=card?.closingDay||""; $("cardDueDay").value=card?.dueDay||""; $("cardLimit").value=card?.limit||"";
  $("cardModalTitle").textContent=card?"Editar cartão":"Novo cartão"; $("deleteCardBtn").hidden=!card;
  setTimeout(()=>$("cardName").focus(),50);
}
function closeCardModal(){ $("cardModal").hidden=true; document.body.classList.remove("modal-open"); }

function getLastMonths(count=6){
  const out = [];
  for(let i=count-1;i>=0;i--){
    const d = new Date(currentDate.getFullYear(),currentDate.getMonth()-i,1);
    out.push({date:d,key:dateKey(d),label:MONTHS_SHORT[d.getMonth()]});
  }
  return out;
}

function renderExpenseHistory(){
  const target = $("expenseHistoryChart");
  const months = getLastMonths(6).map(m=>{
    const t = calculateTotals(loadEntriesForMonth(m.key));
    return {...m, expense:t.expense};
  });
  const max = Math.max(...months.map(m=>m.expense),0);

  target.innerHTML = months.map(m=>{
    const pct = max ? (m.expense/max)*100 : 0;
    return `
      <div class="history-column">
        <span class="history-value">${m.expense ? formatCompactBRL(m.expense) : "R$ 0"}</span>
        <div class="history-bar-wrap">
          <span class="history-bar" style="height:${Math.max(pct, m.expense?3:1)}%"></span>
        </div>
        <span class="history-label">${m.label}</span>
      </div>`;
  }).join("");
}

function renderDonut(){
  const expenseOnly = entries.filter(e=>e.type==="expense");
  const total = expenseOnly.reduce((s,e)=>s+e.value,0);
  $("donutTotal").textContent = formatCompactBRL(total);

  const byCategory = {};
  expenseOnly.forEach(e=>byCategory[e.category]=(byCategory[e.category]||0)+e.value);
  const rows = Object.entries(byCategory).sort((a,b)=>b[1]-a[1]);

  if(!rows.length){
    $("categoryDonut").style.background = "conic-gradient(var(--line) 0 100%)";
    $("donutLegend").innerHTML = `<div class="empty-state">Sem despesas neste mês.</div>`;
    return;
  }

  const palette = ["#2f6f4e","#a6342a","#b8933f","#6b5f4f","#7b624a","#58705c","#8c4e46","#9a7a3d"];
  let cursor = 0;
  const stops = [];
  rows.forEach(([name,value],idx)=>{
    const pct = total ? (value/total)*100 : 0;
    const start = cursor;
    cursor += pct;
    const color = palette[idx % palette.length];
    stops.push(`${color} ${start}% ${cursor}%`);
  });
  $("categoryDonut").style.background = `conic-gradient(${stops.join(",")})`;

  $("donutLegend").innerHTML = rows.slice(0,8).map(([name,value],idx)=>`
    <div class="legend-row">
      <i class="legend-swatch" style="background:${palette[idx%palette.length]}"></i>
      <span>${escapeHtml(name)}</span>
      <strong>${Math.round(total?value/total*100:0)}%</strong>
    </div>
  `).join("");
}

function renderTopDays(){
  const target = $("topExpenseDays");
  const byDay = {};

  entries.filter(e=>e.type==="expense").forEach(e=>{
    byDay[e.date] = (byDay[e.date]||0)+e.value;
  });

  const rows = Object.entries(byDay).sort((a,b)=>b[1]-a[1]).slice(0,5);

  if(!rows.length){
    target.innerHTML = `<div class="empty-state">Ainda não há despesas para comparar.</div>`;
    return;
  }

  const max = rows[0][1];
  target.innerHTML = rows.map(([date,value])=>{
    const [y,m,d] = date.split("-");
    return `
      <div class="top-day-row">
        <span class="top-day-date">${d}/${m}</span>
        <div class="top-day-bar"><span style="width:${max?value/max*100:0}%"></span></div>
        <strong class="top-day-value">${formatBRL(value)}</strong>
      </div>`;
  }).join("");
}

function renderAnalytics(){
  renderExpenseHistory();
  renderDonut();
  renderTopDays();
}

function renderAll(){
  renderMonthHeader();
  renderSummary();
  renderComparison();
  renderBudget();
  renderCalendar();
  renderCategoryBreakdown();
  renderCategoryControls();
  renderTransactions();
  renderAnalytics();
  renderPlanning();
  $("budgetInput").value = getBudget() || "";
}

function animateMonth(){
  const page = $("view-home");
  page.classList.remove("page-shift");
  void page.offsetWidth;
  page.classList.add("page-shift");
}

function changeMonth(delta){
  const months = availableMonthKeys();
  const currentIndex = months.indexOf(getMonthKey());
  const targetKey = months[currentIndex+delta];

  if(!targetKey){
    showToast(delta>0 ? "Crie o próximo mês para avançar." : "Não há mês anterior criado.");
    renderMonthNavigation();
    return;
  }

  currentDate = dateFromMonthKey(targetKey);
  loadMonthData();
  animateMonth();
}

function createNextMonth(){
  const nextKey = offsetMonthKey(getMonthKey(),1);
  const createdMonths = explicitlyCreatedMonths();
  if(!createdMonths.includes(nextKey)){
    createdMonths.push(nextKey);
    saveExplicitlyCreatedMonths(createdMonths);
  }

  currentDate = dateFromMonthKey(nextKey);
  loadMonthData();
  animateMonth();
  showToast(`Mês de ${MONTHS[currentDate.getMonth()]} criado.`);
}

function activateView(target){
  document.querySelectorAll(".nav-item").forEach(item=>{
    item.classList.toggle("active",item.dataset.target===target);
  });
  document.querySelectorAll(".paper-page").forEach(view=>{
    view.classList.toggle("active-view",view.dataset.view===target);
  });
  window.scrollTo({top:0,behavior:"smooth"});
}

function setEntryType(type){
  $("entryType").value = type;
  document.querySelectorAll(".segment").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.type===type);
  });
  $("recurringLabel").textContent=type==="income"?"Provento fixo mensal":"Despesa fixa mensal";
}

function updateCardField(){
  const credit=$("entryPayment").value==="credit";
  $("entryCardField").hidden=!credit;
  if(!credit) $("entryCard").value="";
}

function openEntryModal(entry=null,defaultDate=null){
  $("entryModal").hidden = false;
  document.body.classList.add("modal-open");

  if(entry){
    $("entryModalTitle").textContent = "Editar lançamento";
    if($("entrySubmitBtn")) $("entrySubmitBtn").textContent = "Salvar alterações";
    $("entryId").value = entry.id;
    $("entryDescription").value = entry.description;
    $("entryValue").value = entry.value;
    $("entryDate").value = entry.date;
    $("entryNote").value = entry.note || "";
    $("entryPayment").value = entry.paymentMethod || (entry.cardId ? "credit" : "cash");
    $("entryCard").value = entry.cardId || "";
    updateCardField();
    if($("entryPaid")) $("entryPaid").checked = entry.paid !== false;
    $("entryRecurring").checked = false;

    $("recurringField").hidden = true;
    setEntryType(entry.type);

    if(!categories.includes(entry.category)){
      categories.push(entry.category);
      saveCategories();
      renderCategoryControls();
    }
    $("entryCategory").value = entry.category;
    $("deleteEntryBtn").hidden = false;
  }else{
    $("entryModalTitle").textContent = "Novo lançamento";
    if($("entrySubmitBtn")) $("entrySubmitBtn").textContent = "Carimbar lançamento";
    $("entryForm").reset();
    $("entryId").value = "";
    if($("entryPaid")) $("entryPaid").checked = true;
    $("entryDate").value = defaultDate || (
      getMonthKey()===todayISO().slice(0,7) ? todayISO() : `${getMonthKey()}-01`
    );
    setEntryType("expense");
    $("deleteEntryBtn").hidden = true;
    $("recurringField").hidden = false;
    $("entryRecurring").checked = false;
    if(categories.length) $("entryCategory").value = categories[0];
  }

  setTimeout(()=>$("entryDescription").focus(),50);
}
globalThis.openEntryModal = openEntryModal;

function closeEntryModal(){
  $("entryModal").hidden = true;
  document.body.classList.remove("modal-open");
}

function openBudgetModal(){
  $("budgetModal").hidden = false;
  document.body.classList.add("modal-open");
  $("budgetModalMonth").textContent = `${MONTHS[currentDate.getMonth()]} de ${currentDate.getFullYear()}`;
  $("budgetModalInput").value = getBudget() || "";
  setTimeout(()=>$("budgetModalInput").focus(),50);
}

function closeBudgetModal(){
  $("budgetModal").hidden = true;
  document.body.classList.remove("modal-open");
}

function saveEntryFromForm(event){
  event.preventDefault();

  const value = Number($("entryValue").value);
  const description = $("entryDescription").value.trim();
  const date = $("entryDate").value;
  const type = $("entryType").value;
  const category = $("entryCategory").value;
  const note = $("entryNote").value.trim();
  const id = $("entryId").value;
  const paymentMethod = $("entryPayment").value;
  const cardId = paymentMethod==="credit" ? $("entryCard").value : "";
  const makeRecurring = $("entryRecurring").checked && !id;
  const paid = $("entryPaid") ? $("entryPaid").checked : true;

  if(!description || !date || !category || !Number.isFinite(value) || value<=0){
    showToast("Preencha os campos obrigatórios.");
    return;
  }
  if(paymentMethod==="credit" && !cardId){ showToast("Selecione ou cadastre um cartão de crédito."); return; }

  let existingRecurringId = "";
  let existingCreatedAt = Date.now();
  if(id){
    const existing = entries.find(e=>e.id===id);
    if(existing){
      existingRecurringId = existing.recurringId || "";
      existingCreatedAt = existing.createdAt || Date.now();
    }
  }

  const entryMonth = date.slice(0,7);
  const newEntry = {
    id:id || `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    type,
    description,
    value,
    category,
    date,
    note,
    paymentMethod,
    cardId,
    paid,
    recurringId: existingRecurringId,
    createdAt: existingCreatedAt
  };

  if(makeRecurring){
    const rule={id:uid("rule"),type,description,value,category,note,paymentMethod,cardId,day:Number(date.slice(8,10)),startDate:date,active:true,createdAt:Date.now()};
    recurringRules.push(rule); saveRecurring(); newEntry.recurringId=rule.id;
  }

  if(entryMonth===getMonthKey()){
    const idx = entries.findIndex(e=>e.id===id);
    if(idx>=0){
      entries[idx] = newEntry;
    }else{
      entries.push(newEntry);
    }
    saveMonthData();
  }else{
    migrateLegacyMonth(entryMonth);
    let other = [];
    try{
      other = JSON.parse(localStorage.getItem(entryStorageKey(entryMonth)) || "[]");
      if(!Array.isArray(other)) other = [];
    }catch{ other=[]; }

    if(id){
      entries = entries.filter(e=>e.id!==id);
      saveMonthData();
      const otherIdx = other.findIndex(e=>e.id===id);
      if(otherIdx>=0) other[otherIdx]=newEntry;
      else other.push(newEntry);
    }else{
      other.push(newEntry);
    }
    localStorage.setItem(entryStorageKey(entryMonth),JSON.stringify(other));
  }

  closeEntryModal();
  loadMonthData();

  const stamp = type==="expense" ? document.querySelector(".stamp-expense") : document.querySelector(".stamp-income");
  stamp.classList.remove("stamp-hit");
  void stamp.offsetWidth;
  stamp.classList.add("stamp-hit");

  showToast(id ? "Alterações salvas." : "Lançamento registrado.");
}

function deleteCurrentEntry(){
  const id = $("entryId").value;
  if(!id) return;
  if(!confirm("Excluir este lançamento?")) return;

  deleteEntryById(id, getMonthKey());
  saveMonthData();
  closeEntryModal();
  loadMonthData();
  showToast("Lançamento excluído.");
}

function saveBudgetFromValue(rawValue){
  const value = Number(rawValue);
  if(!Number.isFinite(value) || value<0){
    showToast("Informe um valor válido.");
    return false;
  }
  saveBudget(value);
  renderBudget();
  $("budgetInput").value = value || "";
  return true;
}


function allRelevantStorage(){
  const data = {};
  for(let i=0;i<localStorage.length;i++){
    const key = localStorage.key(i);
    if(!key) continue;
    if(
      key.startsWith("lc:v3:") ||
      key.startsWith("expenses:") ||
      key === "categories"
    ){
      data[key] = localStorage.getItem(key);
    }
  }
  return data;
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1200);
}

function backupStamp(){
  return new Date().toISOString().slice(0,10);
}

function renderLastBackup(){
  const raw = localStorage.getItem(KEYS.lastBackup);
  if(!raw){
    $("lastBackupNote").textContent = "Nenhum backup exportado neste aparelho ainda.";
    return;
  }
  const d = new Date(raw);
  const label = Number.isNaN(d.getTime())
    ? raw
    : d.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"});
  $("lastBackupNote").textContent = `Último backup exportado: ${label}.`;
}

function exportBackup(){
  const payload = {
    app: "Livro Caixa",
    version: "4.0.1",
    exportedAt: new Date().toISOString(),
    storage: allRelevantStorage()
  };
  const blob = new Blob(
    [JSON.stringify(payload,null,2)],
    {type:"application/json;charset=utf-8"}
  );
  downloadBlob(blob, `livro-caixa-backup-${backupStamp()}.json`);
  localStorage.setItem(KEYS.lastBackup, new Date().toISOString());
  renderLastBackup();
  showToast("Backup exportado.");
}

function importBackupFile(file){
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const parsed = JSON.parse(reader.result);
      const storage = parsed && parsed.storage && typeof parsed.storage==="object"
        ? parsed.storage
        : parsed;

      if(!storage || typeof storage!=="object" || Array.isArray(storage)){
        throw new Error("Formato inválido");
      }

      const allowed = Object.entries(storage).filter(([key,value])=>
        typeof value === "string" &&
        (
          key.startsWith("lc:v3:") ||
          key.startsWith("expenses:") ||
          key === "categories"
        )
      );

      if(!allowed.length){
        throw new Error("Nenhum dado reconhecido");
      }

      if(!confirm("Importar este backup substituirá dados com as mesmas chaves. Continuar?")){
        return;
      }

      allowed.forEach(([key,value])=>localStorage.setItem(key,value));
       // Migrate any legacy entries from "expenses:" to new format
       for(let i=0;i<localStorage.length;i++){
         const lkey = localStorage.key(i);
         if(lkey && lkey.startsWith("expenses:")){
           migrateLegacyMonth(lkey.slice("expenses:".length));
         }
       }
       loadMonthData();
      loadCategories();

      const stored = localStorage.getItem(KEYS.month);
      if(stored && /^\d{4}-\d{2}$/.test(stored)){
        const [y,m] = stored.split("-").map(Number);
        currentDate = new Date(y,m-1,1);
      }

      loadMonthData();
      renderLastBackup();
      showToast("Backup importado com sucesso.");
    }catch(err){
      showToast("Arquivo de backup inválido.");
    }finally{
      $("backupFileInput").value = "";
    }
  };
  reader.readAsText(file);
}

function csvCell(value){
  const text = String(value ?? "");
  return `"${text.replace(/"/g,'""')}"`;
}

function collectAllEntries(){
  const months = new Set();
  for(let i=0;i<localStorage.length;i++){
    const key = localStorage.key(i);
    if(!key) continue;
    if(key.startsWith(KEYS.entriesPrefix)){
      months.add(key.slice(KEYS.entriesPrefix.length));
    }else if(key.startsWith("expenses:")){
      months.add(key.slice("expenses:".length));
    }
  }

  months.add(getMonthKey());

  const all = [];
  [...months].sort().forEach(monthKey=>{
    loadEntriesForMonth(monthKey).forEach(e=>{
      all.push({...e,monthKey});
    });
  });
  return all;
}

function exportCsv(){
  const all = collectAllEntries().sort((a,b)=>a.date.localeCompare(b.date));
  if(!all.length){
    showToast("Não há lançamentos para exportar.");
    return;
  }

  const rows = [
    ["Data","Mês","Tipo","Descrição","Categoria","Forma de pagamento","Cartão","Valor","Observação"]
  ];

  all.forEach(e=>{
    rows.push([
      e.date,
      e.monthKey,
      e.type==="income" ? "Provento" : "Despesa",
      e.description,
      e.category,
      PAYMENT_LABELS[e.paymentMethod||(e.cardId?"credit":"unspecified")] || "Não informado",
      (cards.find(c=>c.id===e.cardId)||{}).name || "",
      Number(e.value||0).toFixed(2).replace(".",","),
      e.note || ""
    ]);
  });

  const csv = "\ufeff" + rows.map(row=>row.map(csvCell).join(";")).join("\r\n");
  downloadBlob(
    new Blob([csv],{type:"text/csv;charset=utf-8"}),
    `livro-caixa-lancamentos-${backupStamp()}.csv`
  );
  showToast("CSV exportado.");
}

function buildReportPreview(){
  const t = totals();
  const label = `${MONTHS[currentDate.getMonth()]} de ${currentDate.getFullYear()}`;

  const sorted = [...entries].sort((a,b)=>
    a.date.localeCompare(b.date) || (a.createdAt||0)-(b.createdAt||0)
  );

  const rows = sorted.map(e=>{
    const [y,m,d] = e.date.split("-");
    return `
      <tr>
        <td>${d}/${m}/${y}</td>
        <td>${escapeHtml(e.description)}</td>
        <td>${escapeHtml(e.category)}</td>
        <td>${e.type==="income"?"Provento":"Despesa"}</td>
        <td>${PAYMENT_LABELS[e.paymentMethod||(e.cardId?"credit":"unspecified")]||"Não informado"}</td>
        <td>${e.type==="income"?"+":"−"} ${formatBRL(e.value)}</td>
      </tr>`;
  }).join("");

  $("reportPreview").innerHTML = `
    <div class="report-head">
      <h3>Livro Caixa</h3>
      <p>Relatório mensal · ${label}</p>
    </div>

    <div class="report-summary">
      <div><span>Proventos</span><strong>${formatBRL(t.income)}</strong></div>
      <div><span>Despesas</span><strong>${formatBRL(t.expense)}</strong></div>
      <div><span>Saldo</span><strong>${formatBRL(t.balance)}</strong></div>
    </div>

    ${
      rows
      ? `<table class="report-table">
          <thead>
            <tr>
              <th>Data</th><th>Descrição</th><th>Categoria</th><th>Tipo</th><th>Pagamento</th><th>Valor</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`
      : `<div class="report-empty">Nenhum lançamento neste mês.</div>`
    }
  `;
}

function openReport(){
  buildReportPreview();
  $("reportModal").hidden = false;
  document.body.classList.add("modal-open");
}

function closeReport(){
  $("reportModal").hidden = true;
  document.body.classList.remove("modal-open");
}

async function shareApp(){
  const APP_URL = "https://stack-error404.github.io/controle-gastos/";
  const shareText = `Livro Caixa — controle financeiro pessoal\n${APP_URL}`;

  try{
    if(navigator.share){
      await navigator.share({
        title: "Livro Caixa",
        text: shareText,
        url: APP_URL
      });
      return;
    }

    if(navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(APP_URL);
      showToast("Link do app copiado.");
      return;
    }

    prompt("Copie o endereço do aplicativo:", APP_URL);
  }catch(err){
    if(err && err.name === "AbortError") return;

    try{
      if(navigator.clipboard && window.isSecureContext){
        await navigator.clipboard.writeText(APP_URL);
        showToast("Link do app copiado.");
      }else{
        prompt("Copie o endereço do aplicativo:", APP_URL);
      }
    }catch{
      prompt("Copie o endereço do aplicativo:", APP_URL);
    }
  }
}

function updatePwaStatus(){
  const online = navigator.onLine;
  const dot = $("connectionDot");
  dot.classList.toggle("online",online);
  dot.classList.toggle("offline",!online);

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  $("pwaStatus").textContent = standalone
    ? (online ? "Instalado · online" : "Instalado · offline")
    : (online ? "No navegador · online" : "No navegador · offline");
}

async function refreshApp(){
  showToast("Buscando atualização e limpando cache…");
  try{
    if("serviceWorker" in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.update()));
    }
    if("caches" in window){
      const keys = await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
  }catch{}
  setTimeout(()=>location.reload(),400);
}

function applyTextZoom(value,announce=false){
  const allowed=[0.85,1,1.15,1.3];
  const zoom=allowed.includes(Number(value))?Number(value):1;
  document.body.style.setProperty("--text-zoom",String(zoom));
  localStorage.setItem(KEYS.textZoom,String(zoom));
  $("zoomValue").textContent=`${Math.round(zoom*100)}%`;
  $("zoomOutBtn").disabled=zoom===allowed[0];
  $("zoomInBtn").disabled=zoom===allowed[allowed.length-1];
  if(announce) showToast(`Tamanho das letras: ${Math.round(zoom*100)}%.`);
}

function changeTextZoom(delta){
  const allowed=[0.85,1,1.15,1.3];
  const current=Number(localStorage.getItem(KEYS.textZoom)||1);
  const idx=Math.max(0,allowed.indexOf(current));
  applyTextZoom(allowed[Math.max(0,Math.min(allowed.length-1,idx+delta))],true);
}

/* Eventos das ferramentas finais */
$("exportBackupBtn").addEventListener("click",exportBackup);

$("importBackupBtn").addEventListener("click",()=>{
  $("backupFileInput").click();
});

$("backupFileInput").addEventListener("change",e=>{
  const file = e.target.files && e.target.files[0];
  if(file) importBackupFile(file);
});

$("exportCsvBtn").addEventListener("click",exportCsv);
$("printPdfBtn").addEventListener("click",openReport);
$("closeReportBtn").addEventListener("click",closeReport);
$("printReportBtn").addEventListener("click",()=>window.print());

document.querySelectorAll("[data-close-report]").forEach(btn=>{
  btn.addEventListener("click",closeReport);
});

$("reportModal").addEventListener("click",e=>{
  if(e.target === $("reportModal")) closeReport();
});

$("shareAppBtn").addEventListener("click",shareApp);
$("refreshAppBtn").addEventListener("click",refreshApp);
$("entryPayment").addEventListener("change",updateCardField);
$("zoomOutBtn").addEventListener("click",()=>changeTextZoom(-1));
$("zoomInBtn").addEventListener("click",()=>changeTextZoom(1));
$("zoomResetBtn").addEventListener("click",()=>applyTextZoom(1,true));

$("addCardBtn").addEventListener("click",()=>openCardModal());
document.querySelectorAll("[data-close-card]").forEach(btn=>btn.addEventListener("click",closeCardModal));
$("cardModal").addEventListener("click",e=>{ if(e.target===$("cardModal")) closeCardModal(); });
$("creditCardList").addEventListener("click",e=>{ const row=e.target.closest("[data-card-id]"); if(row) openCardModal(cards.find(c=>c.id===row.dataset.cardId)); });
$("cardForm").addEventListener("submit",e=>{
  e.preventDefault();
  const id=$("cardId").value; const name=$("cardName").value.trim(); const closingDay=Number($("cardClosingDay").value); const dueDay=Number($("cardDueDay").value); const limit=Number($("cardLimit").value)||0;
  if(!name||closingDay<1||closingDay>31||dueDay<1||dueDay>31){ showToast("Confira os dados do cartão."); return; }
  const card={id:id||uid("card"),name,closingDay,dueDay,limit}; const idx=cards.findIndex(c=>c.id===id); if(idx>=0) cards[idx]=card; else cards.push(card);
  saveCards(); closeCardModal(); renderCategoryControls(); renderPlanning(); showToast(id?"Cartão atualizado.":"Cartão adicionado.");
});
$("deleteCardBtn").addEventListener("click",()=>{
  const id=$("cardId").value; if(!id||!confirm("Excluir este cartão? Os lançamentos existentes serão preservados.")) return;
  cards=cards.filter(c=>c.id!==id); saveCards(); closeCardModal(); renderCategoryControls(); renderPlanning(); showToast("Cartão excluído.");
});
$("recurringList").addEventListener("click",e=>{
  const btn=e.target.closest("[data-stop-recurring]"); if(!btn||!confirm("Cancelar os próximos lançamentos desta conta fixa?")) return;
  const rule=recurringRules.find(r=>r.id===btn.dataset.stopRecurring); if(rule) rule.active=false;
  const currentKey=getMonthKey();
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i)||""; if(!key.startsWith(KEYS.entriesPrefix)) continue;
    const monthKey=key.slice(KEYS.entriesPrefix.length); if(monthKey<=currentKey) continue;
    const kept=safeArray(key).filter(entry=>entry.recurringId!==btn.dataset.stopRecurring); localStorage.setItem(key,JSON.stringify(kept));
  }
  saveRecurring(); renderPlanning(); showToast("Recorrência cancelada.");
});

window.addEventListener("online",updatePwaStatus);
window.addEventListener("offline",updatePwaStatus);

renderLastBackup();
updatePwaStatus();


/* Paletas de Cores & Temas */
function setPalette(paletteId, notify = true){
  if(!PALETTES[paletteId]) paletteId = "classic-light";
  document.body.classList.remove(
    "theme-classic-light",
    "theme-classic-dark",
    "theme-red-light",
    "theme-red-dark",
    "theme-rose-light",
    "theme-rose-dark",
    "dark"
  );
  document.body.classList.add(`theme-${paletteId}`);
  if(PALETTES[paletteId].dark){
    document.body.classList.add("dark");
  }
  localStorage.setItem(KEYS.palette, paletteId);
  localStorage.setItem(KEYS.theme, PALETTES[paletteId].dark ? "dark" : "light");

  document.querySelectorAll(".palette-card").forEach(card=>{
    card.classList.toggle("active", card.dataset.palette === paletteId);
  });
  const label = $("activePaletteLabel");
  if(label) label.textContent = `Paleta ativa: ${PALETTES[paletteId].name}`;

  if(notify){
    showToast(`Paleta "${PALETTES[paletteId].name}" aplicada.`);
  }
}

function openPaletteModal(){
  const modal = $("paletteModal");
  if(!modal) return;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  const current = localStorage.getItem(KEYS.palette) || (document.body.classList.contains("dark") ? "classic-dark" : "classic-light");
  document.querySelectorAll(".palette-card").forEach(card=>{
    card.classList.toggle("active", card.dataset.palette === current);
  });
}

function closePaletteModal(){
  const modal = $("paletteModal");
  if(!modal) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

/* Alternar status Pago / A Pagar com carimbo */
function toggleEntryPaid(entryId, e = null){
  if(e){
    e.stopPropagation();
    e.preventDefault();
  }
  const entry = entries.find(item => item.id === entryId);
  if(!entry) return;
  entry.paid = entry.paid === false;
  saveMonthData();
  renderTransactions();

  if(entry.paid){
    showToast("✓ Lançamento carimbado como PAGO.");
  }else{
    showToast("⏳ Lançamento marcado como A PAGAR.");
  }
}

/* Gestos de Arrastar pro Lado (Swipe estilo Gmail) & Seleção */
function toggleSelectMode(){
  isSelectMode = !isSelectMode;
  selectedEntryIds.clear();
  if($("selectionBar")) $("selectionBar").hidden = !isSelectMode;
  if($("toggleSelectModeBtn")) $("toggleSelectModeBtn").textContent = isSelectMode ? "cancelar" : "selecionar";
  renderTransactions();
}

function exitSelectMode(){
  isSelectMode = false;
  selectedEntryIds.clear();
  if($("selectionBar")) $("selectionBar").hidden = true;
  if($("toggleSelectModeBtn")) $("toggleSelectModeBtn").textContent = "selecionar";
  renderTransactions();
}

function toggleEntrySelection(id){
  if(selectedEntryIds.has(id)){
    selectedEntryIds.delete(id);
  }else{
    selectedEntryIds.add(id);
  }
  renderTransactions();
}

function selectAllFilteredEntries(){
  const filtered = filteredTransactions();
  if(selectedEntryIds.size === filtered.length){
    selectedEntryIds.clear();
  }else{
    filtered.forEach(e => selectedEntryIds.add(e.id));
  }
  renderTransactions();
}

function deleteSelectedEntries(){
  if(selectedEntryIds.size === 0) return;
  const count = selectedEntryIds.size;
  if(!confirm(`Excluir os ${count} lançamento${count===1?"":"s"} selecionado${count===1?"":"s"}?`)) return;

  const monthKey = getMonthKey();
  selectedEntryIds.forEach(id => {
    deleteEntryById(id, monthKey);
  });

  saveMonthData();
  exitSelectMode();
  loadMonthData();
  showToast(`${count} lançamento${count===1?"":"s"} excluído${count===1?"":"s"}.`);
}

function setupSwipeGestures(){
  const list = $("transactionList");
  if(!list || list._swipeBound) return;
  list._swipeBound = true;

  let activeTx = null;
  let startX = 0;
  let startY = 0;
  let currentDiffX = 0;
  let isSwiping = false;
  let isHorizontal = null;

  const closeActiveSwipe = (exceptTx = null)=>{
    list.querySelectorAll(".tx.swiped-left, .tx.swiped-right").forEach(el=>{
      if(el !== exceptTx){
        el.classList.remove("swiped-left", "swiped-right", "swiping");
        el.style.transform = "";
      }
    });
  };

  const handleStart = (clientX, clientY, target)=>{
    if(isSelectMode) return;
    if(target.closest("[data-toggle-paid]") || target.closest(".tx-swipe-btn") || target.closest(".tx-swipe-action") || target.closest(".tx-check")) return;

    const tx = target.closest(".tx");
    if(!tx) return;

    activeTx = tx;
    startX = clientX;
    startY = clientY;
    currentDiffX = 0;
    isSwiping = false;
    isHorizontal = null;

    closeActiveSwipe(tx);
  };

  const handleMove = (clientX, clientY)=>{
    if(isSelectMode || !activeTx) return;
    const diffX = clientX - startX;
    const diffY = clientY - startY;

    if(isHorizontal === null){
      if(Math.abs(diffX) > 6 || Math.abs(diffY) > 6){
        isHorizontal = Math.abs(diffX) > Math.abs(diffY);
      }
    }

    if(!isHorizontal) return;

    isSwiping = true;
    activeTx.classList.add("swiping");

    let moveX = diffX;
    if(moveX > 78) moveX = 78 + (moveX - 78) * 0.3;
    if(moveX < -78) moveX = -78 + (moveX + 78) * 0.3;

    currentDiffX = moveX;
    activeTx.style.transform = `translateX(${moveX}px)`;
  };

  const handleEnd = ()=>{
    if(!activeTx) return;
    activeTx.classList.remove("swiping");

    if(isSwiping){
      if(currentDiffX > 45){
        activeTx.classList.remove("swiped-left");
        activeTx.classList.add("swiped-right");
        activeTx.style.transform = "";
      }else if(currentDiffX < -45){
        activeTx.classList.remove("swiped-right");
        activeTx.classList.add("swiped-left");
        activeTx.style.transform = "";
      }else{
        activeTx.classList.remove("swiped-left", "swiped-right");
        activeTx.style.transform = "";
      }
    }

    activeTx = null;
    isSwiping = false;
  };

  list.addEventListener("touchstart", e=>{
    const touch = e.touches[0];
    handleStart(touch.clientX, touch.clientY, e.target);
  }, { passive: true });

  list.addEventListener("touchmove", e=>{
    const touch = e.touches[0];
    handleMove(touch.clientX, touch.clientY);
  }, { passive: true });

  list.addEventListener("touchend", handleEnd);
  list.addEventListener("touchcancel", handleEnd);

  // Mouse drag support para testes no desktop
  let isMouseDown = false;
  list.addEventListener("mousedown", e=>{
    if(e.button !== 0 || isSelectMode) return;
    if(e.target.closest(".tx-swipe-action") || e.target.closest(".tx-swipe-btn") || e.target.closest("[data-toggle-paid]") || e.target.closest(".tx-check")) return;
    isMouseDown = true;
    handleStart(e.clientX, e.clientY, e.target);
  });
  window.addEventListener("mousemove", e=>{
    if(!isMouseDown) return;
    handleMove(e.clientX, e.clientY);
  });
  window.addEventListener("mouseup", ()=>{
    if(!isMouseDown) return;
    isMouseDown = false;
    handleEnd();
  });

  list.addEventListener("click", e=>{
    // Modo de seleção múltipla
    if(isSelectMode){
      const row = e.target.closest("[data-entry-id]");
      if(row){
        toggleEntrySelection(row.dataset.entryId);
      }
      return;
    }

    // Alternar carimbo Pago / A Pagar
    const stampBtn = e.target.closest("[data-toggle-paid]");
    if(stampBtn){
      e.stopPropagation();
      toggleEntryPaid(stampBtn.dataset.togglePaid, e);
      return;
    }

    // Botão Editar do Swipe
    const editBtn = e.target.closest("[data-swipe-edit]");
    if(editBtn){
      e.stopPropagation();
      const entry = entries.find(item => item.id === editBtn.dataset.swipeEdit);
      closeActiveSwipe();
      if(entry) openEntryModal(entry);
      return;
    }

    // Botão Apagar do Swipe
    const deleteBtn = e.target.closest("[data-swipe-delete]");
    if(deleteBtn){
      e.stopPropagation();
      const id = deleteBtn.dataset.swipeDelete;
      closeActiveSwipe();
      if(confirm("Excluir este lançamento?")){
        deleteEntryById(id, getMonthKey());
        saveMonthData();
        loadMonthData();
        showToast("Lançamento excluído.");
      }
      return;
    }

    const swipedTx = e.target.closest(".tx.swiped-left, .tx.swiped-right");
    if(swipedTx){
      e.stopPropagation();
      closeActiveSwipe();
      return;
    }

    const row = e.target.closest("[data-entry-id]");
    if(!row) return;
    closeActiveSwipe();
    const entry = entries.find(item => item.id === row.dataset.entryId);
    if(entry) openEntryModal(entry);
  });
}

/* Inicialização */
loadPlanningData();
loadCategories();
applyTextZoom(Number(localStorage.getItem(KEYS.textZoom)||1));
cleanupLegacyAutoCreatedFutureMonths();

const storedMonth = localStorage.getItem(KEYS.month);
if(isValidMonthKey(storedMonth) && availableMonthKeys().includes(storedMonth)){
  currentDate = dateFromMonthKey(storedMonth);
}else{
  currentDate = dateFromMonthKey(todayISO().slice(0,7));
}

// Carrega paleta de cores
const savedPalette = localStorage.getItem(KEYS.palette) || (localStorage.getItem(KEYS.theme)==="dark" ? "classic-dark" : "classic-light");
setPalette(savedPalette, false);

$("palettePickerBtn")?.addEventListener("click", openPaletteModal);
$("settingsPaletteBtn")?.addEventListener("click", openPaletteModal);

document.querySelectorAll("[data-close-palette]").forEach(btn=>{
  btn.addEventListener("click", closePaletteModal);
});

$("paletteModal")?.addEventListener("click", e=>{
  if(e.target === $("paletteModal")) closePaletteModal();
});

document.querySelectorAll(".palette-card").forEach(card=>{
  card.addEventListener("click", ()=>{
    setPalette(card.dataset.palette);
    closePaletteModal();
  });
});

$("prevMonth").addEventListener("click",()=>changeMonth(-1));
$("nextMonth").addEventListener("click",()=>changeMonth(1));
$("createNextMonthBtn").addEventListener("click",createNextMonth);

document.querySelectorAll(".nav-item").forEach(btn=>{
  btn.addEventListener("click",()=>activateView(btn.dataset.target));
});

document.querySelectorAll("[data-open-entry]").forEach(btn=>{
  btn.addEventListener("click",()=>openEntryModal());
});

document.querySelectorAll("[data-close-modal]").forEach(btn=>btn.addEventListener("click",closeEntryModal));
document.querySelectorAll("[data-close-budget]").forEach(btn=>btn.addEventListener("click",closeBudgetModal));

$("entryModal").addEventListener("click",e=>{
  if(e.target===$("entryModal")) closeEntryModal();
});
$("budgetModal").addEventListener("click",e=>{
  if(e.target===$("budgetModal")) closeBudgetModal();
});

document.querySelectorAll(".segment").forEach(btn=>{
  btn.addEventListener("click",()=>setEntryType(btn.dataset.type));
});

$("entryForm").addEventListener("submit",saveEntryFromForm);
$("deleteEntryBtn").addEventListener("click",deleteCurrentEntry);

// Seleção múltipla no Livro
$("toggleSelectModeBtn")?.addEventListener("click", toggleSelectMode);
$("cancelSelectBtn")?.addEventListener("click", exitSelectMode);
$("selectAllBtn")?.addEventListener("click", selectAllFilteredEntries);
$("deleteSelectedBtn")?.addEventListener("click", deleteSelectedEntries);

document.querySelectorAll(".type-tab").forEach(btn=>{
  btn.addEventListener("click",()=>{
    ledgerFilter = btn.dataset.filter;
    document.querySelectorAll(".type-tab").forEach(b=>b.classList.toggle("active",b===btn));
    renderTransactions();
  });
});

$("statusFilter")?.addEventListener("change", debounce(e=>{
  ledgerStatus = e.target.value;
  renderTransactions();
}, 100));

$("searchInput").addEventListener("input", debounce(e=>{
  ledgerSearch = e.target.value;
  $("clearSearchBtn").hidden = !ledgerSearch;
  renderTransactions();
}, 150));

$("clearSearchBtn").addEventListener("click",()=>{
  ledgerSearch = "";
  $("searchInput").value = "";
  $("clearSearchBtn").hidden = true;
  renderTransactions();
});

$("categoryFilter").addEventListener("change",debounce(e=>{
  ledgerCategory = e.target.value;
  renderTransactions();
}, 100));

$("paymentFilter").addEventListener("change",debounce(e=>{
  ledgerPayment = e.target.value;
  renderTransactions();
}, 100));

$("sortFilter").addEventListener("change",debounce(e=>{
  ledgerSort = e.target.value;
  renderTransactions();
}, 100));

$("clearDayFilterBtn").addEventListener("click",()=>{
  ledgerDayFilter = null;
  renderTransactions();
});

$("editBudgetBtn").addEventListener("click",openBudgetModal);

$("budgetModalForm").addEventListener("submit",e=>{
  e.preventDefault();
  if(saveBudgetFromValue($("budgetModalInput").value)){
    closeBudgetModal();
    showToast("Orçamento salvo.");
  }
});

$("budgetForm").addEventListener("submit",e=>{
  e.preventDefault();
  if(saveBudgetFromValue($("budgetInput").value)){
    showToast("Orçamento salvo.");
  }
});

$("categoryForm").addEventListener("submit",e=>{
  e.preventDefault();
  const value = $("newCategoryInput").value.trim();
  if(!value) return;

  const exists = categories.some(c=>c.toLocaleLowerCase("pt-BR")===value.toLocaleLowerCase("pt-BR"));
  if(exists){
    showToast("Essa categoria já existe.");
    return;
  }

  categories.push(value);
  saveCategories();
  $("newCategoryInput").value = "";
  renderCategoryControls();
  showToast("Categoria adicionada.");
});

$("categoryChips").addEventListener("click",e=>{
  const btn = e.target.closest("[data-remove-category]");
  if(!btn) return;
  const category = decodeURIComponent(btn.dataset.removeCategory);

  if(categories.length<=1){
    showToast("Mantenha pelo menos uma categoria.");
    return;
  }
  if(!confirm(`Remover a categoria "${category}" da lista?`)) return;

  categories = categories.filter(c=>c!==category);
  if(ledgerCategory===category) ledgerCategory="all";
  saveCategories();
  renderCategoryControls();
  renderTransactions();
  showToast("Categoria removida.");
});

document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    if(isSelectMode) exitSelectMode();
    if(!$("entryModal").hidden) closeEntryModal();
    if(!$("budgetModal").hidden) closeBudgetModal();
    if(!$("reportModal").hidden) closeReport();
    if(!$("cardModal").hidden) closeCardModal();
    if($("paletteModal") && !$("paletteModal").hidden) closePaletteModal();
    if($("ocrTipsModal") && !$("ocrTipsModal").hidden && globalThis.OCR) globalThis.OCR.closeOcrTipsModal();
  }
});

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("./service-worker.js").then(reg=>{
      reg.update();
    }).catch(()=>{});
  });
}

setupSwipeGestures();
loadMonthData();
