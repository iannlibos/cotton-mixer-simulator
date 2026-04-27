export const KG_PER_TON = 1000;

export function tonsToKg(tons: number): number {
  return tons * KG_PER_TON;
}

export function kgToTons(kg: number): number {
  return kg / KG_PER_TON;
}

export function fmtKgFromTons(tons: number, maximumFractionDigits = 0): string {
  return tonsToKg(tons).toLocaleString("pt-BR", { maximumFractionDigits });
}
