import { getDailyQuote } from './quotes.js?v=1';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const todayKey = (date = new Date()) => {
  const d = new Date(date); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
const dateFromKey = key => new Date(`${key}T12:00:00`);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const number = value => value === '' || value == null || Number.isNaN(Number(value)) ? null : Number(value);
const round = (value, places = 0) => value == null ? '—' : Number(value).toFixed(places);
const prettyDate = (key, options = { weekday: 'long', day: 'numeric', month: 'long' }) => new Intl.DateTimeFormat('en-GB', options).format(dateFromKey(key));
const keyForOffset = offset => { const date = dateFromKey(todayKey()); date.setDate(date.getDate() + offset); return todayKey(date); };
const notify = message => { const toast = $('#toast'); if (!toast) return; toast.textContent = message; toast.classList.add('show'); clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.remove('show'), 2400); };
const notificationsGranted = () => 'Notification' in window && Notification.permission === 'granted';
const remindersNeedAction = () => 'Notification' in window && !notificationsGranted();

const DB_NAME = 'd-shift-workouts';
const DB_VERSION = 1;
let db;
const openDB = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    ['profile', 'settings', 'dailyLogs', 'weightLogs', 'activityLogs', 'sessionLogs'].forEach(store => {
      if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: 'id' });
    });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const idbGet = (store, id) => new Promise((resolve, reject) => { const request = db.transaction(store).objectStore(store).get(id); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const idbAll = store => new Promise((resolve, reject) => { const request = db.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result || []); request.onerror = () => reject(request.error); });
const idbPut = (store, value) => new Promise((resolve, reject) => { const request = db.transaction(store, 'readwrite').objectStore(store).put(value); request.onsuccess = () => resolve(value); request.onerror = () => reject(request.error); });
const idbDelete = (store, id) => new Promise((resolve, reject) => { const request = db.transaction(store, 'readwrite').objectStore(store).delete(id); request.onsuccess = resolve; request.onerror = () => reject(request.error); });

const state = {
  tab: 'today', profile: null, settings: { shifts: {}, rotaAnchor: null }, today: {}, weights: [], activities: [], sessions: [],
  foodResults: [], foodQuery: '', selectedFood: null, foodQuantity: '', foodUnit: 'g', fuelSearchTimer: null, foodRequestId: 0, activitySubtab: 'overview', sessionStarted: null,
  rotaOpen: false, rotaWindow: 0,
  restTimer: 0, restInterval: null,
  modalReturnFocus: null, modalKeyHandler: null, foodActiveIndex: -1, notificationInterval: null, quoteTimeout: null
};
const FOOD_FALLBACKS = [
  { name: 'Chicken breast', calories: 165, protein: 31, carbs: 0, fats: 3.6 },
  { name: 'Greek yoghurt', calories: 97, protein: 9, carbs: 4, fats: 5 },
  { name: 'Oats', calories: 389, protein: 17, carbs: 66, fats: 7 },
  { name: 'White rice, cooked', calories: 130, protein: 2.7, carbs: 28, fats: .3 },
  { name: 'Banana', calories: 89, protein: 1.1, carbs: 23, fats: .3 },
  { name: 'Egg', calories: 143, protein: 13, carbs: 1.1, fats: 9.5 },
  { name: 'Salmon', calories: 208, protein: 20, carbs: 0, fats: 13 }
];

const getDailyTargets = () => {
  const weight = number(state.profile?.weight);
  if (!weight) return { calories: 0, protein: 0, carbs: 0, fats: 0 };
  const calories = Math.round(weight * 30 + (state.profile.goal === 'muscle' ? 250 : state.profile.goal === 'recomp' ? 100 : 0));
  const protein = Math.round(weight * 1.8);
  const fats = Math.round(weight * .8);
  return { calories, protein, carbs: Math.max(0, Math.round((calories - protein * 4 - fats * 9) / 4)), fats };
};
const getProfileStats = () => {
  const weight = number(state.profile?.weight); const height = number(state.profile?.height); const target = number(state.profile?.targetWeight);
  if (!weight || !height || !target) return null;
  const heightM = height / 100; const currentBMI = weight / (heightM * heightM); const targetBMI = target / (heightM * heightM); const change = Math.abs(weight - target);
  return { currentBMI, targetBMI, change, averageWeeks: Math.ceil(change / .5), optimalWeeks: Math.ceil(change / 1) };
};
const getShift = key => {
  if (state.settings.shifts?.[key]) return state.settings.shifts[key];
  const anchor = dateFromKey(state.settings.rotaAnchor || todayKey());
  const date = dateFromKey(key);
  const diff = Math.floor((date - anchor) / 86400000);
  return ((diff % 7) + 7) % 7 < 4 ? 'Work' : 'Off';
};
const getWorkout = (key = todayKey()) => getShift(key) === 'Work'
  ? { mode: 'shift', muscle: 'Mobility + recovery', duration: 15, title: 'Quick shift reset', exercises: [{ name: 'Hip flexor stretch', alternate: 'Couch stretch', sets: 2 }, { name: 'Band pull-apart', alternate: 'Wall slides', sets: 2 }, { name: 'Dead bug', alternate: 'Bird dog', sets: 2 }] }
  : { mode: 'off', muscle: 'Full body strength', duration: 52, title: 'Full body strength', exercises: [{ name: 'Goblet squat', alternate: 'Leg press', sets: 3 }, { name: 'Dumbbell bench press', alternate: 'Push-up', sets: 3 }, { name: 'Romanian deadlift', alternate: 'Cable pull-through', sets: 3 }, { name: 'Seated row', alternate: 'Inverted row', sets: 3 }] };
const adjustedWorkout = () => { const workout = getWorkout(); const fatigue = number(state.today.fatigue); if (fatigue >= 8) return { ...workout, duration: Math.round(workout.duration * .65), title: `${workout.title} · reduced volume`, exercises: workout.exercises.slice(0, Math.max(2, Math.ceil(workout.exercises.length * .65))) }; return workout; };
const logForToday = () => state.today;
const UNIT_TO_GRAMS = { g: 1, oz: 28.349523125 };
const foodGrams = food => { const quantity = number(food.quantity ?? 100); const multiplier = UNIT_TO_GRAMS[food.unit || 'g']; return quantity > 0 && multiplier ? quantity * multiplier : 0; };
const scaledFoodMacros = food => { const factor = foodGrams(food) / 100; return { calories: (Number(food.calories) || 0) * factor, protein: (Number(food.protein) || 0) * factor, carbs: (Number(food.carbs) || 0) * factor, fats: (Number(food.fats) || 0) * factor }; };
const macroConsumed = key => (state.today.foods || []).reduce((total, food) => { const scaled = scaledFoodMacros(food); return { calories: total.calories + scaled.calories, protein: total.protein + scaled.protein, carbs: total.carbs + scaled.carbs, fats: total.fats + scaled.fats }; }, { calories: 0, protein: 0, carbs: 0, fats: 0 });
const saveToday = async () => { state.today.id = todayKey(); await idbPut('dailyLogs', state.today); };

function icon(name) { return ({ today: '⌂', workout: '◒', fuel: '◉', progress: '↗' }[name] || '•'); }
function nav() { return `<nav class="bottom-nav" aria-label="Primary navigation">${[['today', 'Today'], ['workout', 'Workout'], ['fuel', 'Fuel'], ['progress', 'Progress']].map(([id, label]) => `<button class="nav-item ${state.tab === id ? 'active' : ''}" data-action="tab" data-tab="${id}"><span class="nav-icon">${icon(id)}</span>${label}</button>`).join('')}</nav>`; }
function topbar(title, eyebrow, help) { return `<header class="topbar"><div class="topbar-main"><div class="brand-line"><span class="brand-mark">D</span><span class="brand-name">D-SHIFT</span></div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1>${state.tab === 'today' ? `<div class="date-line">${prettyDate(todayKey())}</div>` : ''}</div><button class="icon-button tab-help" data-action="help" aria-label="About ${title}">i</button></header>`; }

function render() {
  const views = { today: renderToday, workout: renderWorkout, fuel: renderFuel, progress: renderProgress };
  $('#app').innerHTML = `<div class="view">${views[state.tab]()}${nav()}</div>`;
  bindView();
}

function renderToday() {
  const profile = state.profile;
  const workout = adjustedWorkout();
  const targets = getDailyTargets();
  const consumed = macroConsumed();
  const fatigue = number(state.today.fatigue);
  const waterTarget = profile ? 8 : 0;
  const water = state.today.water || 0;
  return `${topbar('Today', 'D-SHIFT WORKOUTS', 'Today')}
    ${!profile ? `<section class="card empty-state"><div class="setup-mark">D</div><strong>Build your shift-ready plan</strong><p>Press the button below to enter your profile. Your targets, workout routing and timeline will be calculated from it.</p><button class="primary-button" data-action="profile">Set up my profile</button></section>` : ''}${remindersNeedAction() ? `<section class="card"><div class="split"><div><div class="section-label">Stay on time</div><strong>Meal and hydration reminders</strong><p style="font-size:12px">Allow notifications for lunch, dinner, hydration, and one daily quote at 8:00 AM while D-Shift is active.</p></div><button class="secondary-button small-button" data-action="notifications">Enable</button></div></section>` : ''}
    <section class="card quote-card"><div class="section-label">Daily boost</div><blockquote>“${esc(getDailyQuote(todayKey()).text)}”</blockquote><p class="quote-author">— ${esc(getDailyQuote(todayKey()).author)}</p><div class="split quote-status"><span>${notificationsGranted() ? 'Daily quote notifications enabled' : 'Quote shown here every day'}</span>${notificationsGranted() ? '<span class="pill">8:00 AM</span>' : ''}</div></section>
    <section class="card readiness-card"><div class="card-header"><div><div class="section-label">Readiness check</div><h2>How do you feel?</h2></div><span class="pill">${fatigue ? `RPE ${fatigue}/10` : 'Not logged'}</span></div><p>One quick score tells D-Shift how much training your shift can support today.</p><div class="rpe-wrap"><input id="fatigue" type="range" min="1" max="10" step="1" aria-label="Fatigue, 1 to 10" ${fatigue ? `value="${fatigue}"` : ''}><div class="range-labels"><span>Fresh · 1</span><span>Wrecked · 10</span></div></div></section>
    <section class="card command-card"><div class="command-kicker"><span class="section-label">Your next move</span><span class="pill">${getShift(todayKey())} day</span></div><div class="command-title"><h2>${profile ? workout.title : 'Your shift-ready plan'}</h2><span class="command-arrow">→</span></div>${profile ? `<p>${esc(workout.muscle)} · ${workout.duration} minutes${fatigue >= 8 ? ' · volume reduced for recovery' : ''}</p><button class="primary-button" style="margin-top:14px" data-action="tab" data-tab="workout">Open workout</button>` : `<div class="empty-state"><strong>Start with your profile</strong><p>Press “Set up my profile” above and D-Shift will route your training around work.</p></div>`}</section>
    ${profile ? renderProfileSummary() : ''}<section class="card"><div class="card-header"><div><div class="section-label">Daily fuel</div><h2>Remaining macros</h2></div><button class="icon-button" data-action="tab" data-tab="fuel" aria-label="Open fuel">→</button></div>${profile ? `<div class="metric-grid"><div class="metric"><strong>${Math.max(0, targets.calories - consumed.calories)}</strong><span>kcal</span></div><div class="metric"><strong>${Math.max(0, targets.protein - consumed.protein)}g</strong><span>protein</span></div><div class="metric"><strong>${Math.max(0, targets.carbs - consumed.carbs)}g</strong><span>carbs</span></div></div>` : `<p>Set up your profile to calculate your macro targets.</p>`}</section>
    <section class="card"><div class="card-header"><div><div class="section-label">Activity</div><h2>Keep moving</h2></div></div><div class="field"><label for="steps">Steps today</label><input id="steps" type="number" min="0" inputmode="numeric" placeholder="e.g. 8000" value="${state.today.steps ?? ''}"></div><div class="list-row" style="margin-top:12px"><span>Water remaining</span><strong>${profile ? `${Math.max(0, waterTarget - water)} / ${waterTarget} cups` : 'Set up profile'}</strong></div><div class="water-grid" style="margin-top:14px">${Array.from({ length: waterTarget }, (_, index) => `<button class="water-cup ${index < water ? 'filled' : ''}" data-action="water" data-index="${index}" aria-label="${index < water ? 'Remove' : 'Add'} cup ${index + 1}">Cup ${index + 1}</button>`).join('')}</div></section>`;
}
function renderProfileSummary() {
  const stats = getProfileStats(); if (!stats) return '';
  return `<section class="card"><div class="card-header"><div><div class="section-label">Physics engine</div><h2>Starting point</h2></div><button class="secondary-button small-button" data-action="profile">Edit</button></div><div class="metric-grid"><div class="metric"><strong>${round(stats.currentBMI, 1)}</strong><span>current BMI</span></div><div class="metric"><strong>${round(stats.targetBMI, 1)}</strong><span>optimal BMI</span></div><div class="metric"><strong>${stats.change ? `${stats.change.toFixed(1)} kg` : 'On target'}</strong><span>to target</span></div></div><details><summary>Timeline projection</summary><div class="list-row"><span>Average · 0.5 kg/week</span><strong>${stats.averageWeeks} weeks</strong></div><div class="list-row"><span>Very optimal · 1 kg/week</span><strong>${stats.optimalWeeks} weeks</strong></div><div class="warning" style="margin-top:13px">WARNING: The optimal timeline is strictly theoretical and is only achievable with absolute discipline, zero missed sessions, and perfect macro adherence.</div></details></section>`;
}

function renderProfileForm() {
  const p = state.profile || {};
  return `<div class="modal-backdrop" data-action="close-modal"><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="profile-title"><div class="sheet-handle"></div><button class="icon-button close" data-action="close-modal" aria-label="Close">×</button><h2 id="profile-title">Your baseline</h2><p>One minute of setup. Stored privately on this device in IndexedDB.</p><div class="sheet-body"><form id="profile-form"><div class="field-grid"><div class="field"><label for="gender">Gender</label><select id="gender"><option value="">Choose one</option><option value="female" ${p.gender === 'female' ? 'selected' : ''}>Female</option><option value="male" ${p.gender === 'male' ? 'selected' : ''}>Male</option><option value="other" ${p.gender === 'other' ? 'selected' : ''}>Prefer not to say</option></select></div><div class="field"><label for="goal">Specific goal</label><select id="goal"><option value="">Choose one</option><option value="muscle" ${p.goal === 'muscle' ? 'selected' : ''}>Muscle mass</option><option value="recomp" ${p.goal === 'recomp' ? 'selected' : ''}>Recomposition</option><option value="fat-loss" ${p.goal === 'fat-loss' ? 'selected' : ''}>Fat loss</option></select></div><div class="field"><label for="weight">Current weight (kg)</label><input id="weight" type="number" min="1" step="0.1" placeholder="e.g. 82.5" value="${p.weight ?? ''}"></div><div class="field"><label for="height">Height (cm)</label><input id="height" type="number" min="1" step="0.1" placeholder="e.g. 178" value="${p.height ?? ''}"></div><div class="field field-full"><label for="targetWeight">Target weight (kg)</label><input id="targetWeight" type="number" min="1" step="0.1" placeholder="75–78 kg" value="${p.targetWeight ?? ''}"></div></div><button class="primary-button" style="margin-top:20px" type="submit">Calculate my plan</button></form></div></section></div>`;
}

function renderWorkout() {
  const workout = adjustedWorkout();
  const session = state.sessions.find(item => item.id === todayKey());
  const elapsed = state.sessionStarted ? Math.floor((Date.now() - state.sessionStarted) / 1000) : (session?.duration || 0);
  return `${topbar('Workout', 'TRAIN WITH YOUR ROTATION', 'Workout')}
    <details class="card" data-rota-engine ${state.rotaOpen ? 'open' : ''}><summary>Rota engine · 4 on / 3 off</summary><p>Use the two-week window below to set your repeating pattern and override future days.</p><div class="field" style="margin:14px 0"><label for="rotaAnchor">Pattern starts on</label><input id="rotaAnchor" type="date" value="${state.settings.rotaAnchor || todayKey()}"></div>${renderCalendar()}</details>
    <section class="card"><div class="card-header"><div><div class="section-label">Today's route · ${getShift(todayKey())} day</div><h2>${workout.title}</h2></div><span class="pill">${workout.duration} min</span></div><p>${getShift(todayKey()) === 'Work' ? '12-hour shift detected. Keep the joints moving, then protect your recovery.' : 'Off-day detected. This is your best window for full training volume.'}</p><div class="button-row"><button class="primary-button" data-action="session-start">${state.sessionStarted ? 'Session running' : 'Start session'}</button><button class="secondary-button" data-action="clear-session">Clear all fields</button></div>${state.sessionStarted ? `<div class="split" style="margin-top:15px"><span class="timer" id="session-timer">${formatDuration(elapsed)}</span><span class="muted">Started ${new Date(state.sessionStarted).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>` : ''}</section>
    <section class="card"><div class="card-header"><div><div class="section-label">Execution</div><h2>Log each set</h2></div><span class="muted" id="rest-status">${state.restTimer ? `Rest ${formatDuration(state.restTimer)}` : state.sessionStarted ? 'Timestamping' : 'Start to timestamp'}</span></div>${state.sessionStarted ? `<div class="field" style="margin-bottom:14px"><label for="session-timestamp">Timestamp · session duration</label><input id="session-timestamp" type="text" readonly value="${formatDuration(elapsed)}"></div>` : ''}${workout.exercises.map((exercise, index) => renderExercise(exercise, index, session)).join('')}<button class="primary-button" data-action="finish-session">Save session</button></section>`;
}
function formatDuration(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function renderCalendar() {
  const start = dateFromKey(todayKey()); start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + state.rotaWindow * 14);
  const cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(day => `<div class="weekday">${day}</div>`).join('');
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); const key = todayKey(d); return `<button class="day-cell ${key === todayKey() ? 'today' : ''}" data-action="edit-shift" data-date="${key}"><span class="day-number">${d.getDate()}</span><small>${getShift(key)}</small></button>`; }).join('');
  return `<div class="rota-window-controls"><button class="secondary-button small-button" data-action="rota-window" data-direction="-1" ${state.rotaWindow <= 0 ? 'disabled' : ''}>← Previous</button><span class="muted">Window ${state.rotaWindow + 1}</span><button class="secondary-button small-button" data-action="rota-window" data-direction="1">Next →</button></div><div class="calendar">${cells}${days}</div>`;
}
function renderExercise(exercise, index, session) {
  const saved = { ...(session?.exercises?.[index] || {}), ...(state.sessionDraft?.[index] || {}) };
  const swapped = state.sessionSwap?.[index] ?? saved.swapped;
  const name = swapped ? exercise.alternate : exercise.name;
  const savedSets = Array.isArray(saved.sets) ? saved.sets : [];
  const setCount = Math.max(1, savedSets.length || exercise.sets || 1);
  const legacySet = !savedSets.length && (saved.weight != null || saved.reps != null) ? { weight: saved.weight, reps: saved.reps } : {};
  const sets = Array.from({ length: setCount }, (_, setIndex) => savedSets[setIndex] || legacySet);
  return `<div class="exercise" data-exercise="${index}"><div class="exercise-title"><strong>${esc(name)}</strong><button class="secondary-button small-button" data-action="swap" data-index="${index}">Equipment taken · Swap</button></div><div class="set-head"><span>Set</span><span>Weight (kg)</span><span>Reps</span></div><div class="set-list">${sets.map((set, setIndex) => `<div class="set-row"><span class="set-number">${setIndex + 1}</span><input data-field="weight" data-set-index="${setIndex}" aria-label="${esc(name)}, set ${setIndex + 1}, weight in kilograms" type="number" step="0.5" min="0" placeholder="kg" value="${set.weight ?? ''}"><input data-field="reps" data-set-index="${setIndex}" aria-label="${esc(name)}, set ${setIndex + 1}, repetitions" type="number" step="1" min="0" placeholder="reps" value="${set.reps ?? ''}"></div>`).join('')}</div><div class="exercise-actions"><span class="muted">${exercise.sets} sets planned</span><button class="secondary-button small-button" data-action="add-set" data-index="${index}">+ Add set</button></div></div>`;
}

