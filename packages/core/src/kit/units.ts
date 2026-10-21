import type { Units } from '../api/types';
import { SceneApiError } from '../scene/errors';

/**
 * Units for display and conversion (FM-8). Each unit is a factor to its
 * quantity's base unit; temperatures add an offset.
 */

interface Unit {
  readonly quantity: string;
  readonly factor: number;
  readonly offset?: number;
}

const UNITS: Readonly<Record<string, Unit>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, Unit>, {
    m: { quantity: 'length', factor: 1 },
    km: { quantity: 'length', factor: 1000 },
    cm: { quantity: 'length', factor: 0.01 },
    mm: { quantity: 'length', factor: 0.001 },
    um: { quantity: 'length', factor: 1e-6 },
    µm: { quantity: 'length', factor: 1e-6 },
    nm: { quantity: 'length', factor: 1e-9 },
    in: { quantity: 'length', factor: 0.0254 },
    ft: { quantity: 'length', factor: 0.3048 },
    mi: { quantity: 'length', factor: 1609.344 },
    s: { quantity: 'time', factor: 1 },
    ms: { quantity: 'time', factor: 0.001 },
    min: { quantity: 'time', factor: 60 },
    h: { quantity: 'time', factor: 3600 },
    rad: { quantity: 'angle', factor: 1 },
    deg: { quantity: 'angle', factor: Math.PI / 180 },
    degrees: { quantity: 'angle', factor: Math.PI / 180 },
    '°': { quantity: 'angle', factor: Math.PI / 180 },
    kg: { quantity: 'mass', factor: 1 },
    g: { quantity: 'mass', factor: 0.001 },
    mg: { quantity: 'mass', factor: 1e-6 },
    t: { quantity: 'mass', factor: 1000 },
    N: { quantity: 'force', factor: 1 },
    kN: { quantity: 'force', factor: 1000 },
    J: { quantity: 'energy', factor: 1 },
    kJ: { quantity: 'energy', factor: 1000 },
    eV: { quantity: 'energy', factor: 1.602176634e-19 },
    cal: { quantity: 'energy', factor: 4.184 },
    kcal: { quantity: 'energy', factor: 4184 },
    W: { quantity: 'power', factor: 1 },
    kW: { quantity: 'power', factor: 1000 },
    Pa: { quantity: 'pressure', factor: 1 },
    kPa: { quantity: 'pressure', factor: 1000 },
    bar: { quantity: 'pressure', factor: 1e5 },
    atm: { quantity: 'pressure', factor: 101_325 },
    mmHg: { quantity: 'pressure', factor: 133.322 },
    'm/s': { quantity: 'speed', factor: 1 },
    'km/h': { quantity: 'speed', factor: 1 / 3.6 },
    mph: { quantity: 'speed', factor: 0.44704 },
    K: { quantity: 'temperature', factor: 1 },
    C: { quantity: 'temperature', factor: 1, offset: 273.15 },
    '°C': { quantity: 'temperature', factor: 1, offset: 273.15 },
    F: { quantity: 'temperature', factor: 5 / 9, offset: 255.372_222_222_222_2 },
    '°F': { quantity: 'temperature', factor: 5 / 9, offset: 255.372_222_222_222_2 },
    L: { quantity: 'volume', factor: 0.001 },
    mL: { quantity: 'volume', factor: 1e-6 },
    m3: { quantity: 'volume', factor: 1 },
    'm³': { quantity: 'volume', factor: 1 },
    cm3: { quantity: 'volume', factor: 1e-6 },
    'cm³': { quantity: 'volume', factor: 1e-6 },
    Hz: { quantity: 'frequency', factor: 1 },
    kHz: { quantity: 'frequency', factor: 1000 },
    A: { quantity: 'current', factor: 1 },
    mA: { quantity: 'current', factor: 0.001 },
    V: { quantity: 'voltage', factor: 1 },
    mV: { quantity: 'voltage', factor: 0.001 },
    kV: { quantity: 'voltage', factor: 1000 },
    'Ω': { quantity: 'resistance', factor: 1 },
    ohm: { quantity: 'resistance', factor: 1 },
    'kΩ': { quantity: 'resistance', factor: 1000 },
    mol: { quantity: 'amount', factor: 1 },
    mmol: { quantity: 'amount', factor: 0.001 },
    'mol/L': { quantity: 'concentration', factor: 1 },
    M: { quantity: 'concentration', factor: 1 },
    mM: { quantity: 'concentration', factor: 0.001 },
  }),
);

export function convert(value: number, from: string, to: string): number {
  const a = UNITS[from];
  const b = UNITS[to];
  if (!a || !b) throw new SceneApiError(`units.convert does not know "${!a ? from : to}"`);
  if (a.quantity !== b.quantity) throw new SceneApiError(`Cannot convert ${a.quantity} (${from}) to ${b.quantity} (${to})`);
  const base = (value + (a.offset !== undefined ? a.offset / a.factor : 0)) * a.factor;
  return base / b.factor - (b.offset !== undefined ? b.offset / b.factor : 0);
}

/** A value with its unit, rounded for reading: "12.5 m/s", "30°", "45%". */
export function format(value: number, unit = '', digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const d = Math.min(8, Math.max(0, Math.floor(digits)));
  const k = 10 ** d;
  const rounded = Math.round(value * k) / k;
  const text = (Object.is(rounded, -0) ? 0 : rounded).toFixed(d);
  if (unit === '') return text;
  return unit === '°' || unit === '%' ? `${text}${unit}` : `${text} ${unit}`;
}

export const units: Units = Object.freeze({ format, convert });
