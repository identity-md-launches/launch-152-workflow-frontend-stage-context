import { formatUnits } from 'viem';

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });
const bigFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/** Format a raw token amount using the token's decimals, with locale grouping. */
export function formatAmount(raw: bigint, decimals: number, maxFraction = 6): string {
  const text = formatUnits(raw, decimals);
  const [whole, fraction = ''] = text.split('.');
  const wholeFormatted = bigFormat.format(BigInt(whole));
  const frac = fraction.slice(0, maxFraction).replace(/0+$/, '');
  return frac ? `${wholeFormatted}.${frac}` : wholeFormatted;
}

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatCount(value: bigint): string {
  return bigFormat.format(value);
}

export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }).format(date);
}

export function explorerAddress(explorer: string, address: string): string {
  return `${explorer.replace(/\/$/, '')}/address/${address}`;
}

export function explorerTx(explorer: string, hash: string): string {
  return `${explorer.replace(/\/$/, '')}/tx/${hash}`;
}
