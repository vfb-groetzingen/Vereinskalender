export function normalizeCalendarColor(value, fallback = null) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
}

export function calendarColorsForResources(resourceIds, resources) {
  const ids = [...new Set(Array.isArray(resourceIds) ? resourceIds : [])];
  return ids.map((id) => normalizeCalendarColor(resources.find((resource) => resource.id === id)?.color))
    .filter(Boolean);
}

function tintHex(color, strength = 0.2) {
  const hex = normalizeCalendarColor(color, '#4a5568').slice(1);
  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  return `#${channels.map((channel) => Math.round(channel * strength + 255 * (1 - strength)).toString(16).padStart(2, '0')).join('')}`;
}

export function calendarColorStyles(colors) {
  const palette = [...new Set((Array.isArray(colors) ? colors : [])
    .map((color) => normalizeCalendarColor(color)).filter(Boolean))];
  if (!palette.length) return { border: '#4a5568', background: '#f1f4f8' };
  if (palette.length === 1) return { border: palette[0], background: tintHex(palette[0]) };
  const stops = palette.map((color, index) => {
    const from = (index / palette.length) * 100;
    const to = ((index + 1) / palette.length) * 100;
    const tint = tintHex(color);
    return `${tint} ${from}% ${to}%`;
  });
  return { border: palette[0], background: `linear-gradient(90deg, ${stops.join(', ')})` };
}
