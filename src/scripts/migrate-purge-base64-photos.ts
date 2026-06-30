/**
 * migrate-purge-base64-photos.ts
 *
 * Xóa toàn bộ gallery_photos documents có url dạng base64 (data:image/...).
 * Những ảnh này không thể dùng CDN và gây timeout cho API /photos.
 *
 * Chạy: npm run migrate:purge-base64
 *
 * Chiến lược hiệu quả:
 *   - Dùng $regex trên index để đếm/xóa mà KHÔNG load url về
 *   - Chỉ project _id để liệt kê (không kéo base64 string khổng lồ)
 */

import "dotenv/config";
import dns from "node:dns";
import readline from "node:readline";
import { MongoClient } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || "";
const MONGODB_DB  = process.env.MONGODB_DB  || process.env.MONGO_DB  || "92kamera";
const GALLERY_COL = process.env.MONGODB_GALLERY_COLLECTION || "gallery_photos";
const DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI không tồn tại trong .env");
  process.exit(1);
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve =>
    rl.question(question, answer => {
      rl.close();
      resolve(["y", "yes"].includes(answer.trim().toLowerCase()));
    })
  );
}

async function main() {
  console.log("\n🔍 Migration: Purge base64 gallery photos");
  console.log("─".repeat(55));

  if (MONGODB_URI.startsWith("mongodb+srv://") && DNS_SERVERS.length > 0) {
    dns.setServers(DNS_SERVERS);
    console.log(`📡 DNS: ${DNS_SERVERS.join(", ")}`);
  }

  const safeUri = MONGODB_URI.replace(/:\/\/[^@]+@/, "://***@");
  console.log(`🔌 Connecting: ${safeUri}`);

  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    console.log(`✅ Connected → ${MONGODB_DB} / ${GALLERY_COL}\n`);

    const col = client.db(MONGODB_DB).collection(GALLERY_COL);
    const BASE64_FILTER = { url: { $regex: /^data:/ } };

    // ── 1. Đếm — không load url string, chỉ count ─────────────────────────
    const [totalCount, base64Count] = await Promise.all([
      col.countDocuments(),
      col.countDocuments(BASE64_FILTER),
    ]);

    if (base64Count === 0) {
      console.log("✨ Không tìm thấy base64 nào. DB đã sạch!");
      return;
    }

    console.log(`📊 Thống kê:`);
    console.log(`   Tổng photos         : ${totalCount}`);
    console.log(`   Base64 (sẽ xóa)     : ${base64Count}`);
    console.log(`   Cloudinary (giữ lại): ${totalCount - base64Count}\n`);

    // ── 2. Liệt kê public_id — chỉ project _id, KHÔNG project url ─────────
    console.log("📋 IDs sẽ bị xóa:");
    const ids = await col
      .find(BASE64_FILTER, { projection: { _id: 1, public_id: 1 } })
      .limit(100)
      .toArray();

    ids.forEach((doc, i) => {
      console.log(`   [${String(i + 1).padStart(2)}] ${doc.public_id ?? doc._id}`);
    });

    if (base64Count > 100) {
      console.log(`   ... và ${base64Count - 100} records khác`);
    }

    console.log();

    // ── 3. Xác nhận ───────────────────────────────────────────────────────
    const ok = await confirm(`⚠️  Xóa ${base64Count} base64 document? (y/N): `);
    if (!ok) {
      console.log("\n🚫 Đã hủy. Không có gì bị xóa.");
      return;
    }

    // ── 4. Xóa trực tiếp — MongoDB không cần load url ─────────────────────
    console.log("\n🗑  Đang xóa...");
    const result = await col.deleteMany(BASE64_FILTER);
    console.log(`✅ Xóa thành công: ${result.deletedCount} documents`);

    // ── 5. Verify ─────────────────────────────────────────────────────────
    const [afterTotal, afterBase64] = await Promise.all([
      col.countDocuments(),
      col.countDocuments(BASE64_FILTER),
    ]);

    console.log(`\n📊 Sau migration:`);
    console.log(`   Còn lại     : ${afterTotal} photos`);
    console.log(`   Base64 còn  : ${afterBase64}`);
    console.log(afterBase64 === 0
      ? "\n🎉 Migration thành công! API /photos sẽ nhanh ngay bây giờ.\n"
      : "\n⚠️  Vẫn còn base64. Chạy lại script.\n"
    );

  } finally {
    await client.close();
    console.log("🔌 Đã đóng kết nối MongoDB.");
  }
}

main().catch(err => {
  console.error("❌ Lỗi:", err.message ?? err);
  process.exit(1);
});
