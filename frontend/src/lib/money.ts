/** Money crosses the wire as integer paise. Format only at the edge. */
export function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}₹${whole.toLocaleString('en-IN')}.${frac}`;
}

export function toPaise(input: string): number {
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value) || value < 0) return 0;
  return Math.round(value * 100);
}

export function fromPaise(paise: number): string {
  return (paise / 100).toFixed(2);
}
