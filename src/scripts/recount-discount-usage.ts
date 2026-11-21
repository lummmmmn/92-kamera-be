import "dotenv/config";
import { STORE_KEYS } from "../config/storeKeys.js";
import { getRepository } from "../repositories/index.js";
import { orderDiscountCodes } from "../services/booking.service.js";
import { arrayOrEmpty, casJsonValue, getJsonValueWithMeta } from "../services/storage.service.js";
import type { BookingOrder, Discount } from "../types/domain.js";

// Đếm lại usedCount của từng mã = số đơn KHÔNG bị huỷ đang dùng mã đó.
// Dùng 1 lần để sửa số liệu cũ (trước đây usedCount không bao giờ tăng từ flow đặt đơn).
//   npx tsx src/scripts/recount-discount-usage.ts           → chỉ in ra (dry-run, không ghi gì)
//   npx tsx src/scripts/recount-discount-usage.ts --apply   → ghi vào DB
const apply = process.argv.includes("--apply");

async function main() {
  const repo = await getRepository();
  const orders = arrayOrEmpty<BookingOrder>((await getJsonValueWithMeta<BookingOrder[]>(repo, STORE_KEYS.orders)).value);
  const meta = await getJsonValueWithMeta<Discount[]>(repo, STORE_KEYS.discounts);
  const discounts = arrayOrEmpty<Discount>(meta.value);

  const counts = new Map<string, number>();
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    for (const code of orderDiscountCodes(order)) counts.set(code, (counts.get(code) || 0) + 1);
  }

  let changed = 0;
  const next = discounts.map((discount) => {
    const real = counts.get(String(discount.code).toUpperCase()) || 0;
    const old = discount.usedCount || 0;
    if (real !== old) changed += 1;
    console.log(`${String(discount.code).padEnd(20)} usedCount: ${String(old).padStart(4)} → ${String(real).padStart(4)}${real !== old ? "  (đổi)" : ""}`);
    return real === old ? discount : { ...discount, usedCount: real };
  });

  if (!apply) {
    console.log(`\nDry-run: ${changed} mã sẽ đổi. Chạy lại với --apply để ghi.`);
    return;
  }
  if (changed === 0) {
    console.log("\nKhông có gì cần sửa.");
    return;
  }
  const result = await casJsonValue(repo, STORE_KEYS.discounts, next, meta.updatedAt);
  console.log(result.ok ? `\nĐã ghi ${changed} mã.` : "\nDữ liệu vừa bị đổi bởi request khác — chạy lại.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
