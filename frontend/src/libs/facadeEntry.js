import { defaultMeasurement } from './curtainCalculation.js';

export function nextFacadeName(cart, roomName) {
  const names = new Set(cart.filter(line => String(line.room_name || '').trim() === String(roomName || '').trim()).map(line => String(line.area || '').trim()).filter(Boolean));
  const highest = [...names].reduce((maximum, name) => Math.max(maximum, Number(/^Cam (\d+)(?:\s*\/|$)/i.exec(name)?.[1]) || 0), 0);
  let number = Math.max(highest, names.size) + 1;
  while (names.has(`Cam ${number}`)) number++;
  return `Cam ${number}`;
}

export function labelFacadeLines(lines, cart, roomName) {
  const label = nextFacadeName(cart, roomName);
  return lines.map(line => line.area ? line : { ...line, area: label });
}

export function nextFacadeMeasurement(product, current, cart) {
  const next = defaultMeasurement(product);
  const shared = ['room_name', 'variant', 'pleat_id', 'labor_price', 'order_mode', 'currency_rate', 'currency_rate_mode', 'currency_rate_source', 'currency_rate_type', 'currency_rate_date', 'currency_rate_fetched_at'];
  for (const key of shared) if (current[key] !== undefined) next[key] = current[key];
  // Each new physical window must receive its own dimensions and hardware choices.
  return { ...next, area: nextFacadeName(cart, next.room_name), width: '', height: '', right_width: '', right_height: '' };
}

export function changeFacadeRoom(current, roomName, cart) {
  const autoLabel = /^Cam \d+$/.test(String(current.area || ''));
  return { ...current, room_name: roomName, ...(autoLabel ? { area: nextFacadeName(cart, roomName) } : {}) };
}
