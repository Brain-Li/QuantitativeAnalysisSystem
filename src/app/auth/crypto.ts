import { sha256 as sha256Js } from "js-sha256";

/**
 * SHA-256 十六进制（小写）。
 * 优先用 Web Crypto；在「非安全上下文」下（如 http://公网IP）`crypto.subtle` 不可用，改用纯 JS 实现。
 * @see https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts
 */
export async function sha256Hex(text: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const data = new TextEncoder().encode(text);
      const hash = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      /* 部分环境下 subtle 抛错，回退 */
    }
  }
  return sha256Js(text);
}
