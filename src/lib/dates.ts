/** Dates in the booking flow are shown as dd/mm/yyyy in every language (from YYYY-MM-DD). */
export const formatDMY = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};
