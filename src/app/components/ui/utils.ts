import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 判断指针事件是否落在容器内。拖动原生滚动条时，部分浏览器下 e.target 不是滚动容器的子节点，
 * 仅用 contains(target) 会误判为外部点击并关闭浮层；需用 elementFromPoint 兜底。
 */
export function isPointerEventInsideContainer(
  container: HTMLElement | null,
  e: Pick<MouseEvent, "target" | "clientX" | "clientY">,
): boolean {
  if (!container) return false;
  const t = e.target;
  if (t instanceof Node && container.contains(t)) return true;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  return !!(el && container.contains(el));
}
