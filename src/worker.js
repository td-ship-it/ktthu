/**
 * Cloudflare Worker — điểm vào của ứng dụng.
 *   /api      → chuyển tiếp tới Google Apps Script (src/api.js)
 *   còn lại   → trả file tĩnh trong thư mục public/
 *   cron      → "đánh thức" Apps Script định kỳ trong giờ làm việc để người dùng
 *               không phải chờ Google khởi động lại (cold start) — xem [triggers] trong wrangler.toml
 */
import { handleApi } from "./api.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api") return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env, ctx) {
    if (!env.APPS_SCRIPT_URL) return;
    // doGet của Apps Script rất nhẹ (không đọc Sheets), chỉ để giữ script luôn sẵn sàng
    ctx.waitUntil(fetch(env.APPS_SCRIPT_URL, { method: "GET", redirect: "follow" }).catch(() => {}));
  },
};
