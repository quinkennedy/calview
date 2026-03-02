/**
 * events.js — Event segment algorithm + DragTracker
 */

// ── Date utilities ─────────────────────────────────────────────────────────────

/** Parse "YYYY-MM-DD" → Date (UTC midnight). */
export function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Format Date → "YYYY-MM-DD". */
export function formatDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Add N days to a date string, return new date string. */
export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return formatDate(d);
}

/** Return true if dateStr is within [a, b] inclusive (strings compared lexicographically). */
export function isBetween(dateStr, a, b) {
  return dateStr >= a && dateStr <= b;
}

/** Day of year (1-based). */
export function getDayOfYear(d) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86400000) + 1;
}

/** ISO week number (1-53). */
export function getISOWeek(d) {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Adjust to nearest Thursday
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = Date.UTC(tmp.getUTCFullYear(), 0, 1);
  return Math.ceil(((tmp.getTime() - yearStart) / 86400000 + 1) / 7);
}

/** Generate a simple unique id. */
export function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Event segment algorithm ────────────────────────────────────────────────────

/**
 * Compute event bar segments for every day in the grid.
 * Returns Map<dateStr, Segment[]> — segments sorted by lane.
 *
 * Segment = { eventId, name, color, role, lane, isStart }
 * role = "single" | "start" | "end" | "middle"
 */
export function getEventSegments(events, allDays, daysPerAxis) {
  // Build fast date→index lookup
  const dayIndex = new Map(allDays.map((d, i) => [d, i]));

  // Initialize result map
  const byDate = new Map();
  for (const d of allDays) byDate.set(d, []);

  // Sort events by start date for deterministic lane assignment
  const sorted = [...events].sort((a, b) => a.startDate.localeCompare(b.startDate));

  // axisOccupancy[axisIdx] = [{ lane, endDate }]
  const axisOccupancy = [];

  for (const evt of sorted) {
    // Find overlapping days (only those in the grid)
    const eventDays = allDays.filter(d => isBetween(d, evt.startDate, evt.endDate));
    if (eventDays.length === 0) continue;

    // Group days by axis index
    const groups = groupByAxis(eventDays, dayIndex, daysPerAxis);

    for (const { axisIdx, days } of groups) {
      if (!axisOccupancy[axisIdx]) axisOccupancy[axisIdx] = [];

      const lane = (evt.lane != null) ? evt.lane : findFreeLane(axisOccupancy[axisIdx], days[0]);
      axisOccupancy[axisIdx].push({ lane, endDate: days[days.length - 1] });

      for (let i = 0; i < days.length; i++) {
        const day = days[i];
        const isEventStart = day === evt.startDate;
        const isEventEnd   = day === evt.endDate;
        const leftRound    = isEventStart;
        const rightRound   = isEventEnd;

        let role;
        if (leftRound && rightRound)    role = 'single';
        else if (leftRound)             role = 'start';
        else if (rightRound)            role = 'end';
        else                            role = 'middle';

        byDate.get(day).push({
          eventId: evt.id,
          name:    evt.name,
          color:   evt.color,
          role,
          lane,
          isStart: i === 0,
        });
      }
    }
  }

  // Sort each day's segments by lane
  for (const segs of byDate.values()) {
    segs.sort((a, b) => a.lane - b.lane);
  }

  return byDate;
}

function groupByAxis(eventDays, dayIndex, daysPerAxis) {
  const groups = new Map(); // axisIdx → days[]
  for (const day of eventDays) {
    const idx = dayIndex.get(day);
    if (idx === undefined) continue;
    const axisIdx = Math.floor(idx / daysPerAxis);
    if (!groups.has(axisIdx)) groups.set(axisIdx, []);
    groups.get(axisIdx).push(day);
  }
  return [...groups.entries()].map(([axisIdx, days]) => ({ axisIdx, days }));
}

function findFreeLane(occupancy, segStartDate) {
  const occupied = new Set(
    occupancy.filter(o => o.endDate >= segStartDate).map(o => o.lane)
  );
  let lane = 0;
  while (occupied.has(lane)) lane++;
  return lane;
}

// ── DragTracker ────────────────────────────────────────────────────────────────

/**
 * Tracks a drag-to-select interaction across day cells.
 * Calls onDragComplete(startDate, endDate, allDatesInRange[]) when the drag ends.
 */
export class DragTracker {
  constructor(root, getAllDays, onDragComplete) {
    this._root = root;
    this._getAllDays = getAllDays;
    this._onDragComplete = onDragComplete;
    this._active = false;
    this._start = null;
    this._current = null;
    this._didMove = false;

    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseOver = this._handleMouseOver.bind(this);
    this._onMouseUp   = this._handleMouseUp.bind(this);

    root.addEventListener('mousedown', this._onMouseDown);
    root.addEventListener('mouseover', this._onMouseOver);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  destroy() {
    this._root.removeEventListener('mousedown', this._onMouseDown);
    this._root.removeEventListener('mouseover', this._onMouseOver);
    document.removeEventListener('mouseup', this._onMouseUp);
  }

  _handleMouseDown(e) {
    // Only left-button drags
    if (e.button !== 0) return;
    // Ignore clicks on event bars (those are handled separately)
    if (e.target.closest('.event-bar')) return;

    const cell = e.target.closest('.day-cell');
    if (!cell) return;

    e.preventDefault(); // prevent text selection
    this._active  = true;
    this._start   = cell.dataset.date;
    this._current = cell.dataset.date;
    this._didMove = false;
    this._updateHighlight();
  }

  _handleMouseOver(e) {
    if (!this._active) return;
    const cell = e.target.closest('.day-cell');
    if (!cell) return;

    const date = cell.dataset.date;
    if (date !== this._current) {
      this._current = date;
      this._didMove = true;
      this._updateHighlight();
    }
  }

  _handleMouseUp(e) {
    if (!this._active) return;
    this._active = false;
    this._clearHighlight();

    if (!this._start) return;

    const start   = this._start < this._current ? this._start : this._current;
    const end     = this._start < this._current ? this._current : this._start;
    const allDays = this._getAllDays();
    const dates   = allDays.filter(d => isBetween(d, start, end));

    // Always fire if any dates selected (single-day drag = single date)
    if (dates.length > 0) {
      this._onDragComplete(start, end, dates);
    }

    this._start   = null;
    this._current = null;
  }

  _updateHighlight() {
    this._clearHighlight();
    if (!this._start || !this._current) return;

    const start = this._start < this._current ? this._start : this._current;
    const end   = this._start < this._current ? this._current : this._start;

    this._root.querySelectorAll('.day-cell').forEach(cell => {
      if (isBetween(cell.dataset.date, start, end)) {
        cell.classList.add('drag-selected');
      }
    });
  }

  _clearHighlight() {
    this._root.querySelectorAll('.day-cell.drag-selected').forEach(cell => {
      cell.classList.remove('drag-selected');
    });
  }
}