function renderFuel() {
  const targets = getDailyTargets(); const consumed = macroConsumed(); const meal = value => Math.round(value / 2); const foods = state.today.foods || [];
  return `${topbar('Fuel', 'EAT WITH INTENTION', 'Fuel')}<section class="card"><div class="card-header"><div><div class="section-label">OpenFoodFacts</div><h2>Add a food</h2></div><span class="muted">Search and select</span></div><label for="food-search">Search a food</label><input id="food-search" type="search" autocomplete="off" role="combobox" aria-controls="food-results" aria-expanded="${Boolean(state.foodResults.length)}" placeholder="Try: Greek yoghurt, oats, chicken" value="${esc(state.foodQuery)}"><div id="food-results" role="listbox" aria-label="Food search results">${renderFoodResults()}</div>${state.selectedFood ? `<div class="card selected-food-card" style="margin:12px 0 0;background:#1d1d1d"><div class="split"><div><strong>${esc(state.selectedFood.name)}</strong><p>Nutrition values are per 100 g.</p></div><button class="primary-button small-button" data-action="add-food">Add food</button></div><div class="quantity-grid"><div class="field"><label for="food-quantity">Quantity</label><input id="food-quantity" type="number" min="0.1" step="0.1" inputmode="decimal" placeholder="e.g. 150" value="${esc(state.foodQuantity)}"></div><div class="field"><label for="food-unit">Unit</label><select id="food-unit"><option value="g" ${state.foodUnit === 'g' ? 'selected' : ''}>grams (g)</option><option value="oz" ${state.foodUnit === 'oz' ? 'selected' : ''}>ounces (oz)</option></select></div></div><p class="scaled-preview" id="scaled-preview">Enter quantity to calculate calories and macros.</p></div>` : '<p class="food-hint">Search above, then select a result. Enter quantity before pressing “Add food”.</p>'}</section>
     <section class="card"><div class="card-header"><div><div class="section-label">Daily balance</div><h2>Remaining</h2></div><button class="secondary-button small-button" data-action="clear-fuel">Clear all fields</button></div>${renderMacro('Calories', consumed.calories, targets.calories, 'kcal')}${renderMacro('Protein', consumed.protein, targets.protein, 'g')}${renderMacro('Carbs', consumed.carbs, targets.carbs, 'g')}${renderMacro('Fats', consumed.fats, targets.fats, 'g')}<details><summary>Food logged today (${foods.length})</summary>${foods.length ? foods.map((food, index) => { const scaled = scaledFoodMacros(food); return `<div class="list-row"><span><strong>${esc(food.name)}</strong><small class="muted" style="display:block">${round(number(food.quantity ?? 100), 1)} ${esc(food.unit || 'g')} · ${Math.round(scaled.calories)} kcal</small></span><button class="icon-button" data-action="remove-food" data-index="${index}" aria-label="Remove ${esc(food.name)}">×</button></div>`; }).join('') : '<p>Nothing logged. Search above and press “Add” to start.</p>'}</details></section>
    <section class="card"><div class="card-header"><div><div class="section-label">Fixed meal pacing</div><h2>Two meals, clearly timed</h2></div></div><div class="list-row"><div><strong>12:00 PM · Lunch</strong><p>Half of each daily target</p></div><span class="pill">${meal(targets.calories)} kcal</span></div><div class="list-row"><div><strong>5:00 PM · Dinner</strong><p>Half of each daily target</p></div><span class="pill">${meal(targets.calories)} kcal</span></div><p style="font-size:12px">Protein ${meal(targets.protein)}g · Carbs ${meal(targets.carbs)}g · Fats ${meal(targets.fats)}g per meal.</p></section>
    <section class="card"><div class="card-header"><div><div class="section-label">Hydration</div><h2>${state.today.water || 0} of 8 cups</h2></div></div><p>One cup is approximately 250 ml. Tap a cup to mark it complete.</p><div class="water-grid">${Array.from({ length: 8 }, (_, index) => `<button class="water-cup ${(state.today.water || 0) > index ? 'filled' : ''}" data-action="water" data-index="${index}" aria-label="Cup ${index + 1}">Cup ${index + 1}</button>`).join('')}</div><button class="danger-button" style="margin-top:18px" data-action="clear-fuel">Clear all fields</button></section>`;
}
function renderMacro(name, value, target, unit) { const percent = target ? Math.min(100, Math.round(value / target * 100)) : 0; return `<div class="macro-row"><span class="macro-name">${name}</span><span class="macro-value">${Math.max(0, target - value)}${unit} left</span><div class="progress"><span style="width:${percent}%"></span></div></div>`; }
function renderFoodResults() { if (!state.foodResults.length) return ''; return `<div class="food-dropdown">${state.foodResults.slice(0, 5).map((food, index) => `<button id="food-option-${index}" class="food-option ${index === state.foodActiveIndex ? 'active' : ''}" role="option" aria-selected="${index === state.foodActiveIndex}" data-action="select-food" data-index="${index}"><span>${esc(food.name)}</span><span class="muted">${food.calories || 0} kcal</span></button>`).join('')}</div>`; }

