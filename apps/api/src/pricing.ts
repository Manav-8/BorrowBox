import { HttpError } from './http.js';

const DAY_MS = 86_400_000;
export function calculateBookingPrice(startDate: Date, endDate: Date, dailyPricePaise: number, depositPaise: number) {
  const start = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const end = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  const rentalDays = Math.ceil((end - start) / DAY_MS);
  if (rentalDays < 1 || !Number.isSafeInteger(rentalDays)) throw new HttpError(400, 'Rental dates are invalid.');
  if (!Number.isSafeInteger(dailyPricePaise) || dailyPricePaise < 1 || !Number.isSafeInteger(depositPaise) || depositPaise < 0) throw new HttpError(400, 'Offer prices are invalid.');
  const rentalTotalPaise = dailyPricePaise * rentalDays;
  const serviceFeePaise = Math.ceil(rentalTotalPaise * 0.08);
  const totalPaise = rentalTotalPaise + serviceFeePaise + depositPaise;
  if (![rentalTotalPaise, serviceFeePaise, totalPaise].every(Number.isSafeInteger)) throw new HttpError(400, 'Offer totals exceed supported limits.');
  return { rentalDays, rentalTotalPaise, serviceFeePaise, totalPaise };
}
