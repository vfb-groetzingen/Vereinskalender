import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseMenu } from '../assets/js/admin-config.js';

test('Navigationspflege bleibt unabhängig von gespeicherten Sichtbarkeitseinstellungen erreichbar', () => {
  const defaults = [
    { id: 'config', label: 'Konfiguration', enabled: true, order: 1 },
    { id: 'navigation', label: 'Navigation', enabled: true, order: 2 },
    { id: 'mail', label: 'Mail', enabled: true, order: 3 },
  ];
  const menu = normaliseMenu([
    { id: 'config', label: 'Einstellungen', enabled: false, order: 3 },
    { id: 'navigation', label: 'Menüpflege', enabled: false, order: 2 },
    { id: 'mail', label: 'Mailtexte', enabled: false, order: 1 },
  ], defaults);
  assert.deepEqual(menu.map(({ id, enabled }) => [id, enabled]), [
    ['mail', false], ['navigation', true], ['config', true],
  ]);
  assert.equal(menu.find((item) => item.id === 'navigation').label, 'Menüpflege');
});
