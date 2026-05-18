import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function generateRollId(lastNo: number, prefix: string, year: string): string {
  return `${prefix}-${lastNo + 1}-${year}`;
}
