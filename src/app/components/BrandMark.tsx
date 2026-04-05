/** 与侧栏一致的 K 线标识，用于登录页与主界面统一品牌 */
export function CandlestickBrandIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <line x1="4.5" y1="2" x2="4.5" y2="4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="3" y="4" width="3" height="7" rx="0.5" fill="white" />
      <line x1="4.5" y1="11" x2="4.5" y2="14" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="10" y1="3" x2="10" y2="5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="8.5" y="5.5" width="3" height="5" rx="0.5" fill="white" opacity="0.6" />
      <line x1="10" y1="10.5" x2="10" y2="13" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="15.5" y1="1" x2="15.5" y2="4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="14" y="4" width="3" height="9" rx="0.5" fill="white" />
      <line x1="15.5" y1="13" x2="15.5" y2="16" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
