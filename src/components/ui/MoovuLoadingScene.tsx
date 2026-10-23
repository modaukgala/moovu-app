import { useId } from "react";
import styles from "./MoovuLoadingScreen.module.css";

export default function MoovuLoadingScene() {
  const id = useId().replace(/:/g, "");
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
      <svg className={styles.vehicle} viewBox="0 0 500 220" fill="none">
        <defs>
          <linearGradient id={`${id}-body`} x2="0" y2="1"><stop stopColor="#51575c" /><stop offset=".4" stopColor="#171b20" /><stop offset=".8" stopColor="#080a0d" /><stop offset="1" stopColor="#30353a" /></linearGradient>
          <linearGradient id={`${id}-glass`} x2="1" y2="1"><stop stopColor="#c8d1d7" /><stop offset=".35" stopColor="#56636e" /><stop offset="1" stopColor="#111b24" /></linearGradient>
        </defs>
        <ellipse cx="251" cy="193" rx="225" ry="12" fill="#15181c" opacity=".12" />
        <path d="M28 105 83 91l64-55c15-11 100-18 144-5l66 49 78 17c23 6 41 25 43 47l-6 28-27 10H42l-21-21 2-39Z" fill={`url(#${id}-body)`} stroke="#14181d" strokeWidth="3" />
        <path d="m96 91 62-48c17-9 88-13 127-4l57 44-110 5Z" fill={`url(#${id}-glass)`} stroke="#aab4bb" strokeWidth="2" />
        <path d="m219 35 9 54m-76-45-12 47m149-50 14 45" stroke="#171c22" strokeWidth="7" />
        <path d="m31 111 105 1 142-12 139 10" stroke="#a1a8ae" strokeWidth="2" opacity=".7" />
        <path d="m42 119 103 19 169-18 83 9-91 1-161 23-103-25Z" fill="#ffda00" />
        <path d="M160 101v69m124-74 17 69" stroke="#3d4349" strokeWidth="1.5" />
        <path d="m177 106 19-1m59-5 18-1" stroke="#bec4c7" strokeWidth="3" strokeLinecap="round" />
        <path d="m352 114 71 6 25-5-19 16-67-5Z" fill="#f0f5ed" /><path d="m27 117 28-2 10 13-39 4Z" fill="#b12730" />
        <path d="m401 141 64-1-10 24-53 2Z" fill="#080a0c" stroke="#697178" strokeWidth="2" />
        <path d="m414 147 42-1m-42 7h39m-38 6h35" stroke="#40464d" strokeWidth="2" />
        <path d="M40 173h349m16 6 42-2" stroke="#e0b723" strokeWidth="3" />
        {[108, 351].map((x) => <g key={x} transform={`translate(${x} 166)`}>
          <circle r="37" fill="#090b0e" stroke="#42484e" strokeWidth="2" /><circle r="26" fill="#697078" /><circle r="22" fill="#171c22" />
          <g className={styles.wheel}>{[0, 60, 120, 180, 240, 300].map((angle) => <path key={angle} transform={`rotate(${angle})`} d="m-3-5-2-16 6-1 3 17Z" fill="#c0c6cb" />)}</g>
          <circle r="6" fill="#b9bec4" /><circle r="3" fill="#3c4248" />
        </g>)}
        <path d="m302 83 19-3 13 9-21 5Z" fill="#252c33" stroke="#9da6ad" />
      </svg>
    </div>
  </div>;
}