function renderProgress() {
  return `${topbar('Progress', 'SEE THE SIGNAL', 'Progress')}<div class="tabs"><button class="subtab ${state.activitySubtab === 'overview' ? 'active' : ''}" data-action="progress-subtab" data-subtab="overview">Overview</button><button class="subtab ${state.activitySubtab === 'activity' ? 'active' : ''}" data-action="progress-subtab" data-subtab="activity">Activity</button></div>${state.activitySubtab === 'overview' ? renderProgressOverview() : renderActivity()}`;
}
function renderProgressOverview() {
  const points = state.weights.filter(item => item.weight).sort((a, b) => a.id.localeCompare(b.id)); const average = points.length ? points.slice(-7).reduce((sum, item) => sum + item.weight, 0) / Math.min(points.length, 7) : null; const weekly = points.length > 7 ? average - points.slice(-14, -7).reduce((sum, item) => sum + item.weight, 0) / Math.max(1, points.slice(-14, -7).length) : null; const sessions = state.sessions.filter(item => item.id >= keyForOffset(-6));
  return `<section class="card"><div class="card-header"><div><div class="section-label">Morning weigh-in</div><h2>Filter the noise</h2></div><span class="pill">7-day average only</span></div><p>Log your weight after waking. D-Shift only shows the seven-day moving average, so daily water changes do not distract you.</p><div class="field"><label for="weight-log">Today's weight (kg)</label><div class="button-row"><input id="weight-log" type="number" min="1" step="0.1" placeholder="e.g. 81.4"><button class="primary-button small-button" data-action="log-weight">Log</button></div></div>${renderWeightChart(points)}</section><section class="card"><div class="card-header"><div><div class="section-label">This week</div><h2>Signals</h2></div></div><div class="stat-list"><div class="metric"><strong>${round(average, 1)} kg</strong><span>7-day average</span></div><div class="metric"><strong>${weekly == null ? '—' : `${weekly > 0 ? '+' : ''}${round(weekly, 1)} kg`}</strong><span>trend vs prior week</span></div><div class="metric"><strong>${sessions.length}</strong><span>sessions logged</span></div><div class="metric"><strong>${points.length}</strong><span>weigh-ins</span></div></div></section><section class="card"><div class="card-header"><div><div class="section-label">Weekly dashboard</div><h2>Next-week actions</h2></div></div><ul class="bullet-list">${weeklyActions(average, weekly, sessions.length, points.length)}</ul></section>`;
}
function movingAverage(points) { return points.map((point, index) => { const window = points.slice(Math.max(0, index - 6), index + 1); return { ...point, average: window.reduce((sum, item) => sum + item.weight, 0) / window.length }; }); }
function renderWeightChart(points) { if (points.length < 7) return `<div class="chart"><div class="chart-empty">Log ${7 - points.length} more morning${7 - points.length === 1 ? '' : 's'} to reveal a seven-day trend</div></div>`; const values = movingAverage(points).slice(-14); const min = Math.min(...values.map(p => p.average)); const max = Math.max(...values.map(p => p.average)); const range = Math.max(.1, max - min); const coords = values.map((point, index) => `${(index / Math.max(1, values.length - 1)) * 100},${100 - ((point.average - min) / range) * 82 - 9}`).join(' '); return `<div class="chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Seven-day moving average chart"><polyline fill="none" stroke="#f6f6f6" stroke-width="1.5" points="${coords}" vector-effect="non-scaling-stroke"/>${values.map((point, index) => `<circle cx="${(index / Math.max(1, values.length - 1)) * 100}" cy="${100 - ((point.average - min) / range) * 82 - 9}" r="1.8" fill="#f6f6f6" vector-effect="non-scaling-stroke"><title>${point.id}: ${point.average.toFixed(1)} kg</title></circle>`).join('')}</svg></div><div class="split muted" style="font-size:11px"><span>${values[0].id}</span><span>${values.at(-1).id}</span></div>`; }
function weeklyActions(average, weekly, sessions, weighIns) { const actions = []; if (!weighIns) actions.push('Press Log above tomorrow morning to begin your seven-day signal.'); else if (weighIns < 7) actions.push(`Keep logging morning weight for ${7 - weighIns} more day${7 - weighIns === 1 ? '' : 's'} before judging the trend.`); if (sessions < 3) actions.push('Protect three short sessions this week; use the shift-day mobility route when time is tight.'); else actions.push('Your session consistency is building. Add one small rep or load increase on an off-day.'); if (weekly > .3) actions.push('The average is rising. Check meal portions and hit the two fixed meal times consistently.'); else if (weekly < -.8) actions.push('The average is dropping quickly. Add food around training and prioritise recovery.'); else actions.push('The weight signal is stable. Keep protein consistent and focus on progressive volume.'); return actions.map(action => `<li>${action}</li>`).join(''); }
function renderActivity() { const recent = state.activities.filter(item => item.id >= keyForOffset(-6)); const profileWeight = number(state.profile?.weight); const totalCalories = recent.reduce((sum, item) => sum + (item.calories || 0), 0); const stepAdjustment = Math.round((number(state.today.steps) || 0) * .04); return `<section class="card"><div class="card-header"><div><div class="section-label">Activity log</div><h2>Move on your terms</h2></div></div><p>Calories are estimates using standard MET values and your profile weight. Steps are added separately on Today.</p><form id="activity-form"><div class="field-grid"><div class="field"><label for="activity-type">Activity</label><select id="activity-type"><option value="">Choose one</option><option value="Swimming">Swimming</option><option value="Running">Running</option><option value="Walking">Walking</option></select></div><div class="field"><label for="activity-duration">Duration (minutes)</label><input id="activity-duration" type="number" min="1" step="1" placeholder="e.g. 30"></div></div><button class="primary-button" style="margin-top:15px" type="submit">Log activity</button></form></section><section class="card"><div class="card-header"><div><div class="section-label">Last 7 days</div><h2>Activity signal</h2></div><span class="pill">${Math.round(totalCalories)} kcal</span></div><div class="stat-list"><div class="metric"><strong>${Math.round(totalCalories)}</strong><span>logged exercise kcal</span></div><div class="metric"><strong>${stepAdjustment || '—'}</strong><span>today's step TDEE kcal</span></div></div>${recent.length ? recent.map(item => `<div class="list-row"><span><strong>${esc(item.type)}</strong><small class="muted" style="display:block">${item.duration} minutes · ${item.id}</small></span><span>${Math.round(item.calories)} kcal</span></div>`).join('') : `<div class="empty-state"><strong>No activity logged yet</strong><p>Choose an activity above and press “Log activity” to start adjusting your TDEE.</p></div>`}</section>`; }

