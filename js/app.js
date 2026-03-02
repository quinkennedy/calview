/**
 * app.js — State owner, CRUD operations, and inter-module coordination
 */

import { renderCalendar, getAllDays } from './calendar.js';
import { DragTracker, generateId, formatDate, isBetween } from './events.js';
import { initSettings, syncSettingsUI, renderClassList } from './settings.js';

// ── Default state ─────────────────────────────────────────────────────────────

const today = formatDate(new Date());
const yearStart = today.slice(0, 4) + '-01-01';
const yearEnd   = today.slice(0, 4) + '-12-31';

const DEFAULT_TEMPLATE = `<span class="month-label">{{monthLabel}}</span>
<span class="day-name">{{dayName}}</span>
<span class="day-number">{{dom}}</span>`;

const DEFAULT_CSS = `/* Calview — custom day styles
   Target days using auto-assigned classes like:
   .dow0 (Sunday), .dom1 (1st of month), .moy3 (March), .woy1, .today, etc.
*/

.day-cell {
  border: 1px solid #e0e0e0;
  padding: 4px 6px;
  font-size: 12px;
}

.day-cell .month-label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: #4a90d9;
  letter-spacing: 0.05em;
  min-height: 14px;
}

.day-cell .day-name {
  display: block;
  font-size: 10px;
  color: #999;
  text-transform: uppercase;
}

.day-cell .day-number {
  display: block;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.2;
}

.day-cell.today .day-number {
  color: #4a90d9;
}

/* Weekend shading */
.day-cell.dow0,
.day-cell.dow6 {
  background: #f8f8fb;
}
`;

const DEFAULT_STATE = {
  settings: {
    startDate:          yearStart,
    endDate:            yearEnd,
    focusStart:         yearStart,
    focusEnd:           yearEnd,
    daysPerAxis:        7,
    axisDirection:      'row',
    monthNamePlacement: 'first-day',
  },
  events:           [],
  classAssignments: [],
  customCSS:        DEFAULT_CSS,
  dayTemplate:      DEFAULT_TEMPLATE,
  dragMode:         'event',
};

// ── Module state ──────────────────────────────────────────────────────────────

let state = deepClone(DEFAULT_STATE);
let dragTracker = null;

// ── Entry point ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

function init() {
  // Settings panel
  initSettings(state, {
    onSettingsChange: handleSettingsChange,
    onCSSChange:      handleCSSChange,
    onTemplateChange: handleTemplateChange,
    onRemoveClass:    removeClassAssignment,
  });

  // Drag mode toggle
  document.getElementById('drag-mode-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    state.dragMode = btn.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === state.dragMode));
  });

  // Import / Export
  document.getElementById('btn-export').addEventListener('click', exportState);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-input').value = '';
    document.getElementById('import-input').click();
  });
  document.getElementById('import-input').addEventListener('change', e => {
    if (e.target.files[0]) handleImport(e.target.files[0]);
  });

  // Event dialog wiring
  wireEventDialog();

  // Class dialog wiring
  wireClassDialog();

  // Initial render
  renderAll();

  // Setup drag tracker after initial render (needs the calendar root)
  setupDragTracker();
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderAll() {
  applyCustomCSS(state.customCSS);
  renderCalendar(document.getElementById('calendar-root'), state);
  renderClassList(state.classAssignments, removeClassAssignment);
}

// ── Drag tracker setup ────────────────────────────────────────────────────────

function setupDragTracker() {
  if (dragTracker) dragTracker.destroy();
  const root = document.getElementById('calendar-root');
  dragTracker = new DragTracker(root, getAllDays, handleDragComplete);
}

