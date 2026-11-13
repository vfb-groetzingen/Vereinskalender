const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export const DEFAULT_ADMIN_NAV = [
  { id: 'users', label: 'Benutzer und Einladungen', enabled: true, order: 1 },
  { id: 'resources', label: 'Räume und Plätze', enabled: true, order: 2 },
  { id: 'audit', label: 'Termin-Änderungsprotokoll', enabled: true, order: 3 },
  { id: 'config', label: 'Konfiguration', enabled: true, order: 4 }
];
export const DEFAULT_CONFIG_NAV = [
  { id: 'general', label: 'Allgemein', enabled: true, order: 1 },
  { id: 'mail', label: 'Mailprofile und Vorlagen', enabled: true, order: 2 },
  { id: 'texts', label: 'Besucherseiten', enabled: true, order: 3 },
  { id: 'legal', label: 'Impressum und Datenschutz', enabled: true, order: 4 },
  { id: 'documents', label: 'Dokumentenablage', enabled: true, order: 5 },
  { id: 'navigation', label: 'Navigation', enabled: true, order: 6 },
  { id: 'calendar', label: 'Kalender abonnieren', enabled: true, order: 7 }
];

export function normaliseMenu(items, defaults) {
  const saved = Array.isArray(items) ? items : [];
  return defaults.map((base) => {
    const item = saved.find((candidate) => candidate?.id === base.id) || {};
    return {
      ...base,
      label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : base.label,
      enabled: ['config', 'navigation'].includes(base.id) ? true : item.enabled !== false,
      order: Number.isInteger(Number(item.order)) && Number(item.order) > 0 ? Number(item.order) : base.order
    };
  }).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'de'));
}

const DEFAULT_TEMPLATES = {
  booking_confirmation: { subject: 'Buchungsbestätigung: {{title}}', body: 'Guten Tag,\n\nIhre Buchung wurde eingetragen.\n\nTermin: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}' },
  booking_changed: { subject: 'Änderung Ihrer Buchung: {{title}}', body: 'Guten Tag,\n\nIhre Buchung wurde geändert.\n\nTermin: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}' },
  booking_cancelled: { subject: 'Absage Ihrer Buchung: {{title}}', body: 'Guten Tag,\n\nIhre Buchung wurde abgesagt.\n\nTermin: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}' },
  booking_reminder: { subject: 'Erinnerung: {{title}}', body: 'Guten Tag,\n\nhiermit erinnern wir an Ihre bevorstehende Buchung.\n\nTermin: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}' }
};
const TEMPLATE_LABELS = {
  booking_confirmation: 'Buchungsbestätigung',
  booking_changed: 'Änderungsmitteilung',
  booking_cancelled: 'Absage',
  booking_reminder: 'Erinnerung vor dem Termin'
};
const SAMPLE_VALUES = { title: 'Sommerfest', date: '10.06.2027', time_range: '14:00–18:00 Uhr', resource_names: 'Hauptplatz', signature: 'Mit freundlichen Grüßen\nVfB Grötzingen' };