function bindView() {
  $$('.nav-item').forEach(button => button.addEventListener('click', () => { state.tab = button.dataset.tab; render(); }));
  $$('[data-action="tab"]:not(.nav-item)').forEach(button => button.addEventListener('click', () => { state.tab = button.dataset.tab; render(); }));
  $$('[data-action="help"]').forEach(button => button.addEventListener('click', () => openHelp(state.tab)));
  $$('[data-action="profile"]').forEach(button => button.addEventListener('click', () => openModal(renderProfileForm())));
  $$('[data-action="close-modal"]').forEach(button => button.addEventListener('click', event => { if (event.target === button || button.classList.contains('icon-button')) closeModal(); }));
  const fatigue = $('#fatigue'); if (fatigue) fatigue.addEventListener('change', async event => { state.today.fatigue = number(event.target.value); await saveToday(); render(); });
  const steps = $('#steps'); if (steps) steps.addEventListener('change', async event => { state.today.steps = number(event.target.value); await saveToday(); notify('Steps saved'); });
  $$('[data-action="water"]').forEach(button => button.addEventListener('click', async () => { state.today.water = Number(button.dataset.index) < (state.today.water || 0) ? Number(button.dataset.index) : Number(button.dataset.index) + 1; await saveToday(); render(); }));
  const profileForm = $('#profile-form'); if (profileForm) profileForm.addEventListener('submit', saveProfile);
  $$('[data-action="notifications"]').forEach(button => button.addEventListener('click', requestNotifications));
  const rotaAnchor = $('#rotaAnchor'); if (rotaAnchor) rotaAnchor.addEventListener('change', async event => { state.settings.rotaAnchor = event.target.value; await idbPut('settings', { id: 'app', ...state.settings }); render(); });
  $$('[data-action="edit-shift"]').forEach(button => button.addEventListener('click', () => openShiftEditor(button.dataset.date)));
  $$('[data-action="rota-window"]').forEach(button => button.addEventListener('click', () => { state.rotaWindow = Math.max(0, state.rotaWindow + Number(button.dataset.direction)); render(); }));
  $$('[data-action="session-start"]').forEach(button => button.addEventListener('click', startSession));
  $$('[data-action="finish-session"]').forEach(button => button.addEventListener('click', finishSession));
  $$('[data-action="clear-session"]').forEach(button => button.addEventListener('click', clearSession));
  $$('[data-action="swap"]').forEach(button => button.addEventListener('click', () => { const exercise = $(`[data-exercise="${button.dataset.index}"]`); const input = exercise.querySelector('[data-field="weight"]'); state.sessionDraft = collectSession(); state.sessionSwap = state.sessionSwap || {}; state.sessionSwap[button.dataset.index] = !state.sessionSwap[button.dataset.index]; render(); const next = $(`[data-exercise="${button.dataset.index}"] [data-field="weight"]`); if (next && input) next.focus(); }));
  $$('[data-action="add-set"]').forEach(button => button.addEventListener('click', () => { state.sessionDraft = collectSession(); const index = Number(button.dataset.index); const current = state.sessionDraft[index] || { sets: [] }; current.sets = [...(Array.isArray(current.sets) ? current.sets : []), {}]; state.sessionDraft[index] = current; render(); notify('Set added'); }));
  $$('[data-field]').forEach(input => input.addEventListener('change', event => saveSessionDraft(event)));
  const foodSearch = $('#food-search'); if (foodSearch) { foodSearch.addEventListener('input', event => { state.foodQuery = event.target.value; state.selectedFood = null; state.foodActiveIndex = -1; searchFoods(event.target.value); }); foodSearch.addEventListener('keydown', handleFoodKeydown); }
  bindFoodResults();
  const foodQuantity = $('#food-quantity'); if (foodQuantity) foodQuantity.addEventListener('input', event => { state.foodQuantity = event.target.value; updateScaledPreview(); });
  const foodUnit = $('#food-unit'); if (foodUnit) foodUnit.addEventListener('change', event => { state.foodUnit = event.target.value; updateScaledPreview(); });
  $$('[data-action="add-food"]').forEach(button => button.addEventListener('click', addFood));
  $$('[data-action="remove-food"]').forEach(button => button.addEventListener('click', async () => { state.today.foods.splice(Number(button.dataset.index), 1); await saveToday(); render(); }));
  $$('[data-action="clear-fuel"]').forEach(button => button.addEventListener('click', clearFuel));
  $$('[data-action="progress-subtab"]').forEach(button => button.addEventListener('click', () => { state.activitySubtab = button.dataset.subtab; render(); }));
  $$('[data-action="log-weight"]').forEach(button => button.addEventListener('click', logWeight));
  const activityForm = $('#activity-form'); if (activityForm) activityForm.addEventListener('submit', logActivity);
  const rotaEngine = $('[data-rota-engine]'); if (rotaEngine) rotaEngine.addEventListener('toggle', () => { state.rotaOpen = rotaEngine.open; });
  if (state.sessionStarted) { clearInterval(state.sessionInterval); state.sessionInterval = setInterval(() => { const timer = $('#session-timer'); if (timer) timer.textContent = formatDuration(Math.floor((Date.now() - state.sessionStarted) / 1000)); }, 1000); }
}

