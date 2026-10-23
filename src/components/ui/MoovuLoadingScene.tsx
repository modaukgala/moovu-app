import Image from "next/image";
import styles from "./MoovuLoadingScreen.module.css";

export default function MoovuLoadingScene() {
  return <div className={styles.scene} aria-hidden="true">
    <svg className={styles.landscape} viewBox="0 0 600 310" fill="none">
      <path d="M0 150Q90 100 175 143T355 130T600 117V280H0Z" fill="#fff8d9" />
      <g fill="#c4cbcb" opacity=".6">
        <path d="M0 205h67v42H0zM7 203l25-20 30 20zm72 7h72v38H79zm-9 0 45-29 45 29zm106-14h60v49h-60zm-9 0 39-28 39 28zm91 21h68v35h-68zm-9 0 43-25 43 25zm102-15h62v48h-62zm-9 0 40-27 41 27zm100 12h70v41h-70zm-9 0 44-26 44 26zm100-13h67v51h-67zm-9 0 44-27 41 27z" />
        <path d="M491 163h7V57h-7zM485 62h20V48h-20zM493 48h3V24h-3zM44 218h5V117h-5zM25 131h43v4H25zM139 223h4V134h-4zM125 145h32v4h-32zM365 225h4V123h-4zM352 138h31v4h-31zM83 231h5v-79h-5z" />
        <ellipse cx="85" cy="161" rx="29" ry="19" />
      </g>
      <path d="M0 246h600" stroke="#fff" strokeWidth="25" />
      <path className={styles.route} d="M48 232C180 232 21 282 162 282S359 313 551 290" stroke="#ffda00" strokeWidth="9" strokeLinecap="round" pathLength="1" />
      <path className={styles.routeLight} d="M48 232C180 232 21 282 162 282S359 313 551 290" stroke="#fff8b5" strokeWidth="3" strokeLinecap="round" pathLength="1" />
      <g transform="translate(48 220)">
        <ellipse cy="12" rx="18" ry="4" fill="#ffda00" />
        <path d="M0 7C-5-2-15-13-15-23a15 15 0 0 1 30 0C15-13 5-2 0 7Z" fill="#16191c" />
        <circle cy="-23" r="6" fill="#ffda00" />
      </g>
      <g className={styles.destination} transform="translate(551 278)">
        <ellipse cy="12" rx="22" ry="5" fill="#ffda00" />
        <path d="M0 5C-6-5-18-17-18-29a18 18 0 0 1 36 0C18-17 6-5 0 5Z" fill="#ffda00" stroke="#17191d" strokeWidth="2" />
        <circle cy="-29" r="8" fill="#17191d" /><circle cy="-29" r="4" fill="white" />
      </g>
    </svg>
    <div className={styles.vehicleEntry}>
      <Image src="/loading/moovu-premium-sedan.webp" alt="" width={1320} height={580}
        sizes="(max-width: 640px) 76vw, 456px" priority unoptimized className={styles.vehicle} />
    </div>
  </div>;
}
