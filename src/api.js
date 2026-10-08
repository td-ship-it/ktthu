/**
 * Xử lý POST /api — chuyển tiếp yêu cầu từ trình duyệt tới Google Apps Script Web App.
 *
 * Biến môi trường (Cloudflare → Worker → Settings → Variables and Secrets):
 *   APPS_SCRIPT_URL : URL Web App dạng https://script.google.com/macros/s/XXXX/exec
 *   PROXY_KEY       : chuỗi bí mật, trùng với Script property PROXY_KEY bên Apps Script (đặt dạng Secret)
 */

const MAX_BODY = 64 * 1024; // 64 KB

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

export async function handleApi(request, env) {
  if (request.method !== "POST") {
    return json({ success: false, code: "METHOD", message: "Chỉ hỗ trợ POST" }, 405);
  }

  if (!env.APPS_SCRIPT_URL || !env.PROXY_KEY) {
    return json({ success: false, code: "CONFIG", message: "Máy chủ chưa cấu hình APPS_SCRIPT_URL / PROXY_KEY" }, 500);
  }

  // Chỉ nhận yêu cầu từ chính trang web này
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ success: false, code: "FORBIDDEN", message: "Nguồn yêu cầu không hợp lệ" }, 403);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) {
    return json({ success: false, code: "TOO_LARGE", message: "Dữ liệu gửi lên quá lớn" }, 413);
  }

  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return json({ success: false, code: "BAD_REQUEST", message: "Yêu cầu không hợp lệ" }, 400);
  }
  if (typeof body.action !== "string") {
    return json({ success: false, code: "BAD_REQUEST", message: "Thiếu action" }, 400);
  }

  const payload = {
    action: body.action,
    args: body.args && typeof body.args === "object" ? body.args : {},
    token: typeof body.token === "string" ? body.token : null,
    proxyKey: env.PROXY_KEY,
    clientIp: request.headers.get("CF-Connecting-IP") || "",
  };

  // Thông tin mạng / vị trí do Cloudflare cung cấp — chỉ gửi kèm khi đăng nhập để ghi lịch sử
  if (body.action === "login" || body.action === "verifyOtp" || body.action === "resendOtp") {
    const cf = request.cf || {};
    payload.client = {
      userAgent: (request.headers.get("User-Agent") || "").slice(0, 500),
      acceptLanguage: (request.headers.get("Accept-Language") || "").slice(0, 100),
      country: cf.country || "",
      region: cf.region || "",
      city: cf.city || "",
      asn: cf.asn || "",
      asOrganization: cf.asOrganization || "",
    };
  }

  const result = await callAppsScript(env.APPS_SCRIPT_URL, payload);
  if (!result.ok && result.denied) {
    return json(
      {
        success: false,
        code: "CONFIG",
        message:
          "Google từ chối truy cập Web App (" + result.detail + "). Quản trị viên kiểm tra: " +
          "(1) Deploy với 'Ai có quyền truy cập: Bất kỳ ai' (không phải 'Bất kỳ ai có Tài khoản Google'); " +
          "(2) APPS_SCRIPT_URL phải kết thúc bằng /exec, không phải /dev.",
      },
      502
    );
  }
  if (!result.ok) {
    return json(
      {
        success: false,
        code: "UPSTREAM",
        message:
          "Máy chủ Google đang bận hoặc phản hồi chậm (" + result.detail + "). " +
          "Vui lòng thử lại sau ít giây. Nếu lỗi kéo dài, kiểm tra URL Web App và quyền 'Anyone' khi deploy.",
      },
      502
    );
  }
  const text = result.text;

  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// ------------------------------------------------------------
// Gọi Apps Script có thử lại.
// Apps Script xử lý theo 2 bước:
//   (1) POST script.google.com/.../exec → script CHẠY, trả 302
//   (2) GET  script.googleusercontent.com/macros/echo?... → lấy kết quả
// Bước (2) thỉnh thoảng trả 404/5xx khi Google tải cao. Lúc đó script ĐÃ chạy,
// nên chỉ lấy lại kết quả ở bước (2), KHÔNG gửi lại bước (1) (tránh lưu trùng,
// gửi trùng OTP). Bước (1) lỗi (404/429/5xx) nghĩa là script chưa chạy → thử lại an toàn.
// ------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isJson = (t) => { try { JSON.parse(t); return true; } catch { return false; } };

const POST_TRIES = 3;     // số lần gửi bước (1)
const ECHO_TRIES = 4;     // số lần lấy kết quả ở bước (2)

export async function callAppsScript(url, payload, opts = {}) {
  const wait = opts.sleep || sleep;
  const body = JSON.stringify(payload);
  let detail = "";

  for (let attempt = 0; attempt < POST_TRIES; attempt++) {
    if (attempt) await wait(500 * attempt);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        redirect: "manual",
      });
    } catch (e) {
      detail = "không kết nối được";
      continue;
    }

    // Bước (1) thành công → lấy kết quả ở bước (2), thử lại nhiều lần nếu cần
    if (res.status >= 300 && res.status < 400 && res.headers.get("Location")) {
      const loc = res.headers.get("Location");
      for (let k = 0; k < ECHO_TRIES; k++) {
        if (k) await wait(400 * k);
        try {
          const r2 = await fetch(loc, { method: "GET", redirect: "follow" });
          const t2 = await r2.text();
          if (isJson(t2)) return { ok: true, text: t2 };
          detail = "HTTP " + r2.status + " khi lấy kết quả";
        } catch (e) {
          detail = "mất kết nối khi lấy kết quả";
        }
      }
      return { ok: false, detail };
    }

    // Một số trường hợp Google trả thẳng JSON không qua chuyển hướng
    const t = await res.text();
    if (res.ok && isJson(t)) return { ok: true, text: t };
    detail = "HTTP " + res.status;
    // 401/403: Web App không cho truy cập công khai → lỗi cấu hình, thử lại vô ích
    if (res.status === 401 || res.status === 403) return { ok: false, denied: true, detail };
    // 404 / 429 / 5xx ở bước (1): script chưa chạy → thử lại
  }
  return { ok: false, detail };
}