function openModal(content) { state.modalReturnFocus = document.activeElement; $('#modal-root').innerHTML = content; document.body.style.overflow = 'hidden'; $$('#modal-root [data-action="close-modal"]').forEach(button => button.addEventListener('click', event => { if (event.target === button || button.classList.contains('icon-button')) closeModal(); })); const form = $('#profile-form'); if (form) form.addEventListener('submit', saveProfile); const dialog = $('#modal-root [role="dialog"]'); const first = dialog?.querySelector('button, input, select, [tabindex="0"]'); first?.focus(); state.modalKeyHandler = event => { if (event.key === 'Escape') { closeModal(); return; } if (event.key !== 'Tab' || !dialog) return; const focusable = [...dialog.querySelectorAll('button, input, select, [href], [tabindex]:not([tabindex="-1"])')].filter(item => !item.disabled); if (!focusable.length) return; const firstFocusable = focusable[0]; const lastFocusable = focusable.at(-1); if (event.shiftKey && document.activeElement === firstFocusable) { event.preventDefault(); lastFocusable.focus(); } else if (!event.shiftKey && document.activeElement === lastFocusable) { event.preventDefault(); firstFocusable.focus(); } }; document.addEventListener('keydown', state.modalKeyHandler); }
function closeModal() { if (state.modalKeyHandler) document.removeEventListener('keydown', state.modalKeyHandler); const returnFocus = state.modalReturnFocus; state.modalKeyHandler = null; state.modalReturnFocus = null; $('#modal-root').innerHTML = ''; document.body.style.overflow = ''; returnFocus?.focus?.(); }
function openHelp(tab) {
  const copy = {
    today: ['A clear next step', 'Today answers “what do I need to do right now?” Log fatigue from your shift and the plan adjusts volume automatically. Use the Fuel and Workout buttons to open the full detail when you are ready.'],
    workout: ['Train around your rota', 'Off-days carry the heavier strength work; 12-hour shifts get a short mobility reset. Open the rota to change future days, then start a session and log each set.'],
    fuel: ['Make two meals easy', 'Fuel keeps your macro target and hydration visible without requiring perfect tracking. Search a food above, press Add, and follow the 12 PM and 5 PM split.'],
    progress: ['Look for trends', 'Progress filters daily fluctuations into a seven-day moving average. Log morning weight or switch to Activity to record movement and see practical actions for next week.']
  }[tab];
  openModal(`<div class="modal-backdrop" data-action="close-modal"><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="help-title"><div class="sheet-handle"></div><button class="icon-button close" data-action="close-modal" aria-label="Close help">×</button><h2 id="help-title">${copy[0]}</h2><div class="sheet-body"><p>${copy[1]}</p></div><button class="primary-button" data-action="close-modal">Got it</button></section></div>`);
  $$('.sheet [data-action="close-modal"]').forEach(button => button.addEventListener('click', closeModal));
}