function textField(id, label, value, rows = 3) {
  return `<div class="field"><label for="${id}">${label}</label><textarea class="input" id="${id}" rows="${rows}">${esc(value)}</textarea></div>`;
}
function previewTemplate(text) {
  return String(text || '').replace(/\{\{([a-z_]+)\}\}/g, (match, key) => SAMPLE_VALUES[key] ?? match);
}
function signatureToPlain(source) {
  const parsed = new DOMParser().parseFromString(`<div>${source || ''}</div>`, 'text/html');
  const root = parsed.body.firstElementChild;
  root.querySelectorAll('script,style,iframe,object').forEach((node) => node.remove());
  root.querySelectorAll('br').forEach((node) => node.replaceWith(document.createTextNode('\n')));
  root.querySelectorAll('p,div,li,h1,h2,h3,blockquote').forEach((node) => node.append(document.createTextNode('\n\n')));
  return (root.textContent || '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function signatureToSafeHtml(source) {
  return String(source || '').trim().split(/\n{2,}/).filter(Boolean).map((paragraph) =>
    `<p>${paragraph.split('\n').map(esc).join('<br>')}</p>`
  ).join('');
}
function mailProfileRows(profiles) {
  const rows = (Array.isArray(profiles) && profiles.length ? profiles : [{ id: 'default', label: 'VfB Grötzingen', display_name: 'VfB Grötzingen', reply_to: 'vfb-app@vfb-groetzingen.de' }]);
  return rows.map((profile, index) => {
    const inputKey = `mail-profile-${crypto.randomUUID()}`;
    return `<div class="mail-profile-row" data-profile-row data-profile-id="${esc(profile.id || '')}">
      <div class="field"><label for="${inputKey}-label">Auswahlname</label><input id="${inputKey}-label" class="input" data-profile-label value="${esc(profile.label || '')}" maxlength="100"></div>
      <div class="field"><label for="${inputKey}-display">Anzeigename</label><input id="${inputKey}-display" class="input" data-profile-display value="${esc(profile.display_name || '')}" maxlength="100"></div>
      <div class="field"><label for="${inputKey}-reply">Antwortadresse</label><input id="${inputKey}-reply" class="input" data-profile-reply type="email" value="${esc(profile.reply_to || '')}" maxlength="254"></div>
      <p class="mail-profile-preview" data-profile-preview></p>
      <button type="button" class="btn btn-small btn-danger" data-remove-profile ${rows.length < 2 ? 'disabled' : ''} aria-label="Mailprofil ${index + 1} entfernen">Entfernen</button>
    </div>`;
  }).join('');
}
function navSettingsRows(items, defaults, group) {
  const normalized = normaliseMenu(items, defaults);
  return normalized.map((item) => `<div class="nav-setting-row" data-nav-item="${esc(item.id)}">
    <label><span>Menütext</span><input class="input" data-nav-label value="${esc(item.label)}" maxlength="80"></label>
    <label><span>Reihenfolge</span><input class="input" data-nav-order type="number" min="1" max="99" value="${item.order}"></label>
    <label class="check"><input type="checkbox" data-nav-enabled ${item.enabled ? 'checked' : ''} ${(['config', 'navigation'].includes(item.id)) ? 'disabled' : ''}> Anzeigen</label>
    <input type="hidden" data-nav-group value="${group}">
  </div>`).join('');
}

export async function mountConfiguration(target, { subpage, config, publicContent, documents, events, store, setNotice, refresh }) {
  const safeConfig = config || {};
  const templates = { ...DEFAULT_TEMPLATES, ...(safeConfig.mail_templates || {}) };
  const profiles = Array.isArray(safeConfig.mail_profiles) ? safeConfig.mail_profiles : [];
  const content = publicContent || {};
  const activeDocs = Array.isArray(documents) ? documents : [];
  const eventRows = Array.isArray(events) ? events : [];

  if (subpage === 'general') {
    target.innerHTML = `<section class="section admin-section"><h2>Konfiguration</h2><p>Hier verwaltest du die globalen Texte, Antwortadressen, E-Mail-Vorlagen, Dokumente und die Navigation.</p>
      <ul><li>Absender: das eingerichtete Strato-Postfach.</li><li>Antwortadresse: je Mailprofil auswählbar; Antworten gehen an die ausgewählte Adresse.</li><li>Nur Administratoren können globale Einstellungen ändern.</li></ul></section>`;
    return;
  }

  if (subpage === 'mail') {
    const sections = Object.entries(TEMPLATE_LABELS).map(([key, label]) => {
      const item = templates[key] || {};
      return `<details class="template-editor" open><summary>${label}</summary>
        <div class="field"><label for="tpl-${key}-subject">Betreff</label><input class="input" id="tpl-${key}-subject" data-template="${key}" data-template-part="subject" maxlength="200" value="${esc(item.subject || '')}"></div>
        ${textField(`tpl-${key}-body`, 'Nachrichtentext', item.body || '', 6).replace('<textarea', `<textarea data-template="${key}" data-template-part="body"`)}
        <div class="template-preview"><strong>Vorschau</strong><p>Betreff: <span data-preview-subject="${key}">${esc(previewTemplate(item.subject))}</span></p><pre data-preview="${key}">${esc(previewTemplate(item.body))}</pre></div>
      </details>`;
    }).join('');
    target.innerHTML = `<section class="section admin-section"><h2>Mailprofile und Vorlagen</h2>
      <p class="hint">Der technische Absender bleibt das authentifizierte Strato-Postfach. Das ausgewählte Profil legt Anzeigename und Antwortadresse fest.</p>
      <form id="mail-config-form" class="form"><div class="config-list-head"><h3>Antwortprofile</h3><button class="btn btn-small" id="mail-profile-add" type="button">Profil hinzufügen</button></div>
        <div id="mail-profile-list">${mailProfileRows(profiles)}</div>
        <p class="hint">Das erste Profil ist der Standard für neue Ereignisse und Buchungsmails. Antwortadressen müssen erreichbar sein. Der technische Absender bleibt immer vfb-app@vfb-groetzingen.de.</p>
        <h3>Buchungs-E-Mail-Vorlagen</h3><p class="hint">Platzhalter: {{title}}, {{date}}, {{time_range}}, {{resource_names}}, {{signature}}.</p>
        ${sections}
        ${textField('event-signature', 'Standardsignatur für neue Ereignisse', signatureToPlain(safeConfig.event_signature_html || 'Mit freundlichen Grüßen\nVfB Grötzingen\n\nInternet: http://www.vfb-groetzingen.de/'), 4)}
        <p class="hint">Die Signatur wird als Klartext bearbeitet und beim Speichern sicher in HTML umgewandelt.</p>
        <button class="btn btn-primary" type="submit">Mailprofile und Vorlagen speichern</button><p class="msg" id="mail-config-msg" role="alert"></p>
      </form></section>`;
    const profileList = target.querySelector('#mail-profile-list');
    target.querySelector('#mail-profile-add').onclick = () => {
      profileList.insertAdjacentHTML('beforeend', mailProfileRows([{ id: crypto.randomUUID(), label: '', display_name: '', reply_to: '' }]).replace(' disabled', ''));
      const row = profileList.querySelector('[data-profile-row]:last-child');
      row.querySelectorAll('input').forEach((input) => input.addEventListener('input', () => updateProfilePreview(row)));
      updateProfilePreview(row);
      profileList.querySelector('[data-profile-row]:last-child [data-profile-label]').focus();
    };
    profileList.onclick = (event) => {
      const button = event.target.closest('[data-remove-profile]');
      if (!button || button.disabled) return;
      button.closest('[data-profile-row]').remove();
      const rows = [...profileList.querySelectorAll('[data-profile-row]')];
      rows.forEach((row) => { const remove = row.querySelector('[data-remove-profile]'); remove.disabled = rows.length < 2; });
    };
    const updateTemplatePreview = (key) => {
      const subject = target.querySelector(`[data-template="${key}"][data-template-part="subject"]`)?.value || '';
      const body = target.querySelector(`[data-template="${key}"][data-template-part="body"]`)?.value || '';
      const subjectPreview = target.querySelector(`[data-preview-subject="${key}"]`);
      const bodyPreview = target.querySelector(`[data-preview="${key}"]`);
      if (subjectPreview) subjectPreview.textContent = previewTemplate(subject);
      if (bodyPreview) bodyPreview.textContent = previewTemplate(body);
    };
    target.querySelectorAll('[data-template]').forEach((field) => field.addEventListener('input', () => updateTemplatePreview(field.dataset.template)));
    const updateProfilePreview = (row) => {
      const display = row.querySelector('[data-profile-display]')?.value.trim() || 'VfB Grötzingen';
      const reply = row.querySelector('[data-profile-reply]')?.value.trim() || 'Antwortadresse';
      const preview = row.querySelector('[data-profile-preview]');
      if (preview) preview.textContent = `Absender: ${display} <vfb-app@vfb-groetzingen.de> · Antworten an: ${reply}`;
    };
    profileList.querySelectorAll('[data-profile-row]').forEach((row) => {
      updateProfilePreview(row);
      row.querySelectorAll('input').forEach((input) => input.addEventListener('input', () => updateProfilePreview(row)));
    });
    target.querySelector('#mail-config-form').onsubmit = async (event) => {
      event.preventDefault();
      const msg = target.querySelector('#mail-config-msg');
      const values = [...profileList.querySelectorAll('[data-profile-row]')].map((row) => ({
        id: row.dataset.profileId || crypto.randomUUID(),
        label: row.querySelector('[data-profile-label]').value.trim(),
        display_name: row.querySelector('[data-profile-display]').value.trim(),
        reply_to: row.querySelector('[data-profile-reply]').value.trim()
      }));
      if (!values.length || values.some((item) => !item.label || !item.display_name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.reply_to))) {
        msg.textContent = 'Bitte mindestens ein vollständiges Mailprofil mit gültiger Antwortadresse eintragen.'; return;
      }
      const updatedTemplates = {};
      for (const key of Object.keys(TEMPLATE_LABELS)) {
        updatedTemplates[key] = {
          subject: target.querySelector(`[data-template="${key}"][data-template-part="subject"]`).value.trim(),
          body: target.querySelector(`[data-template="${key}"][data-template-part="body"]`).value.trim()
        };
      }
      try {
        await store.saveSiteConfiguration({ mail_profiles: values, mail_templates: updatedTemplates, event_signature_html: signatureToSafeHtml(target.querySelector('#event-signature').value) });
        setNotice('ok', 'Mailprofile und Vorlagen wurden gespeichert.');
        await refresh();
      } catch (error) { msg.textContent = error.message || 'Einstellungen konnten nicht gespeichert werden.'; }
    };
    return;
  }

  if (subpage === 'texts' || subpage === 'calendar') {
    const fields = subpage === 'texts' ? `
      ${textField('home-title', 'Startseite: Überschrift', content.home_title || 'Räume und Plätze auf einen Blick', 2)}
      ${textField('home-intro', 'Startseite: Einführung', content.home_intro || '', 3)}
      ${textField('rooms-title', 'Übersicht: Überschrift „Räume und Plätze“', content.rooms_title || 'Raumkalender', 2)}
      ${textField('rooms-intro', 'Übersicht: Beschreibung', content.rooms_intro || '', 3)}
      ${textField('plan-title', 'Belegungsplan: Überschrift', content.plan_title || 'Belegungsplan', 2)}
      ${textField('plan-intro', 'Belegungsplan: Beschreibung', content.plan_intro || '', 3)}` : `
      ${textField('calendar-help', 'Anleitung zum Kalender-Abo', content.calendar_help || '', 6)}
      <p class="hint">Die schreibgeschützten iCalendar-Links werden auf der öffentlichen Seite „Kalender abonnieren“ erzeugt.</p>`;
    target.innerHTML = `<section class="section admin-section"><h2>${subpage === 'texts' ? 'Besucherseiten' : 'Kalender abonnieren'}</h2>
      <form id="public-content-form" class="form">${fields}<button class="btn btn-primary" type="submit">Texte speichern</button><p class="msg" id="public-content-msg" role="alert"></p></form></section>`;
    target.querySelector('#public-content-form').onsubmit = async (event) => {
      event.preventDefault();
      const get = (id) => target.querySelector(`#${id}`)?.value || '';
      const patch = subpage === 'texts' ? {
        home_title: get('home-title'), home_intro: get('home-intro'), rooms_title: get('rooms-title'), rooms_intro: get('rooms-intro'), plan_title: get('plan-title'), plan_intro: get('plan-intro')
      } : { calendar_help: get('calendar-help') };
      try {
        await store.savePublicSiteContent(patch);
        setNotice('ok', 'Besuchertexte wurden gespeichert.');
        await refresh();
      } catch (error) { target.querySelector('#public-content-msg').textContent = error.message || 'Texte konnten nicht gespeichert werden.'; }
    };
    return;
  }

  if (subpage === 'legal') {
    target.innerHTML = `<section class="section admin-section"><h2>Impressum und Datenschutz</h2><p class="notice notice-warn">Die Rechtstexte bitte vor Veröffentlichung fachlich prüfen. Inhalte werden als Klartext angezeigt und nicht als HTML ausgeführt.</p>
      <form id="legal-form" class="form">${textField('impressum-text', 'Impressum', content.impressum_text || '', 12)}${textField('datenschutz-text', 'Datenschutzerklärung', content.datenschutz_text || '', 14)}<button class="btn btn-primary" type="submit">Rechtstexte speichern</button><p class="msg" id="legal-msg" role="alert"></p></form></section>`;
    target.querySelector('#legal-form').onsubmit = async (event) => {
      event.preventDefault();
      try {
        await store.savePublicSiteContent({ impressum_text: target.querySelector('#impressum-text').value, datenschutz_text: target.querySelector('#datenschutz-text').value });
        setNotice('ok', 'Impressum und Datenschutzerklärung wurden gespeichert.');
        await refresh();
      } catch (error) { target.querySelector('#legal-msg').textContent = error.message || 'Rechtstexte konnten nicht gespeichert werden.'; }
    };
    return;
  }

  if (subpage === 'documents') {
    const docRows = activeDocs.map((doc) => {
      const usedBy = eventRows.filter((event) => (event.document_ids || []).includes(doc.id));
      return `<tr><td>${esc(doc.title)}</td><td>${esc(doc.file_name)}</td><td>${(Number(doc.file_size) / 1024).toFixed(0)} KB</td><td>${doc.active ? 'Aktiv' : 'Archiviert'}${usedBy.length ? ` · in ${usedBy.length} Ereignis(en)` : ''}</td><td>${doc.active ? `<button class="btn btn-small" type="button" data-doc-archive="${esc(doc.id)}">Archivieren</button>` : ''}${usedBy.length ? '' : `<button class="btn btn-small btn-danger" type="button" data-doc-delete="${esc(doc.id)}" data-doc-path="${esc(doc.storage_path)}">Endgültig löschen</button>`}</td></tr>`;
    }).join('');
    target.innerHTML = `<section class="section admin-section"><h2>Dokumentenablage</h2><p>Bilder und PDFs können bei Ereignissen ausgewählt und als E-Mail-Anhang versendet werden. Bilder werden auf höchstens 1600 Pixel verkleinert und als WebP komprimiert. Das Gesamtlimit pro E-Mail bleibt 5 MB. Wird ein Ereignis gelöscht, wird nur seine Auswahl entfernt; das Original in der Ablage bleibt erhalten.</p>
      <form id="document-upload-form" class="form"><div class="field"><label for="doc-title">Anzeigename</label><input id="doc-title" class="input" maxlength="160" required></div><div class="field"><label for="doc-file">Bild oder PDF</label><input id="doc-file" class="input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></div><button class="btn btn-primary" type="submit">Dokument hochladen</button><p class="hint">Einzeldatei höchstens 5 MB. Unterstützt: JPEG, PNG, WebP und PDF.</p><p class="msg" id="doc-msg" role="alert"></p></form>
      <div class="table-wrap"><table class="table"><thead><tr><th>Titel</th><th>Datei</th><th>Größe</th><th>Status</th><th>Aktionen</th></tr></thead><tbody>${docRows || '<tr><td colspan="5">Noch keine Dokumente abgelegt.</td></tr>'}</tbody></table></div></section>`;
    target.querySelector('#document-upload-form').onsubmit = async (event) => {
      event.preventDefault();
      const input = target.querySelector('#doc-file');
      const file = input.files?.[0];
      const msg = target.querySelector('#doc-msg');
      if (!file) return;
      const button = target.querySelector('button[type="submit"]'); button.disabled = true;
      try {
        const prepared = await prepareDocument(file);
        if (prepared.size > 5 * 1024 * 1024) throw new Error('Die Datei überschreitet nach der Bildkomprimierung 5 MB.');
        await store.uploadEventDocument(prepared, target.querySelector('#doc-title').value.trim());
        setNotice('ok', 'Dokument wurde in der Ablage gespeichert.');
        await refresh();
      } catch (error) { msg.textContent = error.message || 'Dokument konnte nicht hochgeladen werden.'; button.disabled = false; }
    };
    target.querySelectorAll('[data-doc-archive]').forEach((button) => button.onclick = async () => {
      try { await store.archiveEventDocument(button.dataset.docArchive); setNotice('ok', 'Dokument wurde archiviert. Bestehende Ereignisse können es weiterhin versenden.'); await refresh(); }
      catch (error) { setNotice('error', error.message || 'Dokument konnte nicht archiviert werden.'); }
    });
    target.querySelectorAll('[data-doc-delete]').forEach((button) => button.onclick = async () => {
      if (!confirm('Dieses Original dauerhaft aus der Ablage löschen?')) return;
      const doc = activeDocs.find((item) => item.id === button.dataset.docDelete);
      try { await store.removeEventDocument(doc.id, doc.storage_path); setNotice('ok', 'Originaldatei wurde gelöscht.'); await refresh(); }
      catch (error) { setNotice('error', error.message || 'Dokument konnte nicht gelöscht werden.'); }
    });
    return;
  }

  if (subpage === 'navigation') {
    target.innerHTML = `<section class="section admin-section"><h2>Navigation konfigurieren</h2><p>Menütexte, Reihenfolge und Sichtbarkeit sind änderbar. „Konfiguration“ bleibt immer erreichbar, damit du die Navigation bei Bedarf zurücksetzen kannst.</p>
      <form id="navigation-form" class="form"><h3>Administrations-Unterseiten</h3><div class="nav-setting-list">${navSettingsRows(safeConfig.admin_navigation, DEFAULT_ADMIN_NAV, 'admin')}</div><h3>Konfigurations-Unterseiten</h3><div class="nav-setting-list">${navSettingsRows(safeConfig.configuration_navigation, DEFAULT_CONFIG_NAV, 'config')}</div><button class="btn btn-primary" type="submit">Navigation speichern</button><p class="msg" id="nav-msg" role="alert"></p></form></section>`;
    target.querySelector('#navigation-form').onsubmit = async (event) => {
      event.preventDefault();
      const parse = (group, defaults) => defaults.map((item) => {
        const row = [...target.querySelectorAll('.nav-setting-row')].find((candidate) => candidate.dataset.navItem === item.id && candidate.querySelector('[data-nav-group]')?.value === group);
        return { id: item.id, label: row?.querySelector('[data-nav-label]').value.trim() || item.label, order: Number(row?.querySelector('[data-nav-order]').value) || item.order, enabled: ['config', 'navigation'].includes(item.id) ? true : !!row?.querySelector('[data-nav-enabled]')?.checked };
      });
      const patch = { admin_navigation: parse('admin', DEFAULT_ADMIN_NAV), configuration_navigation: parse('config', DEFAULT_CONFIG_NAV) };
      try { await store.saveSiteConfiguration(patch); setNotice('ok', 'Navigation wurde gespeichert.'); await refresh(); }
      catch (error) { target.querySelector('#nav-msg').textContent = error.message || 'Navigation konnte nicht gespeichert werden.'; }
    };
    return;
  }

  target.innerHTML = '<section class="section"><p class="notice notice-warn">Diese Konfigurationsseite ist nicht verfügbar.</p></section>';
}

async function prepareDocument(file) {
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) throw new Error('Bitte ein JPEG-, PNG-, WebP- oder PDF-Dokument auswählen.');
  if (file.type === 'application/pdf') {
    if (file.size > 5 * 1024 * 1024) throw new Error('PDF-Dateien dürfen höchstens 5 MB groß sein.');
    return file;
  }
  if (typeof createImageBitmap !== 'function') return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Bild konnte nicht komprimiert werden.')), 'image/webp', 0.82));
  const base = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'bild';
  return new File([blob], `${base}.webp`, { type: 'image/webp' });
}
