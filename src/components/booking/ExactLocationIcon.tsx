type ExactLocationIconProps = {
  className?: string;
};

export default function ExactLocationIcon({ className }: ExactLocationIconProps) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M2 6V3.5A1.5 1.5 0 0 1 3.5 2H6M12 2h2.5A1.5 1.5 0 0 1 16 3.5V6M16 12v2.5a1.5 1.5 0 0 1-1.5 1.5H12M6 16H3.5A1.5 1.5 0 0 1 2 14.5V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 13s3-3.05 3-5.75a3 3 0 1 0-6 0C6 9.95 9 13 9 13Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="9" cy="7.25" r="1" fill="currentColor" />
    </svg>
  );
}