async function saveProfile(event) {
  event.preventDefault();
  const profile = { id: 'main', gender: $('#gender').value, goal: $('#goal').value, weight: number($('#weight').value), height: number($('#height').value), targetWeight: number($('#targetWeight').value) };
  if (!profile.gender || !profile.goal || !profile.weight || !profile.height || !profile.targetWeight) { notify('Complete every profile field first'); return; }
  state.profile = profile; await idbPut('profile', profile); closeModal(); render(); notify('Plan calculated and saved');
}
function openShiftEditor(key) {
  const current = getShift(key);
  openModal(`<div class="modal-backdrop" data-action="close-modal"><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="shift-title"><div class="sheet-handle"></div><button class="icon-button close" data-action="close-modal" aria-label="Close shift editor">×</button><h2 id="shift-title">Edit ${prettyDate(key, { weekday: 'long', day: 'numeric', month: 'short' })}</h2><div class="sheet-body"><p>Choose how D-Shift should route this date. This override is stored offline.</p><div class="button-row"><button class="${current === 'Work' ? 'primary' : 'secondary'}-button" data-action="choose-shift" data-date="${key}" data-shift="Work">12-hour shift</button><button class="${current === 'Off' ? 'primary' : 'secondary'}-button" data-action="choose-shift" data-date="${key}" data-shift="Off">Off day</button></div></div></section></div>`);
  $$('[data-action="choose-shift"]').forEach(button => button.addEventListener('click', async () => { state.settings.shifts[button.dataset.date] = button.dataset.shift; await idbPut('settings', { id: 'app', ...state.settings }); closeModal(); render(); notify(`${button.dataset.shift} day saved`); }));
}
function collectSession() {
  const result = {};
  $$('.exercise').forEach((exercise, index) => {
    const sets = [];
    $$('[data-field]', exercise).forEach(input => {
      const setIndex = Number(input.dataset.setIndex || 0);
      sets[setIndex] = { ...(sets[setIndex] || {}), [input.dataset.field]: number(input.value) };
    });
    result[index] = { ...(state.sessionDraft?.[index] || {}), swapped: Boolean(state.sessionSwap?.[index]), sets };
  });
  return result;
}
function bindFoodResults() { $$('[data-action="select-food"]').forEach(button => button.addEventListener('click', () => { state.selectedFood = { ...state.foodResults[Number(button.dataset.index)] }; state.foodQuantity = ''; state.foodUnit = 'g'; render(); requestAnimationFrame(() => $('#food-quantity')?.focus()); })); }
function updateScaledPreview() { const preview = $('#scaled-preview'); if (!preview || !state.selectedFood) return; const quantity = number(state.foodQuantity); if (!quantity || quantity <= 0) { preview.textContent = 'Enter quantity to calculate calories and macros.'; return; } const scaled = scaledFoodMacros({ ...state.selectedFood, quantity, unit: state.foodUnit }); preview.textContent = `${Math.round(scaled.calories)} kcal · Protein ${round(scaled.protein, 1)}g · Carbs ${round(scaled.carbs, 1)}g · Fats ${round(scaled.fats, 1)}g`; }
function handleFoodKeydown(event) {
  if (!state.foodResults.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    state.foodActiveIndex = (state.foodActiveIndex + direction + state.foodResults.length) % state.foodResults.length;
    updateFoodDropdown();
    const input = $('#food-search'); if (input) input.focus();
  } else if (event.key === 'Enter' && state.foodActiveIndex >= 0) {
    event.preventDefault();
    state.selectedFood = { ...state.foodResults[state.foodActiveIndex] }; state.foodQuantity = ''; state.foodUnit = 'g';
    render(); requestAnimationFrame(() => $('#food-quantity')?.focus());
  } else if (event.key === 'Escape') {
    state.foodResults = []; state.foodActiveIndex = -1; updateFoodDropdown();
  }
}
function updateFoodDropdown() {
  const results = $('#food-results');
  if (!results) return;
  results.innerHTML = renderFoodResults();
  const search = $('#food-search');
  if (search) { search.setAttribute('aria-expanded', String(Boolean(state.foodResults.length))); search.setAttribute('aria-activedescendant', state.foodActiveIndex >= 0 ? `food-option-${state.foodActiveIndex}` : ''); }
  bindFoodResults();
}
async function saveSessionDraft(event) { state.sessionDraft = collectSession(); if (event?.target?.dataset.field && !state.restTimer) startRestTimer(); }
function startRestTimer() { state.restTimer = 60; clearInterval(state.restInterval); const update = () => { const label = $('#rest-status'); if (label) label.textContent = state.restTimer > 0 ? `Rest ${formatDuration(state.restTimer)}` : 'Rest complete'; }; update(); state.restInterval = setInterval(() => { state.restTimer -= 1; update(); if (state.restTimer <= 0) clearInterval(state.restInterval); }, 1000); }
function startSession() { if (!state.sessionStarted) state.sessionStarted = Date.now(); render(); notify('Session timer started'); }
async function finishSession() { const exercises = collectSession(); const duration = state.sessionStarted ? Math.floor((Date.now() - state.sessionStarted) / 1000) : 0; await idbPut('sessionLogs', { id: todayKey(), date: todayKey(), duration, exercises, timestamp: new Date().toISOString() }); state.sessions = await idbAll('sessionLogs'); state.sessionStarted = null; state.sessionDraft = {}; render(); notify('Session saved'); }
async function clearSession() { await idbDelete('sessionLogs', todayKey()); state.sessions = state.sessions.filter(item => item.id !== todayKey()); state.sessionDraft = {}; state.sessionStarted = null; state.sessionSwap = {}; state.restTimer = 0; clearInterval(state.restInterval); render(); notify('Workout fields cleared'); }

