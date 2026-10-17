export const money = (cents: number, forceDecimals = false) => {
  const d = cents / 100;
  if (!forceDecimals && cents % 100 === 0) return `$${d.toLocaleString('en-US')}`;
  return `$${d.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
