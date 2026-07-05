export const STORE_KEYS = {
  cameras: "k92_cameras_v2",
  accessories: "k92_accessories_v2",
  orders: "k92_orders_v2",
  site: "k92_site_v2",
  feedbacks: "k92_feedbacks_v1",
  users: "k92_users_v1",
  discounts: "k92_discounts_v1",
  albums: "k92_albums_v1",
  deliveryFees: "k92_delivery_fees_v1",
} as const;

// Endpoint /storage là generic KV read/write, KHÔNG đi qua schema validation hay
// business logic (availability check, discount rule, giá tiền...) như các route
// /api/orders, /api/discounts, /api/users. Vì vậy KHÔNG được để bất kỳ key nào
// public-write ở đây — nếu không client bất kỳ (không cần token admin) có thể
// POST /storage để ghi đè thẳng toàn bộ đơn hàng / mã giảm giá / user, bỏ qua
// hết validate. FE hiện tại (api/index.js) cũng không gọi /storage cho các key
// này — mọi thao tác đều đi qua route riêng đã có requireAdmin/requireCustomer
// phù hợp, nên để set này rỗng là an toàn và không phá vỡ tính năng nào.
export const PUBLIC_WRITE_KEYS = new Set<string>([]);

export const ADMIN_PASSWORD_KEY = "k92_admin_pw_hash";

export const DEFAULT_ADMIN_PASSWORD_HASH =
  "db08beaae1b06ae2e84f101f8e37a8c03e16eb8e514ec8c2274b5d89aa2f9d22";