async function searchFoods(query) {
  clearTimeout(state.fuelSearchTimer); const requestId = ++state.foodRequestId; if (query.trim().length < 3) { state.foodResults = []; updateFoodDropdown(); return; }
  state.fuelSearchTimer = setTimeout(async () => {
    const encodedQuery = encodeURIComponent(query);
    const endpoints = [
      `https://world.openfoodfacts.net/cgi/search.pl?search_terms=${encodedQuery}&search_simple=1&action=process&json=1&page_size=8`,
      `https://search.openfoodfacts.org/search?q=${encodedQuery}&size=8`
    ];
    try {
      let data = null;
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint);
          if (!response.ok) continue;
          const payload = await response.json();
          if (Array.isArray(payload.products)) { data = payload.products; break; }
          if (Array.isArray(payload.hits)) { data = payload.hits; break; }
        } catch (_) { /* Try the next official endpoint. */ }
      }
      if (requestId !== state.foodRequestId || query !== state.foodQuery) return;
      const apiResults = data?.map(product => ({ name: product.product_name || product.product_name_en || product.generic_name || 'Unnamed food', calories: Number(product.nutriments?.['energy-kcal_100g'] || 0), protein: Number(product.nutriments?.proteins_100g || 0), carbs: Number(product.nutriments?.carbohydrates_100g || 0), fats: Number(product.nutriments?.fat_100g || 0) })).filter(food => food.name !== 'Unnamed food') || [];
      const localResults = FOOD_FALLBACKS.filter(food => food.name.toLowerCase().includes(query.trim().toLowerCase()));
      state.foodResults = apiResults.length ? apiResults : localResults;
      if (!state.foodResults.length) throw new Error('Food API unavailable');
      updateFoodDropdown();
    } catch (_) {
      if (requestId !== state.foodRequestId || query !== state.foodQuery) return;
      state.foodResults = FOOD_FALLBACKS.filter(food => food.name.toLowerCase().includes(query.trim().toLowerCase()));
      updateFoodDropdown();
      if (!state.foodResults.length) notify('No matching food found. Try a broader search.');
    }
  }, 450);
}
async function addFood() { if (!state.selectedFood) return; const quantity = number($('#food-quantity')?.value ?? state.foodQuantity); if (!quantity || quantity <= 0 || !UNIT_TO_GRAMS[state.foodUnit]) { notify('Enter a quantity greater than zero'); $('#food-quantity')?.focus(); return; } const entry = { ...state.selectedFood, quantity, unit: state.foodUnit }; state.today.foods = [...(state.today.foods || []), entry]; await saveToday(); state.selectedFood = null; state.foodQuantity = ''; state.foodUnit = 'g'; state.foodResults = []; state.foodActiveIndex = -1; render(); notify('Food added'); requestAnimationFrame(() => $('#food-search')?.focus()); }
async function clearFuel() { state.today.foods = []; state.today.water = 0; state.foodQuery = ''; state.foodQuantity = ''; state.foodUnit = 'g'; state.foodResults = []; state.foodActiveIndex = -1; state.selectedFood = null; state.foodRequestId += 1; await saveToday(); render(); notify('Fuel fields cleared'); }
async function logWeight() { const field = $('#weight-log'); const weight = number(field?.value); if (!weight) { notify('Enter a weight first'); return; } await idbPut('weightLogs', { id: todayKey(), date: todayKey(), weight }); state.weights = await idbAll('weightLogs'); render(); notify('Morning weight saved'); }
async function logActivity(event) { event.preventDefault(); const type = $('#activity-type').value; const duration = number($('#activity-duration').value); const weight = number(state.profile?.weight); if (!type || !duration || !weight) { notify('Complete activity and profile details first'); return; } const mets = { Walking: 3.5, Running: 9.8, Swimming: 7.0 }; const calories = (mets[type] * 3.5 * weight / 200) * duration; await idbPut('activityLogs', { id: `${todayKey()}-${Date.now()}`, date: todayKey(), type, duration, calories, met: mets[type] }); state.activities = await idbAll('activityLogs'); render(); notify('Activity saved'); }

