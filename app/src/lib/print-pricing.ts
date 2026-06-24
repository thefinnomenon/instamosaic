export type PrintSize = "12x18" | "20x30" | "24x36";

type PrintPrice = {
  size: PrintSize;
  label: string;
  printCents: number;
  framedCents: number;
};

export const PRINT_PRICES: PrintPrice[] = [
  { size: "12x18", label: "12x18", printCents: 2900, framedCents: 7900 },
  { size: "20x30", label: "20x30", printCents: 3900, framedCents: 11900 },
  { size: "24x36", label: "24x36", printCents: 4900, framedCents: 14900 }
];

const DEFAULT_PRINT_PRICE: PrintPrice = { size: "20x30", label: "20x30", printCents: 3900, framedCents: 11900 };

export function printPriceCents(size: string, framed: boolean): number {
  const price = PRINT_PRICES.find((item) => item.size === size) ?? DEFAULT_PRINT_PRICE;
  return framed ? price.framedCents : price.printCents;
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function printShippingEstimate(): string {
  return "Most orders arrive in 5-14 business days.";
}
