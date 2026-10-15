/**
 * Formats a price from the platform's smallest unit to a decimal string.
 * The default decimals are 7 (Stellar's standard), but this can be overridden
 * by passing a decimals parameter (typically from event or ticket type config).
 *
 * @param priceSmallestUnit - Price in smallest units (typically from chainTicketId or price field)
 * @param decimals - Number of decimal places (default: 7 for Stellar)
 * @returns Formatted price string with decimals
 */
export function formatPrice(
  priceSmallestUnit: bigint,
  decimals: number = 7,
): string {
  if (decimals < 0) {
    throw new Error('Decimals cannot be negative');
  }

  const divisor = 10n ** BigInt(decimals);
  const integerPart = priceSmallestUnit / divisor;
  const fractionalPart = priceSmallestUnit % divisor;

  if (decimals === 0) {
    return integerPart.toString();
  }

  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  return `${integerPart}.${fractionalStr}`;
}
