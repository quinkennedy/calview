/**
 * calendar.js — Calendar grid rendering, template engine, auto-class computation
 */

import { getEventSegments, parseDate, getDayOfYear, getISOWeek, isBetween, formatDate, addDays } from './events.js';

const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_NAMES_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES_SHORT   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_NAMES_FULL    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const TODAY = formatDate(new Date());

// Module-level cache of allDays so DragTracker can access them
let _allDays = [];

/** Returns the current allDays array (used by DragTracker). */
export function getAllDays() { return _allDays; }

/**
 * Full re-render of the calendar grid.
 * @param {HTMLElement} root   - #calendar-root
 * @param {object}      state  - full application state
 */
export function renderCalendar(root, state) {
  const { settings, events, classAssignments, dayTemplate } = state;
  const { startDate, endDate, focusStart, focusEnd, daysPerAxis, axisDirection } = settings;

  // Build allDays
  _allDays = buildAllDays(startDate, endDate);
  if (_allDays.length === 0) { root.innerHTML = ''; return; }

  // Configure root element
  root.dataset.axis = axisDirection;
  root.style.setProperty('--days-per-axis', daysPerAxis);

  // Compute event segments
  const segmentsByDate = getEventSegments(events, _allDays, daysPerAxis);

  // Build fragment
  const frag = document.createDocumentFragment();

  for (let i = 0; i < _allDays.length; i++) {
    const dateStr  = _allDays[i];
    const prevDate = i > 0 ? _allDays[i - 1] : null;
    const axisIndex = i % daysPerAxis;
    const axisStart = i - axisIndex; // index of first day in this axis group

    const segments = segmentsByDate.get(dateStr) || [];
    const cell = buildDayCell(dateStr, prevDate, axisIndex, axisStart, settings, classAssignments, dayTemplate, segments);
    frag.appendChild(cell);
  }

  root.innerHTML = '';
  root.appendChild(frag);
}

// ── Day cell builder ──────────────────────────────────────────────────────────

function buildDayCell(dateStr, prevDate, axisIndex, axisStart, settings, classAssignments, dayTemplate, segments) {
  const cell = document.createElement('div');
  cell.className = 'day-cell';
  cell.dataset.date = dateStr;

  // Auto CSS classes
  const autoClasses = getAutoClasses(dateStr, settings, classAssignments);
  cell.classList.add(...autoClasses);

  // Template content
  const vars = getTemplateVars(dateStr, prevDate, axisIndex, axisStart, settings);
  const templateDiv = document.createElement('div');
  templateDiv.className = 'day-template-content';
  templateDiv.innerHTML = renderTemplate(dayTemplate, vars);
  cell.appendChild(templateDiv);

  // Event bars
  const barsEl = buildEventBars(segments);
  cell.appendChild(barsEl);

  return cell;
}

// ── Auto CSS classes ──────────────────────────────────────────────────────────

function getAutoClasses(dateStr, settings, classAssignments) {
  const d = parseDate(dateStr);
  const classes = [
    `dow${d.getUTCDay()}`,
    `dom${d.getUTCDate()}`,
    `moy${d.getUTCMonth() + 1}`,
    `doy${getDayOfYear(d)}`,
    `woy${getISOWeek(d)}`,
    `date-${dateStr}`,
  ];

  if (dateStr === TODAY) classes.push('today');

  const fs = settings.focusStart || settings.startDate;
  const fe = settings.focusEnd   || settings.endDate;
  if (!isBetween(dateStr, fs, fe)) classes.push('unfocused');

  for (const ca of classAssignments) {
    if (ca.dates.includes(dateStr)) classes.push(ca.className);
  }

  return classes;
}

// ── Template engine ───────────────────────────────────────────────────────────

function getTemplateVars(dateStr, prevDate, axisIndex, axisStart, settings) {
  const d = parseDate(dateStr);
  const monthLabel = getMonthLabel(dateStr, prevDate, axisIndex, axisStart, settings);

  return {
    date:          dateStr,
    year:          String(d.getUTCFullYear()),
    moy:           String(d.getUTCMonth() + 1),
    monthName:     MONTH_NAMES_SHORT[d.getUTCMonth()],
    monthNameFull: MONTH_NAMES_FULL[d.getUTCMonth()],
    dom:           String(d.getUTCDate()),
    dow:           String(d.getUTCDay()),
    dayName:       DAY_NAMES_SHORT[d.getUTCDay()],
    dayNameFull:   DAY_NAMES_FULL[d.getUTCDay()],
    doy:           String(getDayOfYear(d)),
    woy:           String(getISOWeek(d)),
    monthLabel:    monthLabel,
  };
}

export function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

// ── Month label logic ─────────────────────────────────────────────────────────

function getMonthLabel(dateStr, prevDate, axisIndex, axisStart, settings) {
  const { monthNamePlacement } = settings;
  const d = parseDate(dateStr);

  if (monthNamePlacement === 'first-day') {
    // Show on the 1st of each month, or on the very first cell
    if (d.getUTCDate() === 1 || prevDate === null) {
      return MONTH_NAMES_SHORT[d.getUTCMonth()];
    }
    return '';
  }

  if (monthNamePlacement === 'axis-start') {
    // Show only on the first cell of each axis group (axisIndex === 0)
    if (axisIndex !== 0) return '';

    // First cell in the grid → always show
    if (prevDate === null) return MONTH_NAMES_SHORT[d.getUTCMonth()];

    // Check if the previous axis-0 cell is in a different month
    if (prevDate) {
      const prevD = parseDate(prevDate);
      if (prevD.getUTCMonth() !== d.getUTCMonth()) {
        return MONTH_NAMES_SHORT[d.getUTCMonth()];
      }
    }

    // Also show if any day in this axis contains the 1st of a new month
    // (handles case where axis-0 is still in old month but 1st is mid-axis)
    const allDays = getAllDays();
    for (let i = axisStart; i < axisStart + settings.daysPerAxis && i < allDays.length; i++) {
      const pd = parseDate(allDays[i]);
      if (pd.getUTCDate() === 1 && pd.getUTCMonth() !== d.getUTCMonth()) {
        return MONTH_NAMES_SHORT[pd.getUTCMonth()];
      }
    }

    return '';
  }

  return '';
}

// ── Color utils ───────────────────────────────────────────────────────────────

function isLightColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Perceived luminance (ITU-R BT.709)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 160;
}

// ── Event bars ────────────────────────────────────────────────────────────────

function buildEventBars(segments) {
  const container = document.createElement('div');
  container.className = 'event-bars';

  if (segments.length === 0) return container;

  // Use absolute positioning keyed on lane value (supports floats for overlaps).
  // Height of container = (maxLane + 1) slots.
  const maxLane = segments.reduce((m, s) => Math.max(m, s.lane), 0);
  const slotCount = Math.floor(maxLane) + 1;
  container.style.setProperty('--bar-slot-count', slotCount);

  for (const seg of segments) {
    const bar = document.createElement('div');
    bar.className = `event-bar ${seg.role}`;
    bar.style.setProperty('--event-color', seg.color);
    bar.style.setProperty('--event-text-color', isLightColor(seg.color) ? '#111' : '#fff');
    bar.style.setProperty('--bar-lane', seg.lane);
    bar.dataset.eventId = seg.eventId;
    if (seg.isStart) bar.textContent = seg.name;
    container.appendChild(bar);
  }

  return container;
}

// ── allDays builder ───────────────────────────────────────────────────────────

function buildAllDays(startDate, endDate) {
  if (!startDate || !endDate || startDate > endDate) return [];
  const days = [];
  let cur = startDate;
  while (cur <= endDate) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  return days;
}
