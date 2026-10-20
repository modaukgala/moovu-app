import Image from "next/image";

type MoovuLoadingScreenProps = {
  message: string;
  layout?: "full" | "contained";
  theme?: "light" | "dark";
};

export default function MoovuLoadingScreen({
  message,
  layout = "full",
  theme = "light",
}: MoovuLoadingScreenProps) {
  return (
    <main
      className={`moovu-customer-loading moovu-customer-loading--${layout} moovu-customer-loading--${theme}`}
      role="status"
      aria-live="polite"
      aria-label={message}
    >
      <div className="moovu-customer-loading__content">
        <Image
          src="/logo.png"
          alt="MOOVU Kasi Rides"
          width={208}
          height={208}
          priority
          className="moovu-customer-loading__logo"
        />
        <div className="moovu-customer-loading__road-scene" aria-hidden="true">
          <svg
            className="moovu-customer-loading__car"
            viewBox="0 0 420 180"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="moovu-car-body" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#49cfad" />
                <stop offset="0.48" stopColor="#198eaa" />
                <stop offset="1" stopColor="#1f74c9" />
              </linearGradient>
              <linearGradient id="moovu-car-glass" x1="0" y1="0" x2="0.8" y2="1">
                <stop offset="0" stopColor="#e4f7fb" />
                <stop offset="1" stopColor="#5a8ba8" />
              </linearGradient>
              <linearGradient id="moovu-car-lower" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#204f83" />
                <stop offset="1" stopColor="#112b4c" />
              </linearGradient>
            </defs>
            <ellipse cx="214" cy="156" rx="186" ry="10" fill="#173957" opacity="0.12" />
            <path d="M44 91c8-4 29-8 47-11l42-45c7-8 18-12 29-12h130c14 0 23 6 32 17l31 39 20 5c13 3 22 11 24 24l3 24c1 8-5 14-13 14H31c-9 0-15-6-14-14l3-22c2-9 9-15 24-19Z" fill="url(#moovu-car-body)" stroke="#165a8b" strokeWidth="3" />
            <path d="M142 38c4-5 11-7 19-7h62v49H102l40-42Zm90-7h58c10 0 16 3 22 10l31 39H232V31Z" fill="url(#moovu-car-glass)" stroke="#d5f2f4" strokeWidth="3" />
            <path d="M223 31v50M97 83h252" stroke="#164e76" strokeWidth="3" opacity="0.75" />
            <path d="M22 112h378v24c0 6-4 10-10 10H31c-7 0-11-4-11-10l2-24Z" fill="url(#moovu-car-lower)" opacity="0.55" />
            <path d="M35 104h343" stroke="#c8fff0" strokeWidth="4" strokeLinecap="round" opacity="0.72" />
            <path d="M28 99h19l-4 14H22c1-7 2-10 6-14Z" fill="#ffecb8" />
            <path d="M381 96h12l4 16h-19l3-16Z" fill="#d5474e" />
            <path d="M158 94h21m95 0h21" stroke="#d7f5ef" strokeWidth="4" strokeLinecap="round" />
            <circle cx="103" cy="139" r="31" fill="#152a3f" />
            <circle cx="103" cy="139" r="19" fill="#d6e1e9" />
            <circle cx="103" cy="139" r="9" fill="#8298a8" />
            <circle cx="326" cy="139" r="31" fill="#152a3f" />
            <circle cx="326" cy="139" r="19" fill="#d6e1e9" />
            <circle cx="326" cy="139" r="9" fill="#8298a8" />
          </svg>
          <span className="moovu-customer-loading__road" />
        </div>
        <p className="moovu-customer-loading__slogan">Your Kasi Ride.</p>
        <p className="moovu-customer-loading__message">{message}</p>
      </div>
    </main>
  );
}