function handleDragComplete(startDate, endDate, dates) {
  if (state.dragMode === 'event') {
    openCreateEventDialog(startDate, endDate);
  } else {
    openAssignClassDialog(dates);
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

function handleSettingsChange(newSettings) {
  state.settings = { ...state.settings, ...newSettings };
  renderAll();
}

function handleCSSChange(cssText) {
  state.customCSS = cssText;
  applyCustomCSS(cssText);
}

function handleTemplateChange(template) {
  state.dayTemplate = template;
  renderAll();
}

// ── Event CRUD ────────────────────────────────────────────────────────────────

function createEvent(data) {
  state.events.push({ id: generateId(), ...data });
  renderAll();
}

function updateEvent(id, patch) {
  const idx = state.events.findIndex(e => e.id === id);
  if (idx !== -1) state.events[idx] = { ...state.events[idx], ...patch };
  renderAll();
}

function deleteEvent(id) {
  state.events = state.events.filter(e => e.id !== id);
  renderAll();
}

// ── Class CRUD ────────────────────────────────────────────────────────────────

function assignClass(className, dates) {
  let ca = state.classAssignments.find(c => c.className === className);
  if (!ca) {
    ca = { className, dates: [] };
    state.classAssignments.push(ca);
  }
  // Deduplicate
  const set = new Set(ca.dates);
  dates.forEach(d => set.add(d));
  ca.dates = [...set].sort();
  renderAll();
}

function removeClassAssignment(className) {
  state.classAssignments = state.classAssignments.filter(c => c.className !== className);
  renderAll();
}

// ── Import / Export ───────────────────────────────────────────────────────────

function exportState() {
  const exportData = {
    settings:         state.settings,
    events:           state.events,
    classAssignments: state.classAssignments,
    customCSS:        state.customCSS,
    dayTemplate:      state.dayTemplate,
  };
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `calview-${formatDate(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function handleImport(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed.settings) throw new Error('Missing settings field.');
      if (!Array.isArray(parsed.events)) throw new Error('Missing events array.');

      state.settings         = { ...DEFAULT_STATE.settings, ...parsed.settings };
      state.events           = parsed.events || [];
      state.classAssignments = parsed.classAssignments || [];
      state.customCSS        = parsed.customCSS  ?? DEFAULT_CSS;
      state.dayTemplate      = parsed.dayTemplate ?? DEFAULT_TEMPLATE;

      syncSettingsUI(state);
      renderAll();
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ── Custom CSS ────────────────────────────────────────────────────────────────

function applyCustomCSS(cssText) {
  document.getElementById('custom-styles').textContent = cssText || '';
}

// ── Event dialog ──────────────────────────────────────────────────────────────

let _editingEventId = null;

function wireEventDialog() {
  const dialog    = document.getElementById('event-dialog');
  const form      = document.getElementById('event-form');
  const deleteBtn = document.getElementById('btn-event-delete');
  const cancelBtn = document.getElementById('btn-event-cancel');

  form.addEventListener('submit', e => {
    e.preventDefault();
    const laneRaw = form.elements['lane'].value;
    const data = {
      name:      form.elements['name'].value.trim(),
      color:     form.elements['color'].value,
      startDate: form.elements['startDate'].value,
      endDate:   form.elements['endDate'].value,
      lane:      laneRaw !== '' ? parseFloat(laneRaw) : null,
    };
    if (!data.name) { form.elements['name'].focus(); return; }
    if (data.startDate > data.endDate) {
      alert('Start date must be on or before end date.'); return;
    }
    if (_editingEventId) {
      updateEvent(_editingEventId, data);
    } else {
      createEvent(data);
    }
    dialog.close();
  });

  deleteBtn.addEventListener('click', () => {
    if (_editingEventId && confirm('Delete this event?')) {
      deleteEvent(_editingEventId);
      dialog.close();
    }
  });

  cancelBtn.addEventListener('click', () => dialog.close());

  // Event bar clicks use delegation on the calendar root
  document.getElementById('calendar-root').addEventListener('click', e => {
    const bar = e.target.closest('.event-bar');
    if (!bar) return;
    e.stopPropagation();
    const evt = state.events.find(ev => ev.id === bar.dataset.eventId);
    if (evt) openEditEventDialog(evt);
  });
}

function openCreateEventDialog(startDate, endDate) {
  _editingEventId = null;
  const dialog = document.getElementById('event-dialog');
  const form   = document.getElementById('event-form');

  document.getElementById('event-dialog-title').textContent = 'New Event';
  form.elements['name'].value      = '';
  form.elements['color'].value     = '#4a90d9';
  form.elements['startDate'].value = startDate;
  form.elements['endDate'].value   = endDate;
  form.elements['lane'].value      = '';
  document.getElementById('btn-event-delete').hidden = true;

  dialog.showModal();
  form.elements['name'].focus();
}

function openEditEventDialog(evt) {
  _editingEventId = evt.id;
  const dialog = document.getElementById('event-dialog');
  const form   = document.getElementById('event-form');

  document.getElementById('event-dialog-title').textContent = 'Edit Event';
  form.elements['name'].value      = evt.name;
  form.elements['color'].value     = evt.color;
  form.elements['startDate'].value = evt.startDate;
  form.elements['endDate'].value   = evt.endDate;
  form.elements['lane'].value      = evt.lane != null ? evt.lane : '';
  document.getElementById('btn-event-delete').hidden = false;

  dialog.showModal();
  form.elements['name'].focus();
}

// ── Class dialog ──────────────────────────────────────────────────────────────

let _pendingClassDates = [];

function wireClassDialog() {
  const dialog    = document.getElementById('class-dialog');
  const form      = document.getElementById('class-form');
  const cancelBtn = document.getElementById('btn-class-cancel');

  form.addEventListener('submit', e => {
    e.preventDefault();
    const className = form.elements['className'].value.trim();
    if (!className) { form.elements['className'].focus(); return; }
    assignClass(className, _pendingClassDates);
    dialog.close();
  });

  cancelBtn.addEventListener('click', () => dialog.close());
}

function openAssignClassDialog(dates) {
  _pendingClassDates = dates;
  const dialog = document.getElementById('class-dialog');
  const form   = document.getElementById('class-form');

  document.getElementById('class-dialog-info').textContent =
    `Assigning to ${dates.length} day${dates.length !== 1 ? 's' : ''}.`;
  form.elements['className'].value = '';

  dialog.showModal();
  form.elements['className'].focus();
}

// ── Utility ───────────────────────────────────────────────────────────────────

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
