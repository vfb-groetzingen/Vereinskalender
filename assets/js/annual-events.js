const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = 'annual-event-files';
let monthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let currentEvents = [];
let rerenderPage = null;

function safeHtml(input) {
  const parsed = new DOMParser().parseFromString(`<div>${input || ''}</div>`, 'text/html');
  const allowed = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'H2', 'H3', 'A', 'IMG', 'BLOCKQUOTE']);
  const walk = (node) => {
    const out = document.createDocumentFragment();
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) { out.append(document.createTextNode(child.textContent)); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (!allowed.has(child.tagName)) { out.append(...walk(child).childNodes); continue; }
      const el = document.createElement(child.tagName.toLowerCase());
      if (child.tagName === 'A') {
        const href = child.getAttribute('href') || '';
        if (/^(https?:|mailto:)/i.test(href)) { el.setAttribute('href', href); el.setAttribute('rel', 'noopener noreferrer'); }
      }
      if (child.tagName === 'IMG') {
        const cid = child.getAttribute('data-inline-cid');
        if (!cid) continue;
        el.setAttribute('src', `cid:${cid}`);
        el.setAttribute('alt', child.getAttribute('alt') || 'Eingebettetes Bild');
        el.setAttribute('data-inline-cid', cid);
      } else el.append(...walk(child).childNodes);
      out.append(el);
    }
    return out;
  };
  const holder = document.createElement('div');
  holder.append(...walk(parsed.body.firstElementChild).childNodes);
  return holder.innerHTML;
}

function fileTotal(assets) { return assets.reduce((sum, asset) => sum + Number(asset.size || 0), 0); }
function dateKey(event) { return `${String(event.event_month).padStart(2, '0')}-${String(event.event_day).padStart(2, '0')}`; }
function monthName(date) { return date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }); }
function eventLabel(event) { return `${String(event.event_day).padStart(2, '0')}.${String(event.event_month).padStart(2, '0')}. · ${event.title}`; }

export async function renderAnnualEvents(app, store, setNotice) {
  if (store.mode !== 'supabase' || !store.isEditor()) {
    app.innerHTML = '<section class="section"><h1>Jährliche Ereignisse</h1><p class="notice notice-error">Dieser Bereich ist nur für angemeldete Bearbeiter und Administratoren verfügbar.</p></section>';
    return;
  }
  currentEvents = await store.getAnnualEvents();
  rerenderPage = () => renderAnnualEvents(app, store, setNotice);
  drawCalendar(app, store, setNotice);
}

function drawCalendar(app, store, setNotice) {
  const monthEvents = currentEvents.filter((event) => Number(event.event_month) === monthCursor.getMonth() + 1).sort((a, b) => Number(a.event_day) - Number(b.event_day));
  const firstDay = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const days = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push('<div class="annual-day annual-day-empty" aria-hidden="true"></div>');
  for (let day = 1; day <= days; day++) {
    const events = monthEvents.filter((event) => Number(event.event_day) === day);
    cells.push(`<div class="annual-day" data-month="${monthCursor.getMonth() + 1}" data-day="${day}"><span class="annual-day-number">${day}</span>${events.map((event) => `<button class="annual-event-chip" type="button" data-edit-event="${esc(event.id)}">${esc(event.title)}</button>`).join('')}</div>`);
  }
  app.innerHTML = `
    <section class="hero annual-hero"><div><p class="crumbs">Verwaltung</p><h1>Jährliche Ereignisse</h1><p>Jährlich wiederkehrende Ereignisse und ihre automatischen E-Mail-Erinnerungen.</p></div>
      <button type="button" class="btn btn-primary" id="annual-new">Ereignis anlegen</button></section>
    <section class="section annual-section">
      <div class="annual-toolbar"><button type="button" class="btn" id="annual-prev" aria-label="Vorheriger Monat">‹</button><h2>${esc(monthName(monthCursor))}</h2><button type="button" class="btn" id="annual-next" aria-label="Nächster Monat">›</button><button type="button" class="btn btn-small" id="annual-today">Heute</button></div>
      <p class="hint">Doppelklick oder Rechtsklick auf einen Tag legt dort ein neues Ereignis an.</p>
      <div class="annual-calendar" role="grid" aria-label="Kalender für ${esc(monthName(monthCursor))}">
        ${['Mo','Di','Mi','Do','Fr','Sa','So'].map((day) => `<div class="annual-weekday" role="columnheader">${day}</div>`).join('')}
        ${cells.join('')}
      </div>
      <h2 class="annual-list-heading">Ereignisse im ${esc(monthName(monthCursor))}</h2>
      ${monthEvents.length ? `<ul class="annual-event-list">${monthEvents.map((event) => `<li><button type="button" class="link-btn" data-edit-event="${esc(event.id)}">${esc(eventLabel(event))}</button><span>${event.recipients.length} Empfänger · ${event.active ? 'aktiv' : 'pausiert'}</span></li>`).join('')}</ul>` : '<p class="empty">Keine Ereignisse in diesem Monat.</p>'}
    </section>`;
  app.querySelector('#annual-prev').onclick = () => { monthCursor.setMonth(monthCursor.getMonth() - 1); drawCalendar(app, store, setNotice); };
  app.querySelector('#annual-next').onclick = () => { monthCursor.setMonth(monthCursor.getMonth() + 1); drawCalendar(app, store, setNotice); };
  app.querySelector('#annual-today').onclick = () => { monthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1); drawCalendar(app, store, setNotice); };
  app.querySelector('#annual-new').onclick = () => openEventForm(app, store, setNotice, null);
  app.querySelectorAll('[data-edit-event]').forEach((button) => button.onclick = () => openEventForm(app, store, setNotice, currentEvents.find((event) => event.id === button.dataset.editEvent)));
  const calendar = app.querySelector('.annual-calendar');
  const createFromCell = (event) => {
    if (event.target.closest('[data-edit-event]')) return;
    const cell = event.target.closest('.annual-day[data-month][data-day]');
    if (!cell) return;
    event.preventDefault();
    openEventForm(app, store, setNotice, null, { month: Number(cell.dataset.month), day: Number(cell.dataset.day) });
  };
  calendar.addEventListener('dblclick', createFromCell);
  calendar.addEventListener('contextmenu', createFromCell);
}

