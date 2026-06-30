import { STORE_KEYS } from "../config/storeKeys.js";
import type { Accessory, Camera, DeliveryFee, Discount } from "../types/domain.js";
import type { GalleryPhoto, Repository } from "../types/repository.js";
import { arrayOrEmpty, getJsonValue } from "./storage.service.js";

const PROCESS_STEPS = [
  {
    id: "choose",
    title: "Chọn máy và ngày thuê",
    description: "Khách chọn máy ảnh, phụ kiện, ngày nhận, thời lượng thuê và xem tạm tính.",
  },
  {
    id: "submit",
    title: "Gửi thông tin đặt lịch",
    description: "Khách vãng lai chỉ cần nhập tên, số điện thoại/Zalo và địa chỉ nhận máy.",
  },
  {
    id: "confirm",
    title: "Admin liên hệ xác minh",
    description: "Admin nhận đơn trong dashboard rồi liên hệ qua Zalo để xác nhận lịch.",
  },
  {
    id: "receive",
    title: "Nhận máy",
    description: "Khách nhận máy tại shop hoặc qua giao nhận theo khu vực đã chọn.",
  },
  {
    id: "return",
    title: "Trả máy và hoàn tất",
    description: "Khách trả máy đúng hẹn, admin cập nhật trạng thái đơn trong lịch thuê.",
  },
];

function publicCamera(camera: Camera) {
  return {
    ...camera,
    images: (camera.images || []).slice(0, 5),
  };
}

function publicAccessory(accessory: Accessory) {
  return {
    ...accessory,
    image: accessory.image || null,
  };
}

export async function getPublicCatalog(repo: Repository) {
  const [cameras, accessories, site, deliveryFees, discounts, albums, photos] = await Promise.all([
    getJsonValue<Camera[]>(repo, STORE_KEYS.cameras),
    getJsonValue<Accessory[]>(repo, STORE_KEYS.accessories),
    getJsonValue<Record<string, unknown>>(repo, STORE_KEYS.site),
    getJsonValue<DeliveryFee[]>(repo, STORE_KEYS.deliveryFees),
    getJsonValue<Discount[]>(repo, STORE_KEYS.discounts),
    getJsonValue<unknown[]>(repo, STORE_KEYS.albums),
    repo.listPhotos(200),
  ]);

  return {
    cameras: arrayOrEmpty<Camera>(cameras)
      .filter((camera) => camera.status !== "unavailable")
      .map(publicCamera),
    accessories: arrayOrEmpty<Accessory>(accessories)
      .filter((accessory) => accessory.active !== false)
      .map(publicAccessory),
    site: site || {},
    deliveryFees: arrayOrEmpty<DeliveryFee>(deliveryFees),
    processSteps: PROCESS_STEPS,
    discounts: arrayOrEmpty<Discount>(discounts)
      .filter((discount) => discount.active === true)
      .map((discount) => ({
        code: discount.code,
        type: discount.type,
        value: discount.value,
        minOrder: discount.minOrder || 0,
        voucherScope: discount.voucherScope || "rental",
      })),
    albums: arrayOrEmpty<unknown>(albums),
    photos: arrayOrEmpty<GalleryPhoto>(photos),
  };
}

export async function getCatalogData(repo: Repository) {
  const [cameras, accessories, deliveryFees, discounts] = await Promise.all([
    getJsonValue<Camera[]>(repo, STORE_KEYS.cameras),
    getJsonValue<Accessory[]>(repo, STORE_KEYS.accessories),
    getJsonValue<DeliveryFee[]>(repo, STORE_KEYS.deliveryFees),
    getJsonValue<Discount[]>(repo, STORE_KEYS.discounts),
  ]);

  return {
    cameras: arrayOrEmpty<Camera>(cameras),
    accessories: arrayOrEmpty<Accessory>(accessories),
    deliveryFees: arrayOrEmpty<DeliveryFee>(deliveryFees),
    discounts: arrayOrEmpty<Discount>(discounts),
  };
}
