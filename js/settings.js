/**
 * settings.js — Settings panel UI
 * Manages the 4-tab collapsible sidebar:
 *   Layout | Template | CSS | Classes
 */

let _onSettingsChange = null;
let _onCSSChange = null;
let _onTemplateChange = null;
let _onRemoveClass = null;
let _currentSettings = null;

let cssDebounceTimer = null;

export function initSettings(state, { onSettingsChange, onCSSChange, onTemplateChange, onRemoveClass }) {
  _onSettingsChange = onSettingsChange;
  _onCSSChange = onCSSChange;
  _onTemplateChange = onTemplateChange;
  _onRemoveClass = onRemoveClass;
  _currentSettings = state.settings;

  syncSettingsUI(state);
  wireTabs();
  wirePanel();
  wireLayoutForm();
  wireTemplateEditor(state.dayTemplate);
  wireCSSEditor(state.customCSS);
}

/** Sync all UI inputs to the given state (called after import). */
export function syncSettingsUI(state) {
  _currentSettings = state.settings;
  const s = state.settings;
  const form = document.getElementById('settings-form');

  form.elements['startDate'].value   = s.startDate  || '';
  form.elements['endDate'].value     = s.endDate    || '';
  form.elements['focusStart'].value  = s.focusStart || '';
  form.elements['focusEnd'].value    = s.focusEnd   || '';
  form.elements['daysPerAxis'].value = s.daysPerAxis;

  const dirInput = form.querySelector(`input[name="axisDirection"][value="${s.axisDirection}"]`);
  if (dirInput) dirInput.checked = true;

  const mplInput = form.querySelector(`input[name="monthNamePlacement"][value="${s.monthNamePlacement}"]`);
  if (mplInput) mplInput.checked = true;

  const printSizeEl = form.elements['printSize'];
  if (printSizeEl) printSizeEl.value = s.printSize || '';

  const printTitleEl = form.elements['printTitle'];
  if (printTitleEl) printTitleEl.value = s.printTitle || '';

  const cssEditor = document.getElementById('css-editor');
  if (cssEditor) cssEditor.value = state.customCSS || '';

  const templateEditor = document.getElementById('template-editor');
  if (templateEditor) templateEditor.value = state.dayTemplate || '';
}

/** Re-render the Classes tab list. */
export function renderClassList(classAssignments, onRemoveClass) {
  const list = document.getElementById('class-assignments-list');
  list.innerHTML = '';

  if (!classAssignments || classAssignments.length === 0) {
    list.innerHTML = '<p class="no-classes-msg">No class assignments yet.</p>';
    return;
  }

  for (const ca of classAssignments) {
    const row = document.createElement('div');
    row.className = 'class-assignment-row';

    const name = document.createElement('span');
    name.className = 'class-assignment-name';
    name.textContent = '.' + ca.className;

    const count = document.createElement('span');
    count.className = 'class-assignment-count';
    count.textContent = `${ca.dates.length} day${ca.dates.length !== 1 ? 's' : ''}`;

    const btn = document.createElement('button');
    btn.className = 'btn-remove-class';
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => onRemoveClass(ca.className));

    row.append(name, count, btn);
    list.appendChild(row);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function wireTabs() {
  const tabButtons = document.querySelectorAll('.tabs .tab');
  const tabPanels  = document.querySelectorAll('.tab-panel');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      tabPanels.forEach(p => { p.classList.remove('active'); p.hidden = true; });

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const panel = document.getElementById('tab-' + btn.dataset.tab);
      if (panel) { panel.classList.add('active'); panel.hidden = false; }
    });
  });
}

function wirePanel() {
  const panel  = document.getElementById('settings-panel');
  const toggle = document.getElementById('btn-toggle-settings');

  toggle.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    panel.setAttribute('aria-hidden', String(collapsed));
  });
}

function wireLayoutForm() {
  const form   = document.getElementById('settings-form');
  const cancel = document.getElementById('btn-settings-cancel');

  form.addEventListener('submit', e => {
    e.preventDefault();
    const s = readFormValues(form);
    const { valid, errors } = validateSettings(s);
    if (!valid) { alert('Invalid settings:\n' + errors.join('\n')); return; }
    _currentSettings = s;
    _onSettingsChange(s);
  });

  cancel.addEventListener('click', () => {
    // Reset form to current settings
    const form = document.getElementById('settings-form');
    const s = _currentSettings;
    form.elements['startDate'].value   = s.startDate  || '';
    form.elements['endDate'].value     = s.endDate    || '';
    form.elements['focusStart'].value  = s.focusStart || '';
    form.elements['focusEnd'].value    = s.focusEnd   || '';
    form.elements['daysPerAxis'].value = s.daysPerAxis;
    if (form.elements['printSize'])  form.elements['printSize'].value  = s.printSize  || '';
    if (form.elements['printTitle']) form.elements['printTitle'].value = s.printTitle || '';
  });
}

function wireTemplateEditor(initialTemplate) {
  const editor  = document.getElementById('template-editor');
  const preview = document.getElementById('template-preview');
  const applyBtn = document.getElementById('btn-apply-template');

  editor.value = initialTemplate || '';
  updateTemplatePreview(editor.value, preview);

  editor.addEventListener('input', () => {
    updateTemplatePreview(editor.value, preview);
  });

  applyBtn.addEventListener('click', () => {
    _onTemplateChange(editor.value);
  });
}

function wireCSSEditor(initialCSS) {
  const editor = document.getElementById('css-editor');
  editor.value = initialCSS || '';

  editor.addEventListener('input', () => {
    clearTimeout(cssDebounceTimer);
    cssDebounceTimer = setTimeout(() => {
      _onCSSChange(editor.value);
    }, 300);
  });
}

function readFormValues(form) {
  return {
    startDate:          form.elements['startDate'].value,
    endDate:            form.elements['endDate'].value,
    focusStart:         form.elements['focusStart'].value,
    focusEnd:           form.elements['focusEnd'].value,
    daysPerAxis:        parseInt(form.elements['daysPerAxis'].value, 10) || 7,
    axisDirection:      form.querySelector('input[name="axisDirection"]:checked')?.value || 'row',
    monthNamePlacement: form.querySelector('input[name="monthNamePlacement"]:checked')?.value || 'first-day',
    printSize:          form.elements['printSize']?.value || '',
    printTitle:         form.elements['printTitle']?.value || '',
  };
}

function validateSettings(s) {
  const errors = [];
  if (!s.startDate)  errors.push('Start date is required.');
  if (!s.endDate)    errors.push('End date is required.');
  if (s.startDate && s.endDate && s.startDate > s.endDate) errors.push('Start date must be before end date.');
  if (s.focusStart && s.focusEnd && s.focusStart > s.focusEnd) errors.push('Focus start must be before focus end.');
  if (s.daysPerAxis < 1) errors.push('Days per axis must be at least 1.');
  return { valid: errors.length === 0, errors };
}

function updateTemplatePreview(template, previewEl) {
  // Use a fixed sample date for preview
  const sampleDate = new Date(Date.UTC(2026, 2, 15)); // 2026-03-15, Sunday
  const vars = {
    date:          '2026-03-15',
    year:          '2026',
    moy:           '3',
    monthName:     'Mar',
    monthNameFull: 'March',
    dom:           '15',
    dow:           '0',
    dayName:       'Sun',
    dayNameFull:   'Sunday',
    doy:           '74',
    woy:           '11',
    monthLabel:    'Mar',
  };
  const html = renderTemplate(template, vars);
  previewEl.innerHTML = html;
}

function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}