function openEventForm(app, store, setNotice, event, initialDate = null) {
  const id = event?.id || crypto.randomUUID();
  let assets = (event?.assets || []).map((asset) => ({ ...asset }));
  const newlyUploaded = [];
  const removedAssets = [];
  let saved = false;
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog dialog-wide';
  dialog.id = 'annual-event-dialog';
  const selectedMonth = event?.event_month || initialDate?.month || (monthCursor.getMonth() + 1);
  const selectedDay = event?.event_day || initialDate?.day || 1;
  const dateValue = `2000-${String(selectedMonth).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
  const recipients = event?.recipients?.length ? event.recipients : [''];
  dialog.innerHTML = `<div class="dialog-inner"><header class="dialog-head"><h2>${event ? 'Ereignis bearbeiten' : 'Jährliches Ereignis anlegen'}</h2><button class="btn btn-ghost" type="button" data-close aria-label="Schließen">×</button></header>
    <div class="dialog-body"><form id="annual-event-form" class="form" novalidate>
      <div class="field"><label for="ae-title">Ereignisname *</label><input id="ae-title" class="input" maxlength="160" required value="${esc(event?.title || '')}"></div>
      <div class="field-row"><div class="field"><label for="ae-date">Jährliches Datum (Tag und Monat) *</label><input id="ae-date" class="input" type="date" value="${dateValue}" required><p class="hint">Der Versand ist für 06:00 Uhr deutscher Zeit am Ereignistag vorgesehen. Der 29. Februar gilt nur in Schaltjahren.</p></div>
      <div class="field"><label for="ae-subject">Betreffzeile *</label><input id="ae-subject" class="input" maxlength="200" required value="${esc(event?.subject || '')}"></div></div>
      <div class="field"><fieldset class="annual-recipients"><legend>E-Mail-Empfänger (bis zu 10) *</legend><div id="ae-recipients">${recipients.map((email, i) => recipientRow(email, i)).join('')}</div><button type="button" class="btn btn-small" id="ae-add-recipient">Empfänger hinzufügen</button></fieldset></div>
      <div class="field"><label>Nachricht *</label><div class="annual-editor-toolbar" role="toolbar" aria-label="Text formatieren">
        <button type="button" class="btn btn-small" data-command="bold" aria-label="Fett">Fett</button><button type="button" class="btn btn-small" data-command="italic" aria-label="Kursiv">Kursiv</button><button type="button" class="btn btn-small" data-command="underline" aria-label="Unterstrichen">Unterstrichen</button><button type="button" class="btn btn-small" data-command="insertUnorderedList">Aufzählung</button><button type="button" class="btn btn-small" data-command="insertOrderedList">Nummerierung</button>
        <button type="button" class="btn btn-small" id="ae-add-link">Link</button><button type="button" class="btn btn-small" id="ae-add-image">Bild einbetten</button><button type="button" class="btn btn-small" id="ae-add-file">Anhang hinzufügen</button></div>
        <div id="ae-body" class="annual-editor" contenteditable="true" role="textbox" aria-label="Formatierte E-Mail-Nachricht" aria-multiline="true">${safeHtml(event?.body_html || '<p></p>')}</div><p class="hint">Bilder werden automatisch auf maximal 1600 Pixel verkleinert. Bilder und Anhänge zusammen höchstens 5 MB.</p>
      </div>
      <input type="file" id="ae-image-file" accept="image/*" hidden><input type="file" id="ae-attach-file" hidden>
      <div class="field"><strong>Dateien</strong><ul id="ae-assets" class="annual-assets"></ul><p id="ae-size" class="hint"></p></div>
      <label class="check"><input id="ae-active" type="checkbox" ${event?.active === false ? '' : 'checked'}> Ereignis aktiv – E-Mail jährlich versenden</label>
      ${event ? '<details class="annual-log"><summary>Letzte Versandversuche</summary><div id="ae-log" class="hint">Versandprotokoll wird geladen …</div></details>' : ''}
      <p class="msg" id="ae-msg" role="alert"></p><div class="dialog-actions"><button type="button" class="btn" data-close>Abbrechen</button>${event ? '<button type="button" class="btn btn-danger" id="ae-delete">Löschen</button>' : ''}<button type="submit" class="btn btn-primary" id="ae-save">Speichern</button></div>
    </form></div></div>`;
  document.body.appendChild(dialog);
  dialog.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => dialog.close());
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (!saved) newlyUploaded.forEach((asset) => store.deleteAnnualAsset(asset.path).catch(() => {}));
  });
  dialog.showModal();
  const q = (selector) => dialog.querySelector(selector);
  const msg = (text) => { q('#ae-msg').textContent = text; };
  const updateAssets = () => {
    q('#ae-assets').innerHTML = assets.map((asset, i) => `<li><span>${esc(asset.inline ? 'Eingebettetes Bild' : 'Anhang')}: ${esc(asset.filename)} (${(asset.size / 1024).toFixed(0)} KB)</span><button class="link-btn" type="button" data-remove-asset="${i}">Entfernen</button></li>`).join('') || '<li>Keine Dateien hinzugefügt.</li>';
    q('#ae-size').textContent = `Gesamt: ${(fileTotal(assets) / 1024 / 1024).toFixed(2)} MB von 5 MB`;
    q('#ae-assets').querySelectorAll('[data-remove-asset]').forEach((button) => button.onclick = async () => {
      const asset = assets[Number(button.dataset.removeAsset)];
      if (!confirm(`Datei „${asset.filename}“ entfernen?`)) return;
      assets = assets.filter((item) => item !== asset);
      removedAssets.push(asset);
      if (asset.inline) q('#ae-body').querySelectorAll(`[data-inline-cid="${CSS.escape(asset.cid)}"]`).forEach((img) => img.remove());
      updateAssets();
    });
  };
  updateAssets();
  if (event) store.getAnnualDeliveryLog(event.id).then((rows) => {
    const log = q('#ae-log');
    if (!log) return;
    log.innerHTML = rows.length ? `<ul>${rows.map((row) => `<li>${esc(row.occurrence_year)} · ${esc(row.recipient)} · ${row.status === 'sent' ? 'Gesendet' : row.status === 'failed' ? 'Fehler' : 'Ausstehend'}${row.sent_at ? ` · ${esc(new Date(row.sent_at).toLocaleString('de-DE'))}` : ''}${row.error ? `<br><span class="notice-error">${esc(row.error)}</span>` : ''}</li>`).join('')}</ul>` : 'Noch keine Versandversuche protokolliert.';
  }).catch(() => { if (q('#ae-log')) q('#ae-log').textContent = 'Versandprotokoll derzeit nicht verfügbar.'; });
  q('#ae-add-recipient').onclick = () => {
    const list = q('#ae-recipients');
    const count = list.querySelectorAll('input').length;
    if (count >= 10) return msg('Es sind höchstens 10 Empfänger möglich.');
    list.insertAdjacentHTML('beforeend', recipientRow('', count));
    bindRecipientRemove(list);
    list.querySelectorAll('input')[count].focus();
  };
  bindRecipientRemove(q('#ae-recipients'));
  dialog.querySelectorAll('[data-command]').forEach((button) => button.onclick = () => {
    q('#ae-body').focus(); document.execCommand(button.dataset.command, false, null);
  });
  q('#ae-add-link').onclick = () => {
    const url = prompt('Webadresse des Links (https://...)');
    if (url && /^(https?:|mailto:)/i.test(url)) { q('#ae-body').focus(); document.execCommand('createLink', false, url); }
  };
  q('#ae-add-image').onclick = () => q('#ae-image-file').click();
  q('#ae-add-file').onclick = () => q('#ae-attach-file').click();
  q('#ae-image-file').onchange = async (e) => { if (e.target.files[0]) await addAsset(e.target.files[0], true); e.target.value = ''; };
  q('#ae-attach-file').onchange = async (e) => { if (e.target.files[0]) await addAsset(e.target.files[0], false); e.target.value = ''; };

  async function addAsset(file, inline) {
    msg('');
    try {
      let prepared = file;
      if (file.type.startsWith('image/')) prepared = await resizeImage(file);
      else if (inline) throw new Error('Bitte eine Bilddatei auswählen.');
      if (fileTotal(assets) + prepared.size > MAX_BYTES) throw new Error('Die gemeinsame Dateigröße darf 5 MB nicht überschreiten.');
      if (!inline && !prepared.type) prepared = new File([prepared], prepared.name, { type: 'application/octet-stream' });
      const path = await store.uploadAnnualAsset(id, prepared);
      const asset = { path, filename: prepared.name, content_type: prepared.type || 'application/octet-stream', size: prepared.size, inline, cid: inline ? crypto.randomUUID() : null };
      assets.push(asset);
      newlyUploaded.push(asset);
      updateAssets();
      if (inline) {
        const image = document.createElement('img'); image.src = `cid:${asset.cid}`; image.alt = prepared.name; image.dataset.inlineCid = asset.cid; image.className = 'annual-inline-image';
        q('#ae-body').append(image);
      }
    } catch (error) { msg(error.message || 'Datei konnte nicht verarbeitet werden.'); }
  }

  if (event) q('#ae-delete').onclick = async () => {
    if (!confirm(`Das Ereignis „${event.title}“ dauerhaft löschen?`)) return;
    q('#ae-delete').disabled = true;
    try {
      for (const asset of assets) await store.deleteAnnualAsset(asset.path);
      await store.deleteAnnualEvent(event.id);
      saved = true;
      dialog.close(); setNotice('ok', 'Ereignis wurde gelöscht.'); await rerenderPage();
    } catch (error) { msg(error.message || 'Ereignis konnte nicht gelöscht werden.'); q('#ae-delete').disabled = false; }
  };

  q('#annual-event-form').onsubmit = async (e) => {
    e.preventDefault(); msg('');
    const title = q('#ae-title').value.trim();
    const subject = q('#ae-subject').value.trim();
    const date = q('#ae-date').value;
    const [year, month, day] = date.split('-').map(Number);
    const emails = [...q('#ae-recipients').querySelectorAll('input')].map((input) => input.value.trim()).filter(Boolean);
    const body = safeHtml(q('#ae-body').innerHTML);
    if (!title || !subject || !date || !body.replace(/<[^>]*>/g, '').trim()) return msg('Bitte Name, Datum, Betreff und Nachricht ausfüllen.');
    if (!emails.length || emails.length > 10 || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return msg('Bitte 1 bis 10 gültige E-Mail-Adressen eingeben.');
    if (new Set(emails.map((email) => email.toLowerCase())).size !== emails.length) return msg('Eine E-Mail-Adresse ist mehrfach eingetragen.');
    if (fileTotal(assets) > MAX_BYTES) return msg('Die Dateigröße liegt über 5 MB.');
    q('#ae-save').disabled = true;
    try {
      await store.saveAnnualEvent({ id, title, event_month: month, event_day: day, recipients: emails, subject, body_html: body, assets, active: q('#ae-active').checked });
      for (const asset of removedAssets) await store.deleteAnnualAsset(asset.path);
      saved = true;
      dialog.close(); setNotice('ok', 'Jährliches Ereignis wurde gespeichert.'); monthCursor = new Date(monthCursor.getFullYear(), month - 1, 1); await rerenderPage();
    } catch (error) { msg(error.message || 'Ereignis konnte nicht gespeichert werden.'); q('#ae-save').disabled = false; }
  };
  q('#ae-title').focus();
}

function recipientRow(email, index) {
  return `<div class="annual-recipient-row"><label for="ae-email-${index}">E-Mail ${index + 1}</label><input class="input" id="ae-email-${index}" type="email" maxlength="254" value="${esc(email)}" autocomplete="email"><button class="link-btn" type="button" data-remove-recipient aria-label="Empfänger ${index + 1} entfernen">Entfernen</button></div>`;
}
function bindRecipientRemove(container) {
  container.querySelectorAll('[data-remove-recipient]').forEach((button) => button.onclick = () => {
    if (container.querySelectorAll('input').length <= 1) { container.querySelector('input').value = ''; return; }
    button.closest('.annual-recipient-row').remove();
    container.querySelectorAll('.annual-recipient-row').forEach((row, index) => {
      row.querySelector('label').textContent = `E-Mail ${index + 1}`;
      row.querySelector('label').htmlFor = `ae-email-${index}`;
      row.querySelector('input').id = `ae-email-${index}`;
    });
  });
}

async function resizeImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Bitte eine Bilddatei auswählen.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Bild konnte nicht verkleinert werden.')), 'image/jpeg', 0.82));
  const base = file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'bild';
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}
