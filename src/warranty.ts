// Warranty: while a device is under warranty, opening it yourself can void the warranty.
import type { Item } from "./db";

export function underWarranty(item: Pick<Item, "warrantyUntil"> | undefined, now = new Date()): boolean {
  if (!item?.warrantyUntil) return false;
  return item.warrantyUntil >= now.toISOString().slice(0, 10);
}

export const formatDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString();