async function postNotification(payload) { if (!notificationsGranted() || !('serviceWorker' in navigator)) return; try { const registration = await navigator.serviceWorker.ready; const target = registration.active || registration.waiting || registration.installing; if (target) target.postMessage(payload); else await registration.showNotification(payload.title, { body: payload.body, icon: './icon.svg', tag: payload.tag }); } catch (_) {} }
async function requestNotifications() {
  if (!('Notification' in window)) { notify('Notifications are not supported here'); return; }
  try { const permission = await Notification.requestPermission(); if (permission === 'granted') { await navigator.serviceWorker?.ready; scheduleNotifications(); render(); notify('Reminders and daily quotes enabled'); } else notify('Reminders remain off'); } catch (_) { notify('Could not enable reminders'); }
}
async function registerPWA() {
  if ('serviceWorker' in navigator) { try { const registration = await navigator.serviceWorker.register('./sw.js'); window.dShiftRegistration = registration; } catch (_) {} }
  if (notificationsGranted()) scheduleNotifications();
}
const sentNotifications = new Set();
async function maybeSendDailyQuote() {
  if (!notificationsGranted() || state.quoteInFlight) return;
  const localDate = todayKey(); const now = new Date();
  if (state.settings.lastQuoteDate === localDate || now.getHours() < 8) return;
  state.quoteInFlight = true;
  const quote = getDailyQuote(localDate);
  await postNotification({ type: 'notify', title: 'D-Shift daily boost', body: `${quote.text} — ${quote.author}`, tag: `daily-quote-${localDate}`, data: { type: 'daily-quote', localDate, quoteId: quote.id, url: './' } });
  state.settings.lastQuoteDate = localDate; await idbPut('settings', { id: 'app', ...state.settings }); state.quoteInFlight = false;
}
function scheduleNotifications() {
  if (state.notificationInterval) clearInterval(state.notificationInterval);
  const check = async () => { const now = new Date(); const key = `${todayKey()}-${now.getHours()}:${now.getMinutes()}`; let body = ''; if (now.getHours() === 12 && now.getMinutes() === 0) body = 'Lunch is ready. Hit your first macro target.'; if (now.getHours() === 17 && now.getMinutes() === 0) body = 'Dinner is ready. Close out your fixed meal plan.'; if (now.getMinutes() === 0 && now.getHours() >= 8 && now.getHours() <= 20 && now.getHours() % 2 === 0) body = 'Hydration check. Log a cup of water now.'; if (body && !sentNotifications.has(key)) { sentNotifications.add(key); postNotification({ type: 'notify', title: 'D-Shift Workouts', body, tag: key }); } await maybeSendDailyQuote(); };
  check(); state.notificationInterval = setInterval(check, 30000);
}

async function init() {
  try {
    db = await openDB();
    state.profile = (await idbGet('profile', 'main')) || null;
    state.settings = (await idbGet('settings', 'app')) || { id: 'app', shifts: {}, rotaAnchor: todayKey() }; await idbPut('settings', state.settings);
    state.today = (await idbGet('dailyLogs', todayKey())) || { id: todayKey(), foods: [], water: 0 };
    state.weights = await idbAll('weightLogs'); state.activities = await idbAll('activityLogs'); state.sessions = await idbAll('sessionLogs');
    render(); registerPWA();
  } catch (error) { $('#app').innerHTML = `<section class="card empty-state"><strong>Storage unavailable</strong><p>D-Shift needs IndexedDB to keep your offline history private. Please reload in a browser with site storage enabled.</p></section>`; console.error(error); }
}
init();
