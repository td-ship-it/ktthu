/**
 * Cloudflare Worker — điểm vào của ứng dụng.
 *   /api      → chuyển tiếp tới Google Apps Script (src/api.js)
 *   còn lại   → trả file tĩnh trong thư mục public/
 *   cron      → "đánh thức" Apps Script định kỳ trong giờ làm việc để người dùng
 *               không phải chờ Google khởi động lại (cold start).
 *
 * Gói Cloudflare miễn phí chỉ cho 5 lịch (Cron) mỗi tài khoản, nên CHỈ Worker chính (tccb) có lịch.
 * Đến giờ, Worker chính đánh thức Apps Script của mình, rồi gọi Warm.ping() của từng Worker khác
 * qua service binding (các biến WARM_<tên> trong wrangler.toml). Warm không mở ra Internet.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { handleApi } from "./api.js";

const wake = env =>
  env.APPS_SCRIPT_URL
    ? fetch(env.APPS_SCRIPT_URL, { method: "GET", redirect: "follow" }).then(r => r.status, () => 0)
    : Promise.resolve(-1);

/** Chỉ gọi được từ Worker khác cùng tài khoản qua service binding. */
export class Warm extends WorkerEntrypoint {
  async ping() { return wake(this.env); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api") return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env, ctx) {
    // doGet của Apps Script rất nhẹ (không đọc Sheets), chỉ để giữ script luôn sẵn sàng
    const jobs = [wake(env)];
    for (const k of Object.keys(env)) {
      if (k.startsWith("WARM_") && env[k] && typeof env[k].ping === "function") {
        jobs.push(env[k].ping().catch(() => 0));
      }
    }
    ctx.waitUntil(Promise.allSettled(jobs));
  },
};
