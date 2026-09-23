const reportTitle = "MOOVU System Design & Product Specification";
const reportSubtitle = "Complete Product, Business and Technical Overview";

export const skippedVisuals = [
  "Customer active-trip view with live personal trip data",
  "Customer receipt populated with real customer details",
  "Driver live trip execution screen during an active ride",
  "Admin dashboard populated with real operational data",
  "Admin payment review tables populated with real driver payment records",
  "Admin receipts linked to real customer or driver records",
];

export const reportFacts = {
  reportTitle,
  reportSubtitle,
  version: "1.0",
  organization: "MOOVU",
  category: "Ride-hailing and local transport technology",
  marketFocus: "Siyabuswa, KwaMhlanga, KwaNdebele nearby areas and township local travel",
  brand: {
    blue: "#1f74c9",
    blueDark: "#244f9e",
    lightBlue: "#eaf3ff",
    sky: "#b0e0f0",
    aqua: "#c0f0e0",
    navy: "#0f172a",
    black: "#050505",
    white: "#ffffff",
    grey: "#5b6776",
    green: "#16a34a",
    gold: "#f5b301",
  },
  technologies: [
    "Next.js 16 App Router",
    "React 19",
    "TypeScript",
    "Supabase Auth, Database and Storage",
    "Google Maps services",
    "Firebase Cloud Messaging and Web Push",
    "Capacitor Android and iOS shells",
    "Tailwind CSS 4",
  ],
  rideOptions: [
    {
      id: "go",
      name: "MOOVU Go",
      riderCapacity: "Up to 3 riders",
      baseFare: "R15",
      bookingFee: "R4",
      minFare: "R40",
      perKm: "R9/km",
      perMinute: "R1.50/min",
      waiting: "R2/min after 3 free minutes",
      commission: "10%",
      cancellation: "Late cancellation R20, no-show R30",
    },
    {
      id: "group",
      name: "MOOVU Go XL",
      riderCapacity: "Up to 6 riders",
      baseFare: "R25",
      bookingFee: "R5",
      minFare: "R70",
      perKm: "R12/km",
      perMinute: "R2.00/min",
      waiting: "R3/min after 3 free minutes",
      commission: "12%",
      cancellation: "Late cancellation R30, no-show R40",
    },
  ],
  subscriptions: [
    { plan: "Daily", amount: "R45", duration: "1 day" },
    { plan: "Weekly", amount: "R100", duration: "7 days" },
    { plan: "Monthly", amount: "R250", duration: "30 days" },
  ],
  dispatch: {
    acceptWindow: "25 seconds",
    escalation: "25-second rounds",
    gpsFreshness: "90 seconds",
    initialRadius: "8 km",
    expandedRadius: "20 km",
    maxCycles: "3",
    maxSearch: "180 seconds in code",
    backgroundOfferEligibility: "8 hours",
  },
  otp: {
    start: "4-digit start OTP",
    end: "4-digit end OTP",
    arrivalRadius: "20 metres",
    completionRadius: "400 metres",
    minimumTripSeconds: "At least 120 seconds and up to 600 seconds, based on 20% of estimated duration",
  },
  finance: {
    commissionFallback: "9.5% legacy fallback commission constant",
    commissionLockLimit: "R100 balance due lock threshold",
    addStops: "Maximum 2 stops with a 40% discount on the raw add-stop increase",
    distanceDiscounts: "0% up to 10 km, 15% above 10 km, 30% above 18 km",
    manualSurge: "Normal 1.0x, Busy 1.1x, Heavy demand 1.2x, Rain/Event 1.4x",
  },
  adminRoles: ["owner", "admin", "dispatcher", "support"],
};

const customerScreens = [
  ["Landing page", "App-style entry screen, booking CTA, trust panels, driver application CTA", "Visitor / customer"],
  ["Customer authentication", "Phone, email and password-based access to customer account", "Visitor"],
  ["Booking page", "Pickup, destination, stops, ride option, fare estimate, notifications, booking submit", "Customer"],
  ["Ride history", "Previous trips, receipt access, rating links", "Customer"],
  ["Active trip", "Assigned driver, fare state, OTP state, chat, final actions", "Customer"],
  ["Receipt", "Trip proof with fare and ride details", "Customer"],
  ["Rating", "Post-trip rating flow", "Customer"],
  ["Account and security", "Profile and account security surfaces", "Customer"],
  ["Delete account", "Apple-compliant in-app deletion flow", "Customer"],
  ["Privacy, terms and contact", "Legal and support surfaces", "Visitor / customer"],
];

const driverScreens = [
  ["Driver login", "Separate driver sign-in surface and route domain", "Driver"],
  ["Driver application", "Guided multi-step onboarding", "Applicant"],
  ["Driver home", "Online status, offer state, GPS, live trip actions", "Approved driver"],
  ["Trip offers", "Offer reception, countdown, accept or decline", "Online driver"],
  ["Driver history", "Past trip list and filters", "Driver"],
  ["Driver earnings", "Gross, net, commission and wallet summaries", "Driver"],
  ["Driver subscriptions", "Plan selection and proof of payment submission", "Driver"],
  ["Driver commission payments", "Commission payment to MOOVU with POP upload", "Driver"],
  ["Driver account", "Identity, documents, quick actions", "Driver"],
  ["Delete account", "In-app account deletion flow", "Driver"],
];

const adminScreens = [
  ["Admin dashboard", "Operational overview and KPI summaries", "Administrator"],
  ["Trips", "Trip list and detail review", "Administrator / support"],
  ["Dispatch board", "Live trip assignment and intervention", "Dispatcher"],
  ["Dispatch map", "Geographic operational view", "Dispatcher"],
  ["Drivers", "Driver directory, status and profile management", "Admin"],
  ["Applications", "Driver onboarding review queue", "Admin"],
  ["Payment reviews", "Subscription, commission and combined payment review", "Payment reviewer"],
  ["Subscriptions", "Subscription management and approval workflow", "Payment reviewer"],
  ["Commission payments", "Commission settlement management", "Payment reviewer"],
  ["Receipts", "Trip and payment receipt access", "Admin / support"],
  ["Reports and earnings", "Operational and financial reporting", "Admin / owner"],
  ["Notifications", "Admin-side notification surface", "Admin"],
];

const roles = [
  ["Visitor", "Can access public landing, legal pages, and customer or driver entry points", "No trip or protected data access"],
  ["Customer", "Can create bookings, track trips, use OTP, chat, rate, and view receipts", "Cannot access driver or admin operations"],
  ["Driver applicant", "Can create a driver account and submit onboarding data", "Cannot receive trips until approved and eligible"],
  ["Approved driver", "Can log in, go online, receive offers, execute trips, and manage earnings", "Cannot use admin operational tools"],
  ["Administrator", "Can review trips, drivers, receipts, and payments", "Requires approved admin role in profiles table"],
  ["Dispatcher", "Operational dispatch visibility and intervention", "Subset of admin roles"],
  ["Support", "Operational and customer support visibility", "Subset of admin roles"],
  ["Payment reviewer", "Reviews subscription, commission and combined driver payments", "Admin-protected workflow"],
  ["Owner", "Highest administrative authority", "Role-based, not separate app surface"],
];

const entities = [
  ["Customers", "Customer profile and authenticated rider identity", "Auth-linked account, bookings, receipts, ratings"],
  ["Drivers", "Operational driver profile and live availability", "Eligibility, dispatch, earnings, subscriptions"],
  ["Driver accounts", "Links auth users to driver records", "Ownership checks"],
  ["Driver applications", "Pre-approval onboarding submissions", "Admin review queue"],
  ["Driver documents", "Driver document metadata and review status", "Eligibility and compliance"],
  ["Trips", "Ride booking and lifecycle record", "Core transaction and dispatch anchor"],
  ["Trip events", "Lifecycle audit trail", "Support, audit, OTP and dispatch history"],
  ["Driver trip offers", "Offer queue for staged dispatch", "Offer state and atomic acceptance"],
  ["Driver wallets", "Commission due, totals and account status", "Eligibility lock and financial reporting"],
  ["Driver settlements", "Commission payments received", "Balance reduction and audit"],
  ["Driver payment requests", "Subscription or commission proof submissions", "Admin review workflow"],
  ["Driver subscription payments", "Approved subscription payment records", "Subscription activation history"],
  ["Driver subscription events", "Subscription timeline and admin actions", "Lifecycle history"],
  ["Trip cancellation fees", "Late cancellation and no-show ledger", "Customer fee handling"],
  ["Trip messages", "Customer-driver live chat messages", "Accepted trip messaging"],
  ["Trip ratings", "Post-trip rating records", "Experience and quality tracking"],
  ["Push subscriptions", "Legacy web push subscription records", "Browser push delivery"],
  ["FCM tokens", "Device token registry across web, Android and iOS", "Push routing"],
  ["App pricing settings", "Server-controlled pricing settings such as manual surge", "Operational pricing control"],
];

const notificationMatrix = [
  ["New trip request", "No", "Yes", "Yes", "FCM / web push", "Driver portal and admin trip oversight"],
  ["Driver accepted trip", "Yes", "No", "Yes", "FCM / web push", "Customer ride view and admin dispatch"],
  ["Driver arrived", "Yes", "No", "Optional", "FCM / web push", "Customer ride view"],
  ["Trip started", "Yes", "Optional", "Optional", "FCM / web push", "Customer ride view"],
  ["Trip completed", "Yes", "Yes", "Yes", "FCM / web push", "Customer ride view, driver history, admin trips"],
  ["Customer chat message", "No", "Yes", "No", "FCM / web push", "Driver live trip context"],
  ["Driver chat reply", "Yes", "No", "No", "FCM / web push", "Customer live trip context"],
  ["Subscription payment submitted", "No", "No", "Yes", "FCM / web push", "Admin payment reviews"],
  ["Commission payment submitted", "No", "No", "Yes", "FCM / web push", "Admin payment reviews"],
  ["Payment approved or rejected", "No", "Yes", "No", "FCM / web push", "Driver earnings and receipts"],
];

const maturity = [
  ["Customer accounts", 4, "Solid account, legal acceptance and deletion flow are present."],
  ["Customer booking", 4, "Core ride request flow is implemented with fare logic, stops and surge."],
  ["Fare calculation", 4, "Centralized fare rules exist, with finalization and stop-aware adjustments."],
  ["Driver onboarding", 4, "Multi-step guided application is implemented, with review hooks."],
  ["Driver documents", 3, "Document model exists; runtime depends on bucket and policy alignment."],
  ["Driver subscriptions", 4, "Plan pricing, review flow and activation logic exist."],
  ["Driver eligibility", 4, "Eligibility checks are explicit across subscription, balance and vehicle capacity."],
  ["Dispatch", 4, "Scored candidate selection and atomic acceptance exist, but durable worker matters."],
  ["Driver trip execution", 4, "Offer, arrive, OTP, complete and earnings flow are implemented."],
  ["Live location", 3, "Foreground tracking is present; closed-app tracking remains runtime-dependent."],
  ["OTP", 4, "Start and end OTP gates are implemented with admin and bypass controls."],
  ["Notifications", 3, "Infrastructure is strong, but device/runtime delivery remains environment-dependent."],
  ["Admin operations", 4, "Broad operational coverage exists across trips, drivers and finance."],
  ["Finance", 4, "Wallet, settlement, payment review and subscription logic are implemented."],
  ["Commission", 3, "Core logic exists, but commission rules contain a documented mismatch."],
  ["Receipts", 4, "Customer and admin receipt access exists."],
  ["Native mobile integration", 3, "Split Capacitor shells are present; real-device delivery still matters."],
  ["Support and safety", 4, "OTP, review, chat, audit trail and location visibility are present."],
];

const operationalPlaybooks = [
  ["New driver onboarding", "Admin", "Review application, documents, vehicle data, then approve or request corrections."],
  ["Daily driver readiness", "Operations / dispatcher", "Check subscription, online status, GPS freshness and blocked balances."],
  ["Customer booking support", "Support", "Review trip record, dispatch state, location data and customer messages."],
  ["No-driver trip handling", "Dispatcher", "Check candidate pool, radius, eligibility, recent declines and trip age."],
  ["Active-trip intervention", "Admin / support", "Review trip status, OTP state, trip events and location freshness."],
  ["Subscription approval", "Payment reviewer", "Review payment proof, approve, activate plan and notify driver."],
  ["Commission-payment approval", "Payment reviewer", "Review payment proof, settle wallet, issue receipt path and notify driver."],
  ["Driver account restriction", "Admin", "Deactivate or suspend status and document reason."],
  ["Trip cancellation review", "Support / admin", "Inspect status, timestamps, cancellation reason and fees."],
  ["End-of-day operations review", "Owner / admin", "Review trips, payments, subscriptions, blocked balances and issues."],
];

const glossary = [
  ["Dispatch", "The trip assignment process that searches for eligible drivers and sends offers."],
  ["Trip offer", "A timed assignment opportunity sent to eligible online drivers."],
  ["Search cycle", "A dispatch round with a set radius and offer window."],
  ["MOOVU Go", "The base ride category for up to three riders."],
  ["MOOVU Go XL / Go Plus", "The larger-capacity ride category for up to six riders; naming differs across surfaces."],
  ["Final fare", "The customer fare after distance, duration, stops, surge, discounts and end-of-trip finalization."],
  ["Wallet balance", "Driver commission balance still owed to MOOVU."],
  ["Settlement", "A driver commission payment accepted by MOOVU."],
  ["FCM token", "The push-registration token used to send Firebase notifications to devices."],
  ["GPS freshness", "Whether the driver heartbeat is recent enough to trust for dispatch or trip actions."],
];

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function list(items) {
  return `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function table(headers, rows) {
  return `
    <table>
      <thead>
        <tr>${headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function screenshotFigure(screenshot, caption, className = "") {
  if (!screenshot) return "";
  return `
    <figure class="screenshot ${className}">
      <img src="${esc(screenshot)}" alt="${esc(caption)}" />
    </figure>
    <div class="caption">${esc(caption)}</div>
  `;
}

function flowDiagram(title, steps, accent = "#1f74c9") {
  const width = 1040;
  const boxWidth = 150;
  const boxHeight = 72;
  const gap = 16;
  const total = steps.length;
  const rowWidth = total * boxWidth + (total - 1) * gap;
  const startX = Math.max(20, (width - rowWidth) / 2);
  const svgHeight = 150;
  const boxes = steps.map((step, index) => {
    const x = startX + index * (boxWidth + gap);
    const y = 28;
    const arrow = index < total - 1
      ? `<line x1="${x + boxWidth}" y1="${y + boxHeight / 2}" x2="${x + boxWidth + gap}" y2="${y + boxHeight / 2}" stroke="${accent}" stroke-width="4" stroke-linecap="round"/><polygon points="${x + boxWidth + gap - 10},${y + boxHeight / 2 - 8} ${x + boxWidth + gap},${y + boxHeight / 2} ${x + boxWidth + gap - 10},${y + boxHeight / 2 + 8}" fill="${accent}" />`
      : "";
    return `
      <rect x="${x}" y="${y}" rx="22" ry="22" width="${boxWidth}" height="${boxHeight}" fill="#ffffff" stroke="${accent}" stroke-width="3"/>
      <text x="${x + boxWidth / 2}" y="${y + 30}" text-anchor="middle" font-size="14" font-weight="700" fill="#0f172a">${esc(step.line1 || step)}</text>
      ${step.line2 ? `<text x="${x + boxWidth / 2}" y="${y + 51}" text-anchor="middle" font-size="11" font-weight="600" fill="#5b6776">${esc(step.line2)}</text>` : ""}
      ${arrow}
    `;
  }).join("");

  return `
    <figure class="diagram">
      <svg viewBox="0 0 ${width} ${svgHeight}" role="img" aria-label="${esc(title)}">
        <text x="20" y="18" font-size="16" font-weight="700" fill="#0f172a">${esc(title)}</text>
        ${boxes}
      </svg>
      <figcaption>${esc(title)}</figcaption>
    </figure>
  `;
}

function laneDiagram(title, lanes) {
  const width = 1040;
  const laneHeight = 68;
  const stepWidth = 132;
  const startY = 24;
  const labelWidth = 135;
  const maxSteps = Math.max(...lanes.map((lane) => lane.steps.length));
  const svgHeight = startY + lanes.length * laneHeight + 24;
  const stepGap = 12;
  const laneRows = lanes.map((lane, rowIndex) => {
    const y = startY + rowIndex * laneHeight;
    const background = rowIndex % 2 === 0 ? "#f8fbff" : "#ffffff";
    const laneSteps = lane.steps.map((step, stepIndex) => {
      const x = labelWidth + stepIndex * (stepWidth + stepGap);
      return `
        <rect x="${x}" y="${y + 10}" rx="18" ry="18" width="${stepWidth}" height="46" fill="#ffffff" stroke="#1f74c9" stroke-width="2"/>
        <text x="${x + stepWidth / 2}" y="${y + 32}" text-anchor="middle" font-size="11" font-weight="700" fill="#0f172a">${esc(step)}</text>
      `;
    }).join("");
    const connectors = lane.steps.slice(0, -1).map((_, stepIndex) => {
      const x = labelWidth + stepIndex * (stepWidth + stepGap);
      return `<line x1="${x + stepWidth}" y1="${y + 33}" x2="${x + stepWidth + stepGap}" y2="${y + 33}" stroke="#1f74c9" stroke-width="3" stroke-linecap="round"/>`;
    }).join("");
    return `
      <rect x="0" y="${y}" width="${width}" height="${laneHeight}" fill="${background}" />
      <text x="12" y="${y + 38}" font-size="12" font-weight="700" fill="#0f172a">${esc(lane.label)}</text>
      ${laneSteps}
      ${connectors}
    `;
  }).join("");

  return `
    <figure class="diagram">
      <svg viewBox="0 0 ${width} ${svgHeight}" role="img" aria-label="${esc(title)}">
        <text x="20" y="18" font-size="16" font-weight="700" fill="#0f172a">${esc(title)}</text>
        ${laneRows}
      </svg>
      <figcaption>${esc(title)}</figcaption>
    </figure>
  `;
}

function stackDiagram(title, columns) {
  const width = 1040;
  const columnWidth = Math.floor((width - 80) / columns.length);
  const svgHeight = 420;
  const body = columns.map((column, index) => {
    const x = 24 + index * (columnWidth + 16);
    const blocks = column.blocks.map((block, blockIndex) => {
      const y = 78 + blockIndex * 72;
      return `
        <rect x="${x}" y="${y}" rx="20" ry="20" width="${columnWidth}" height="52" fill="#ffffff" stroke="${column.accent || "#1f74c9"}" stroke-width="2.5"/>
        <text x="${x + columnWidth / 2}" y="${y + 22}" text-anchor="middle" font-size="12" font-weight="700" fill="#0f172a">${esc(block.title)}</text>
        ${block.detail ? `<text x="${x + columnWidth / 2}" y="${y + 38}" text-anchor="middle" font-size="10" font-weight="600" fill="#5b6776">${esc(block.detail)}</text>` : ""}
      `;
    }).join("");
    return `
      <text x="${x + columnWidth / 2}" y="50" text-anchor="middle" font-size="13" font-weight="700" fill="#0f172a">${esc(column.title)}</text>
      ${blocks}
    `;
  }).join("");
  return `
    <figure class="diagram">
      <svg viewBox="0 0 ${width} ${svgHeight}" role="img" aria-label="${esc(title)}">
        <text x="20" y="22" font-size="16" font-weight="700" fill="#0f172a">${esc(title)}</text>
        ${body}
      </svg>
      <figcaption>${esc(title)}</figcaption>
    </figure>
  `;
}

function decisionDiagram(title, root, branches) {
  const width = 1040;
  const svgHeight = 280;
  const branchWidth = 220;
  const startX = 70;
  return `
    <figure class="diagram">
      <svg viewBox="0 0 ${width} ${svgHeight}" role="img" aria-label="${esc(title)}">
        <text x="20" y="22" font-size="16" font-weight="700" fill="#0f172a">${esc(title)}</text>
        <rect x="380" y="44" rx="22" ry="22" width="280" height="62" fill="#ffffff" stroke="#1f74c9" stroke-width="3"/>
        <text x="520" y="71" text-anchor="middle" font-size="14" font-weight="700" fill="#0f172a">${esc(root)}</text>
        <text x="520" y="90" text-anchor="middle" font-size="10" font-weight="600" fill="#5b6776">Driver can receive a trip</text>
        ${branches.map((branch, index) => {
          const x = startX + index * (branchWidth + 18);
          return `
            <line x1="520" y1="106" x2="${x + branchWidth / 2}" y2="146" stroke="#1f74c9" stroke-width="3" stroke-linecap="round"/>
            <rect x="${x}" y="146" rx="20" ry="20" width="${branchWidth}" height="88" fill="#ffffff" stroke="${branch.ok ? "#16a34a" : "#d97706"}" stroke-width="2.5"/>
            <text x="${x + branchWidth / 2}" y="174" text-anchor="middle" font-size="12" font-weight="700" fill="#0f172a">${esc(branch.title)}</text>
            <text x="${x + branchWidth / 2}" y="193" text-anchor="middle" font-size="10" font-weight="600" fill="#5b6776">${esc(branch.detail)}</text>
            <text x="${x + branchWidth / 2}" y="214" text-anchor="middle" font-size="10" font-weight="700" fill="${branch.ok ? "#166534" : "#b45309"}">${esc(branch.outcome)}</text>
          `;
        }).join("")}
      </svg>
      <figcaption>${esc(title)}</figcaption>
    </figure>
  `;
}

function swatches() {
  const swatch = (name, hex) => `
    <div class="glance-item">
      <strong>${esc(name)}</strong>
      <span><span style="display:inline-block;width:14px;height:14px;border-radius:999px;background:${hex};margin-right:8px;vertical-align:-2px;"></span>${hex}</span>
    </div>
  `;
  const brand = reportFacts.brand;
  return `<div class="glance-grid">
    ${swatch("Primary blue", brand.blue)}
    ${swatch("Dark blue", brand.blueDark)}
    ${swatch("Sky", brand.sky)}
    ${swatch("Aqua", brand.aqua)}
    ${swatch("Green", brand.green)}
    ${swatch("Gold accent", brand.gold)}
    ${swatch("Navy", brand.navy)}
    ${swatch("Ink", brand.black)}
  </div>`;
}

function buildSections({ screenshots, generatedOn }) {
  const rideOptionRows = reportFacts.rideOptions.map((option) => [
    esc(option.name),
    esc(option.riderCapacity),
    esc(option.baseFare),
    esc(option.bookingFee),
    esc(option.minFare),
    esc(option.perKm),
    esc(option.perMinute),
    esc(option.waiting),
    esc(option.commission),
  ]);

  return [
    {
      id: "executive-summary",
      title: "1. Executive Summary",
      summary: "MOOVU is a multi-sided ride-hailing platform built around township and local-community transport. It combines a customer booking experience, a driver operations system, and an admin control center that govern booking, dispatch, payments, subscriptions, receipts, OTP verification, and operations.",
      body: `
        <div class="card soft">
          <div class="kicker">MOOVU at a glance</div>
          <div class="glance-grid" style="margin-top:14px">
            <div class="glance-item"><strong>Product type</strong><span>Ride-hailing operations platform</span></div>
            <div class="glance-item"><strong>Main users</strong><span>Customers, drivers, administrators</span></div>
            <div class="glance-item"><strong>Primary market</strong><span>${esc(reportFacts.marketFocus)}</span></div>
            <div class="glance-item"><strong>Core services</strong><span>Booking, dispatch, OTP, receipts, subscriptions</span></div>
            <div class="glance-item"><strong>Ride categories</strong><span>MOOVU Go and MOOVU Go XL</span></div>
            <div class="glance-item"><strong>Driver pricing</strong><span>Subscription plus commission governance</span></div>
            <div class="glance-item"><strong>Technology base</strong><span>${esc(reportFacts.technologies.slice(0, 4).join(", "))}</span></div>
            <div class="glance-item"><strong>Operational model</strong><span>Admin-reviewed, locally managed transport network</span></div>
          </div>
        </div>
        <div class="two-col" style="margin-top:16px">
          <div class="card">
            <p>MOOVU is more than a simple booking website. The customer side creates and tracks trips, the driver side controls readiness and trip execution, and the admin side supervises operations, onboarding, finance, and exceptions. That combination makes MOOVU a full service operations platform rather than a single-view application.</p>
            <p>The business model combines customer fares, driver subscriptions, commission controls, cancellation and no-show handling, proof-of-payment reviews, and receipt records. The product is designed for real-world local transport operations rather than a demonstration booking form.</p>
          </div>
          <div>
            ${screenshots.home ? screenshotFigure(screenshots.home, "Customer-facing MOOVU landing screen showing the app-style entry experience.", "small") : ""}
          </div>
        </div>
      `,
    },
    {
      id: "brand-identity",
      title: "2. MOOVU Brand and Product Identity",
      summary: "The live application uses a blue-led palette, strong white surfaces, aqua and sky accents, and a taxi-branded MOOVU mark. The brand language emphasizes trust, local reliability, clarity, and smartphone-first usability.",
      body: `
        <div class="two-col">
          <div class="card">
            <div class="kicker">Brand palette</div>
            ${swatches()}
            <p style="margin-top:14px">The platform consistently uses a cool blue primary, clean white cards, soft sky backgrounds, and aqua support accents. This creates a branded look that feels premium while remaining practical for daily use in customer, driver, and admin surfaces.</p>
          </div>
          <div class="card">
            <div class="kicker">Brand assets</div>
            <div class="three-col" style="margin-top:14px;align-items:center">
              <img src="${esc(screenshots.logoMain)}" alt="MOOVU logo" style="width:100%;border-radius:18px;background:#fff;padding:10px;border:1px solid #d7e2ea;" />
              <img src="${esc(screenshots.logoBlack)}" alt="MOOVU dark logo" style="width:100%;border-radius:18px;background:#f8fbff;padding:10px;border:1px solid #d7e2ea;" />
              <img src="${esc(screenshots.logoWhite)}" alt="MOOVU light logo" style="width:100%;border-radius:18px;background:#0f172a;padding:10px;border:1px solid #d7e2ea;" />
            </div>
            <p style="margin-top:14px">The visual identity carries taxi symbolism, locality, and directness. It is positioned as a serious transport utility rather than a decorative consumer lifestyle brand.</p>
          </div>
        </div>
      `,
    },
    {
      id: "what-moovu-is",
      title: "3. What MOOVU Is",
      summary: "MOOVU is a ride-hailing and operations platform that coordinates customers, drivers, subscriptions, dispatch, finance and oversight in one system.",
      body: `
        <div class="card">
          <p><strong>Public definition:</strong> MOOVU is a local ride-booking platform that lets people request safe nearby transport, track a driver, verify the trip with OTP, and receive a clear receipt afterward.</p>
          <p><strong>Business definition:</strong> MOOVU is a managed transport marketplace where the business controls who can operate, how drivers pay subscriptions and commission, and how trips, receipts, and support cases are supervised.</p>
          <p><strong>Technical definition:</strong> MOOVU is a multi-surface web and mobile-ready system built on Next.js, Supabase, Google Maps, Firebase messaging, and Capacitor. It combines customer booking, driver readiness, admin oversight, push notifications, storage-backed uploads, and finance workflows.</p>
          ${list([
            "Ride-hailing platform: customers request rides and drivers complete them.",
            "Booking system: customer input becomes a structured trip record.",
            "Driver-management system: onboarding, subscriptions, readiness, GPS and earnings are managed.",
            "Dispatch platform: eligible drivers are scored and offered trips in timed cycles.",
            "Subscription platform: drivers pay daily, weekly, or monthly access fees.",
            "Commission and settlement platform: completed trips create commission due and admin-reviewed settlements.",
            "Operations control system: admin users supervise trips, applications, receipts, dispatch and payments.",
            "Multi-sided marketplace: customers, drivers and MOOVU operations interact through one system.",
          ])}
        </div>
      `,
    },
    {
      id: "problem-market",
      title: "4. Problem and Market Context",
      summary: "MOOVU is designed for local township and peri-urban transport conditions where dependable short-distance movement, safety confidence, operational oversight, and practical cash-friendly ride management matter.",
      body: `
        <div class="two-col">
          <div class="card">
            <p>For customers, the core problem is simple: transport must be requestable, visible, and safe enough to trust. MOOVU answers that with live driver matching, clear fare display, driver identity visibility, OTP-protected start and completion, receipts, and support surfaces.</p>
            <p>For drivers, the problem is different: they need a controlled route into earning, predictable operating rules, visibility into commission owed, a clear subscription system, and a trip flow that protects them against ambiguous starts and ends. MOOVU addresses those needs with onboarding review, readiness checks, OTP validation, earnings summaries, and wallet-based commission tracking.</p>
          </div>
          <div class="diagram-grid">
            ${flowDiagram("Problem to solution map", [
              "Unstructured ride requests",
              "MOOVU booking record",
              "Verified driver dispatch",
              "OTP-secured trip",
              "Receipt and reporting",
            ])}
          </div>
        </div>
      `,
    },
    {
      id: "business-model",
      title: "5. MOOVU Business Model",
      summary: "MOOVU earns from customer trip pricing, driver subscriptions, and trip commission. Finance is mediated through admin-reviewed proof-of-payment flows and auditable wallet or receipt records.",
      body: `
        <div class="two-col">
          <div class="card">
            ${table(
              ["Income channel", "How it works", "Operational note"],
              [
                ["Customer fares", "Customers see an estimate at booking and a final trip amount after completion logic finalizes the trip.", "Finalization allows fare adjustment after actual route conditions."],
                ["Driver subscriptions", "Drivers select daily, weekly, or monthly access and upload proof of payment.", "Admin approval activates the selected plan."],
                ["Trip commission", "Completed trips create MOOVU commission due against the driver wallet.", "Drivers are blocked from going online when due exceeds R100."],
                ["Cancellation and no-show fees", "Applicable fees are recorded separately from normal trip commission.", "Fee splits are fixed between driver and MOOVU."],
              ],
            )}
            <div class="callout warning" style="margin-top:14px">
              <strong>Business rule requiring confirmation:</strong>
              the codebase contains both a legacy fallback commission constant of 9.5% and ride-option commission rules of 10% for MOOVU Go and 12% for MOOVU Go XL. The report treats that as a confirmed mismatch rather than a hidden assumption.
            </div>
          </div>
          <div class="diagram-grid">
            ${flowDiagram("MOOVU money flow", [
              "Customer fare",
              "Trip finalization",
              "Driver net earnings",
              "Commission wallet due",
              "Admin-reviewed settlement",
            ], "#16a34a")}
          </div>
        </div>
      `,
    },
    {
      id: "users-roles",
      title: "6. Platform Users and Roles",
      summary: "MOOVU separates public, customer, driver, and admin activity through role-specific pages, account linking, and server-validated access control.",
      body: `
        <div class="card landscape-page">
          ${table(["Role", "Primary permission", "Restriction"], roles.map((row) => row.map((cell) => esc(cell))))}
          <p style="margin-top:14px">Admin permissions are not free-form. They are resolved from the profile role set accepted by the application: owner, admin, dispatcher and support. Driver ownership is not inferred from client claims; it is resolved through an explicit driver account link table.</p>
        </div>
      `,
    },
    {
      id: "platform-overview",
      title: "7. MOOVU Platform Overview",
      summary: "The platform spans public web entry, customer and driver route domains, an admin control system, native shells, server APIs, Supabase, Google Maps and Firebase-backed notification delivery.",
      body: `
        ${stackDiagram("MOOVU platform architecture", [
          { title: "Public and web surfaces", blocks: [
            { title: "Public landing", detail: "Customer entry" },
            { title: "Customer application", detail: "Booking and trip tracking" },
            { title: "Driver application", detail: "Onboarding and trip execution" },
            { title: "Admin operations", detail: "Trips, finance and review" },
          ]},
          { title: "MOOVU backend", accent: "#2bb5a0", blocks: [
            { title: "Customer services", detail: "Booking, tracking, rating" },
            { title: "Driver services", detail: "Offers, OTP, completion" },
            { title: "Admin services", detail: "Review, reporting, dispatch" },
            { title: "Notification and finance", detail: "Push, wallet, receipts" },
          ]},
          { title: "Platform dependencies", accent: "#16a34a", blocks: [
            { title: "Supabase", detail: "Auth, DB, storage" },
            { title: "Google Maps", detail: "Distance, geocode, routing" },
            { title: "Firebase / web push", detail: "Device notifications" },
            { title: "Capacitor shells", detail: "Android and iOS packaging" },
          ]},
        ])}
        <div class="two-col" style="margin-top:16px">
          <div class="card">
            <p>Customer, driver and admin traffic can be partitioned by route and by host. Middleware rewrites admin and driver subdomains into the relevant application path. That means the system can present separate branded portals while sharing one application backend.</p>
          </div>
          <div class="card">
            <p>The customer iOS shell uses the customer bundle identifier and the driver iOS shell uses the driver bundle identifier. Each shell points to its own route domain. The Android and iOS shells are packaging layers on top of the same web application logic.</p>
          </div>
        </div>
      `,
    },
    {
      id: "customer-journey",
      title: "8. Complete Customer Journey",
      summary: "The customer lifecycle begins with account access and location setup, moves through fare estimation and driver search, and ends with OTP-protected completion, receipt access, and rating.",
      body: `
        ${flowDiagram("Customer journey", [
          "Open MOOVU",
          "Sign in or create account",
          "Choose pickup and destination",
          "Select ride type",
          "Confirm ride",
          "Track driver",
          "Verify OTP",
          "Receive receipt",
        ])}
        <div class="two-col" style="margin-top:16px">
          <div class="card">
            <p>The customer can request the current location, paste or search locations, adjust pickup on a map, add up to two stops, and choose MOOVU Go or MOOVU Go XL. Pricing is shown before booking and recalculated server-side so the backend does not trust client fare input.</p>
            <p>After a driver accepts, the customer sees assigned-driver information, trip status changes, OTP state, chat access, and final actions such as receipt and rating. Account deletion and legal surfaces are also part of the live customer experience.</p>
          </div>
          <div>
            ${screenshots.customerAuth ? screenshotFigure(screenshots.customerAuth, "Customer authentication surface used before booking when no active session exists.", "small") : ""}
          </div>
        </div>
      `,
    },
    {
      id: "customer-screen-catalogue",
      title: "9. Customer Screen Catalogue",
      summary: "Customer screens cover public entry, authentication, booking, active ride handling, account management and legal support.",
      body: `
        <div class="two-col">
          <div class="card landscape-page">
            ${table(["Customer screen", "Purpose", "Primary access"], customerScreens.map((row) => row.map((cell) => esc(cell))))}
          </div>
          <div class="diagram-grid">
            ${screenshots.home ? screenshotFigure(screenshots.home, "Customer landing page with app-style booking entry and trust panels.", "small") : ""}
            ${screenshots.customerAuth ? screenshotFigure(screenshots.customerAuth, "Customer account creation and sign-in surface.", "small") : ""}
          </div>
        </div>
      `,
    },
    {
      id: "driver-onboarding",
      title: "10. Driver Onboarding Journey",
      summary: "Driver onboarding is a guided multi-step process that captures eligibility, account details, identity data, document requirements, vehicle details, and review submission.",
      body: `
        ${flowDiagram("Driver onboarding", [
          "Eligibility",
          "Account",
          "Personal details",
          "Documents",
          "Vehicle details",
          "Photos",
          "Review and submit",
        ])}
        <div class="two-col" style="margin-top:16px">
          <div class="card">
            <p>The onboarding surface intentionally separates required documents from optional or later-stage operational documents. A driver can submit while PDP or PrDP is still pending because the current business rule tracks the status without making it an unconditional application blocker.</p>
            <p>Vehicle and identity validation are already opinionated. The application enforces basic format checks for items such as South African ID number, VIN, engine number, seating capacity, and vehicle registration structure.</p>
          </div>
          <div>
            ${screenshots.driverApply ? screenshotFigure(screenshots.driverApply, "Driver onboarding application with readiness tracking and step-based flow.", "small") : ""}
          </div>
        </div>
      `,
    },
    {
      id: "driver-documents",
      title: "11. Driver Documents",
      summary: "MOOVU models driver identity, licence, compliance, and vehicle records as private reviewed documents with operational consequences for readiness and trust.",
      body: `
        <div class="card landscape-page">
          ${table(
            ["Document", "Why it exists", "Required now", "Review effect"],
            [
              ["SA ID or passport", "Identity verification and account legitimacy", "Yes", "Required to verify the driver applicant"],
              ["Driver licence", "Driving eligibility", "Yes", "Required to operate"],
              ["Proof of residence", "Local compliance and contact confidence", "Yes", "Required for onboarding review"],
              ["Profile photo", "Rider-facing trust and identity", "Yes", "Supports driver trust display"],
              ["PDP / PrDP", "Professional transport readiness", "Tracked, not always blocking", "May be requested before full operations"],
              ["Vehicle registration", "Vehicle ownership and lawful operation", "Yes", "Vehicle validation"],
              ["Licence disc", "Road legality", "Yes", "Vehicle validation"],
              ["Roadworthy certificate", "Operational safety confidence", "Yes", "Vehicle validation"],
              ["Vehicle insurance", "Risk and compliance context", "Optional where available", "Improves operational confidence"],
              ["Vehicle photos", "Physical vehicle review and rider trust", "Expected", "Visual verification"],
              ["Police clearance", "Optional safety strengthening", "Optional", "Enhanced safety review when present"],
              ["Transport permit", "Optional commercial operation support", "Optional", "Context-dependent"],
            ],
          )}
        </div>
      `,
    },
    {
      id: "driver-eligibility",
      title: "12. Driver Eligibility",
      summary: "Receiving trips is contingent on account approval, subscription status, commission balance, live GPS, availability, and ride-capacity compatibility.",
      body: `
        ${decisionDiagram("Driver eligibility decision path", "Can this driver receive a trip?", [
          { title: "Account and review state", detail: "Approved, active, verified and profile-complete", outcome: "Must pass", ok: true },
          { title: "Commercial readiness", detail: "Subscription active and balance due below R100", outcome: "Must pass", ok: true },
          { title: "Live trip readiness", detail: "Online, not busy, GPS fresh and not already offered", outcome: "Must pass", ok: true },
          { title: "Vehicle fit", detail: "Ride-option capacity must match seating rule", outcome: "Mismatch blocks dispatch", ok: false },
        ])}
        <div class="card" style="margin-top:16px">
          <p>Vehicle capacity logic currently contains a naming mismatch. Operationally, the fare system presents MOOVU Go XL, while the seating-capacity helper still refers to Go Plus for seven-seat review paths. The eligibility rule itself is still clear: the larger ride category requires higher capacity and may require admin review depending on the vehicle record.</p>
        </div>
      `,
    },
    {
      id: "driver-subscriptions",
      title: "13. Driver Subscription System",
      summary: "Drivers pay one of three subscription plans, upload proof of payment, wait for admin approval, then receive activated operating access according to the selected duration.",
      body: `
        <div class="two-col">
          <div class="card">
            ${table(
              ["Plan", "Amount", "Duration"],
              reportFacts.subscriptions.map((item) => [esc(item.plan), esc(item.amount), esc(item.duration)]),
            )}
            <p style="margin-top:14px">Subscription approval is not automatic. The driver submits a payment request, an admin reviews the proof of payment, and only then does the driver record update to active status with the correct expiry window. That keeps plan activation tied to reviewed proof rather than a client-side claim.</p>
          </div>
          <div class="diagram-grid">
            ${flowDiagram("Subscription lifecycle", [
              "Select plan",
              "Upload proof",
              "Pending review",
              "Admin approval",
              "Plan activated",
              "Expiry and renewal",
            ], "#16a34a")}
          </div>
        </div>
      `,
    },
    {
      id: "driver-operations",
      title: "14. Driver Application and Operations",
      summary: "After approval, a driver uses the portal to go online, receive trip offers, reach pickup, verify start OTP, navigate, complete the trip with end OTP, and review earnings and balances.",
      body: `
        ${flowDiagram("Driver operational journey", [
          "Log in",
          "Check readiness",
          "Go online",
          "Receive offer",
          "Reach pickup",
          "Start OTP",
          "Complete trip",
          "Review earnings",
        ])}
        <div class="two-col" style="margin-top:16px">
          <div class="card">
            <p>The driver portal is both an operational cockpit and a compliance gate. Online state depends on subscription validity, commission balance, and location freshness. Trip actions are then constrained again by arrival radius, OTP rules, minimum trip duration, and destination-area completion tolerance.</p>
          </div>
          <div>
            ${screenshots.driverLogin ? screenshotFigure(screenshots.driverLogin, "Driver sign-in surface for the operational portal.", "small") : ""}
          </div>
        </div>
      `,
    },
    {
      id: "driver-screen-catalogue",
      title: "15. Driver Screen Catalogue",
      summary: "Driver-facing screens cover onboarding, live operations, history, earnings, subscriptions, commission payments, support, account control and deletion.",
      body: `
        <div class="two-col">
          <div class="card landscape-page">
            ${table(["Driver screen", "Purpose", "Primary user"], driverScreens.map((row) => row.map((cell) => esc(cell))))}
          </div>
          <div class="card">
            <p>Not every driver surface is publicly screenshot-safe, because some pages depend on active linked driver identities or financial records. Where real authenticated content is not safely includable, this report treats the screen catalogue as a factual operational inventory rather than a visual mockup.</p>
          </div>
        </div>
      `,
    },
    {
      id: "admin-ops-overview",
      title: "16. Admin Operations Overview",
      summary: "MOOVU administrators supervise the platform operationally: onboarding, trip oversight, dispatch, payment review, subscriptions, commissions, receipts and reporting all pass through the admin surface.",
      body: `
        ${flowDiagram("Typical admin day", [
          "Review readiness",
          "Watch applications",
          "Monitor trips",
          "Review payments",
          "Resolve issues",
          "Close with reporting",
        ])}
        <div class="card" style="margin-top:16px">
          <p>The admin role is not only a back-office reporting view. It is a live operational control surface with trip visibility, dispatch context, driver review, receipt access, and payment approvals that immediately affect eligibility and driver platform access.</p>
        </div>
      `,
    },
    {
      id: "admin-screen-catalogue",
      title: "17. Admin Screen Catalogue",
      summary: "Admin screens span operations, customers, drivers, payments, reports and system notifications. The navigation structure itself reflects MOOVU's business operations model.",
      body: `
        <div class="two-col">
          <div class="card landscape-page">
            ${table(["Admin screen", "Purpose", "Primary user"], adminScreens.map((row) => row.map((cell) => esc(cell))))}
          </div>
          <div class="diagram-grid">
            ${screenshots.adminLogin ? screenshotFigure(screenshots.adminLogin, "Admin sign-in screen for operations access.", "small") : ""}
          </div>
        </div>
      `,
    },
    {
      id: "trip-lifecycle",
      title: "18. Complete Trip Lifecycle",
      summary: "Trips move through explicit lifecycle states, with audit events, offer state, OTP milestones, fare finalization and completion records.",
      body: `
        ${flowDiagram("Trip status lifecycle", [
          "Scheduled or requested",
          "Offered",
          "Assigned",
          "Arrived",
          "Ongoing",
          "Completed or cancelled",
        ])}
        <div class="card" style="margin-top:16px">
          ${table(
            ["Status", "Meaning"],
            [
              ["scheduled", "Trip is booked for future release."],
              ["requested", "Immediate trip created and ready for dispatch."],
              ["offered", "Trip offer is active in the dispatch process."],
              ["assigned", "A driver has accepted the trip."],
              ["arrived", "Driver has reached pickup."],
              ["ongoing", "Trip has started after OTP verification."],
              ["completed", "Trip has ended and fare is finalized."],
              ["cancelled", "Trip ended without successful completion."],
            ],
          )}
        </div>
      `,
    },
    {
      id: "dispatch-matching",
      title: "19. Driver Dispatch and Matching",
      summary: "Dispatch is a scored, eligibility-aware, time-boxed candidate search that uses explicit driver filters, radius logic, and an atomic acceptance process to prevent duplicate assignment.",
      body: `
        <div class="diagram-grid">
          ${flowDiagram("Dispatch candidate selection", [
            "Trip requested",
            "Find online drivers",
            "Apply readiness filters",
            "Score distance and quality",
            "Create offer group",
            "Wait for acceptance",
          ])}
          ${laneDiagram("Atomic offer acceptance", [
            { label: "Driver A", steps: ["Accepts", "RPC checks", "Wins or loses"] },
            { label: "Driver B", steps: ["Accepts", "RPC checks", "Wins or loses"] },
            { label: "Trip record", steps: ["Pending offer", "Single assignment", "Other offers withdrawn"] },
          ])}
        </div>
        <div class="two-col" style="margin-top:16px">
          <div class="card">
            ${table(
              ["Dispatch setting", "Current implementation"],
              [
                ["Offer window", esc(reportFacts.dispatch.acceptWindow)],
                ["Escalation cadence", esc(reportFacts.dispatch.escalation)],
                ["Initial radius", esc(reportFacts.dispatch.initialRadius)],
                ["Expanded radius", esc(reportFacts.dispatch.expandedRadius)],
                ["Maximum cycles", esc(reportFacts.dispatch.maxCycles)],
                ["Maximum search time", esc(reportFacts.dispatch.maxSearch)],
                ["GPS freshness", esc(reportFacts.dispatch.gpsFreshness)],
              ],
            )}
          </div>
          <div class="card">
            <p>Candidate ranking is not distance-only. The selection code combines distance, driver quality, acceptance behaviour, recent offer rotation and missed-offer penalties, then filters out busy, stale, declined, ineligible or already-offered drivers. That gives MOOVU an operationally rational dispatch basis rather than a naive nearest-only search.</p>
          </div>
        </div>
      `,
    },
    {
      id: "fare-pricing",
      title: "20. Fare and Pricing System",
      summary: "Fare calculation is centralized around ride-option rules, booking fee, distance, duration, surge, waiting, stop logic, minimum fare and final-trip adjustment.",
      body: `
        <div class="card landscape-page">
          ${table(
            ["Ride option", "Capacity", "Base fare", "Booking fee", "Minimum", "Per km", "Per minute", "Waiting", "Commission"],
            rideOptionRows,
          )}
          <p style="margin-top:14px">Distance-tier discounts are applied after surge and before minimum fare rounding. Stops are capped at two and use a discounted add-stop increase model instead of a full raw route increase. Final customer price is recalculated at completion so the last known trip route and any stop adjustments can influence the final fare.</p>
        </div>
        <div class="diagram-grid" style="margin-top:16px">
          ${flowDiagram("Fare calculation pipeline", [
            "Base fare and booking fee",
            "Distance and duration",
            "Surge multiplier",
            "Distance discount",
            "Stops and waiting",
            "Minimum fare",
            "Rounded total",
          ])}
        </div>
      `,
    },
    {
      id: "maps-location",
      title: "21. Maps and Live Location",
      summary: "MOOVU combines customer location selection, Google Maps geocoding and routing, and driver heartbeat updates to drive booking, dispatch, route display and completion checks.",
      body: `
        ${stackDiagram("Map and location data flow", [
          { title: "Customer location inputs", blocks: [
            { title: "Typed search", detail: "Autocomplete and paste parsing" },
            { title: "Current location", detail: "Browser or native geolocation" },
            { title: "Map pin adjustment", detail: "Pickup and destination refinement" },
          ]},
          { title: "Route services", accent: "#1f74c9", blocks: [
            { title: "Geocoding", detail: "Address to coordinates" },
            { title: "Directions and matrix", detail: "Distance and duration" },
            { title: "Route summary", detail: "Fare and ETA inputs" },
          ]},
          { title: "Driver telemetry", accent: "#16a34a", blocks: [
            { title: "Live heartbeat", detail: "Driver coordinates and freshness" },
            { title: "Dispatch fit", detail: "Nearby eligible drivers" },
            { title: "Trip action guard", detail: "Arrival and completion radius" },
          ]},
        ])}
      `,
    },
    {
      id: "otp-security",
      title: "22. OTP and Trip Security",
      summary: "Start and end OTP checkpoints give MOOVU a practical trip-security layer that aligns start, trip progression and completion with explicit rider validation.",
      body: `
        <div class="diagram-grid">
          ${laneDiagram("Trip start OTP sequence", [
            { label: "Customer", steps: ["Receives start OTP", "Shares code at pickup"] },
            { label: "Driver", steps: ["Enters OTP", "Trip may start"] },
            { label: "Server", steps: ["Checks assigned trip", "Marks OTP verified"] },
          ])}
          ${laneDiagram("Trip end OTP sequence", [
            { label: "Customer", steps: ["Provides end OTP", "Confirms end"] },
            { label: "Driver", steps: ["Enters OTP", "Requests completion"] },
            { label: "Server", steps: ["Validates OTP and trip duration", "Finalizes trip"] },
          ])}
        </div>
        <div class="card" style="margin-top:16px">
          <p>The security model also includes start-state checks, minimum trip duration logic, completion distance tolerance, and explicit admin or bypass handling. That means OTP is not a decoration; it is wired into trip-state control and audit history.</p>
        </div>
      `,
    },
    {
      id: "notifications-realtime",
      title: "23. Notifications and Realtime Updates",
      summary: "MOOVU stores push delivery targets across web, Android and iOS, sends server-side visible notifications through Firebase or Web Push, and routes users back into the correct portal.",
      body: `
        ${stackDiagram("Notification routing", [
          { title: "Event producers", blocks: [
            { title: "Trip events", detail: "Offer, accept, arrive, complete" },
            { title: "Chat messages", detail: "Trip-linked conversation" },
            { title: "Finance reviews", detail: "Subscription and commission updates" },
          ]},
          { title: "Notification infrastructure", accent: "#1f74c9", blocks: [
            { title: "FCM token registry", detail: "Android, iOS, web" },
            { title: "Legacy web push", detail: "Browser subscription fallback" },
            { title: "Routing data", detail: "Deep links and native action tokens" },
          ]},
          { title: "Destination apps", accent: "#16a34a", blocks: [
            { title: "Customer", detail: "Ride and booking pages" },
            { title: "Driver", detail: "Offer and trip pages" },
            { title: "Admin", detail: "Trip and payment review pages" },
          ]},
        ])}
        <div class="card" style="margin-top:16px">
          ${table(["Event", "Customer", "Driver", "Admin", "Delivery", "Destination"], notificationMatrix.map((row) => row.map((cell) => esc(cell))))}
        </div>
      `,
    },
    {
      id: "earnings-commission",
      title: "24. Driver Earnings and MOOVU Commission",
      summary: "Completed trips generate gross fare, driver net, and MOOVU commission entries that flow into the wallet and settlement system.",
      body: `
        ${flowDiagram("Commission and driver net flow", [
          "Trip completed",
          "Fare finalized",
          "Commission calculated",
          "Driver net stored",
          "Wallet balance updated",
          "Settlement reviewed",
        ], "#16a34a")}
        <div class="card" style="margin-top:16px">
          <p>Wallet state is not cosmetic. It directly affects whether a driver can continue going online. The threshold is currently R100 due, after which the driver may still log in and submit payment but is restricted from taking more trips until settlement reduces the balance.</p>
        </div>
      `,
    },
    {
      id: "payments-subscriptions-reviews",
      title: "25. Payments and Subscription Reviews",
      summary: "Driver payments are proof-based, typed as subscription, commission or combined, and require admin review before they affect subscription state or commission balance.",
      body: `
        ${laneDiagram("Payment review sequence", [
          { label: "Driver", steps: ["Select payment type", "Upload POP", "Submit request"] },
          { label: "Server", steps: ["Store request", "Notify admins", "Await review"] },
          { label: "Admin", steps: ["Open payment review", "Approve / reject", "Update driver state"] },
          { label: "Driver", steps: ["Receive review result", "View payment receipt"] },
        ])}
      `,
    },
    {
      id: "receipts-records",
      title: "26. Receipts and Records",
      summary: "Receipts are customer-facing trip records and admin-visible financial evidence surfaces. The platform also preserves structured trip and payment history for audit and support.",
      body: `
        ${flowDiagram("Receipt anatomy", [
          "Trip identity",
          "Customer and driver details",
          "Pickup and destination",
          "Fare and payment fields",
          "Receipt date",
          "Print or view access",
        ])}
      `,
    },
    {
      id: "auth-access-control",
      title: "27. Authentication and Access Control",
      summary: "MOOVU uses Supabase authentication, customer or driver profile linking, admin role checks, protected routes and account deletion flows to keep each portal bounded.",
      body: `
        <div class="card landscape-page">
          ${table(
            ["Access surface", "Auth mechanism", "Role or ownership check"],
            [
              ["Customer", "Supabase session and bearer token", "Customer record linked by auth user"],
              ["Driver", "Supabase session and bearer token", "Driver account maps auth user to driver ID"],
              ["Admin", "Supabase session and bearer token", "Profiles role must be one of accepted admin roles"],
              ["Account deletion", "Password re-verification and DELETE confirmation", "Blocks active trip deletion"],
            ],
          )}
        </div>
      `,
    },
    {
      id: "information-model",
      title: "28. MOOVU Information Model",
      summary: "The MOOVU database is not just a storage layer. It is a direct model of customers, drivers, trips, offers, subscriptions, wallet state, payments, receipts and notification routes.",
      body: `
        ${stackDiagram("Simplified information model", [
          { title: "Identity and roles", blocks: [
            { title: "Profiles", detail: "Admin roles" },
            { title: "Customers", detail: "Rider accounts" },
            { title: "Driver accounts", detail: "Auth to driver map" },
            { title: "Drivers", detail: "Operational driver record" },
          ]},
          { title: "Trips and execution", accent: "#1f74c9", blocks: [
            { title: "Trips", detail: "Core booking record" },
            { title: "Trip events", detail: "Audit trail" },
            { title: "Driver trip offers", detail: "Dispatch state" },
            { title: "Trip messages", detail: "Accepted-trip chat" },
          ]},
          { title: "Finance and control", accent: "#16a34a", blocks: [
            { title: "Wallets", detail: "Commission due" },
            { title: "Settlements", detail: "Driver payments to MOOVU" },
            { title: "Subscription payments", detail: "Approved plan payments" },
            { title: "FCM tokens", detail: "Push delivery targets" },
          ]},
        ])}
        <div class="card" style="margin-top:16px">
          ${table(["Entity", "Represents", "Workflow dependency"], entities.map((row) => row.map((cell) => esc(cell))))}
        </div>
      `,
    },
    {
      id: "api-capabilities",
      title: "29. API Capability Catalogue",
      summary: "Business capabilities are implemented as customer, driver, admin, maps, notification and supporting server routes. Each capability is validated server-side rather than trusting client intent.",
      body: `
        <div class="card landscape-page">
          ${table(
            ["Business area", "Capabilities"],
            [
              ["Customer", "Register, authenticate, create trip, estimate route, track trip, cancel trip, add stop, rate trip, view history, view receipt, delete account, register notifications"],
              ["Driver", "Apply, upload documents, update location, go online, receive offers, accept or decline, mark arrived, start trip, complete trip, view history, view earnings, submit payment, view subscription, view commission, delete account"],
              ["Admin", "Authenticate, review applications, inspect documents, monitor trips, dispatch or re-offer, review payments, manage subscriptions, view receipts, manage reports and notifications"],
            ],
          )}
        </div>
      `,
    },
    {
      id: "applications-work-together",
      title: "30. How the Applications Work Together",
      summary: "Customer, server, database, dispatch, notifications, driver and admin logic are synchronized through explicit server-side mutations and event-driven messaging.",
      body: `
        <div class="diagram-grid">
          ${laneDiagram("Customer creates booking", [
            { label: "Customer app", steps: ["Submit booking", "Wait for result"] },
            { label: "MOOVU server", steps: ["Validate and calculate", "Create trip", "Trigger dispatch"] },
            { label: "Database", steps: ["Persist trip", "Persist trip events"] },
            { label: "Notifications", steps: ["Notify customer", "Notify admins"] },
          ])}
          ${laneDiagram("Driver accepts booking", [
            { label: "Driver app", steps: ["Receive offer", "Accept offer"] },
            { label: "Server", steps: ["Run atomic RPC", "Assign driver"] },
            { label: "Database", steps: ["Update trip", "Cancel losing offers"] },
            { label: "Notifications", steps: ["Notify customer", "Notify admins"] },
          ])}
        </div>
      `,
    },
    {
      id: "safety-trust",
      title: "31. Safety and Trust",
      summary: "MOOVU's trust model is built from approval, documentation, OTP checkpoints, visibility, audit trails, support and controlled operator readiness rather than a single isolated safety feature.",
      body: `
        <div class="card">
          ${list([
            "Driver approval before operational access",
            "Document review and vehicle evidence",
            "Driver and vehicle identity surfaces",
            "Start OTP and end OTP",
            "Trip event audit trail",
            "Admin visibility into lifecycle and payments",
            "Customer-driver chat after driver acceptance",
            "Location-based trip execution rules",
            "Account deletion and legal support surfaces",
          ])}
        </div>
      `,
    },
    {
      id: "support-exceptions",
      title: "32. Support and Exception Handling",
      summary: "The platform explicitly handles declines, no-driver outcomes, invalid OTP, expired subscriptions, payment rejection, GPS loss, active-trip restrictions and notification-denied states.",
      body: `
        <div class="card landscape-page">
          ${table(
            ["Scenario", "System response"],
            [
              ["No drivers available", "Trip remains unassigned and dispatch cycles continue until search is exhausted or trip is cancelled."],
              ["Driver declines", "Next dispatch attempt is triggered and decline is recorded."],
              ["Driver ignores offer", "Offer expires and the cycle can progress."],
              ["Invalid OTP", "Start or completion action is rejected."],
              ["Driver loses GPS freshness", "Eligibility or trip guard can fail until heartbeat recovers."],
              ["Expired subscription", "Driver cannot operate until plan is active again."],
              ["Excessive commission due", "Driver cannot go online while balance due is at or above threshold."],
              ["Failed payment upload", "Driver payment request is rejected before submission."],
              ["Notification permission denied", "In-app flow continues, but push delivery is unavailable."],
            ],
          )}
        </div>
      `,
    },
    {
      id: "product-differentiators",
      title: "33. Product Differentiators",
      summary: "MOOVU's strongest product differentiators are operational, local and commercially structural rather than cosmetic.",
      body: `
        <div class="card">
          ${list([
            "Township and local-community route focus instead of generic nationwide framing.",
            "Subscription plus commission model for drivers.",
            "OTP at both trip start and trip completion.",
            "Admin-reviewed payment-proof operations rather than blind client claims.",
            "Locally managed driver onboarding with document and vehicle emphasis.",
            "Operations-centered admin portal rather than a minimal report-only back office.",
          ])}
        </div>
      `,
    },
    {
      id: "maturity-scorecard",
      title: "34. Feature Maturity Scorecard",
      summary: "The scorecard below reflects implementation completeness, not commercial scale or market traction.",
      body: `
        <div class="card">
          ${maturity.map(([label, score, note]) => `
            <div class="maturity-row">
              <strong>${esc(label)}</strong>
              <div class="maturity-bar"><span style="width:${Number(score) * 20}%"></span></div>
              <span style="font-size:11px;color:#5b6776">${esc(note)}</span>
            </div>
          `).join("")}
        </div>
      `,
    },
    {
      id: "confirmed-partial-runtime",
      title: "35. Confirmed, Partial and Runtime-Dependent Capabilities",
      summary: "Some capabilities are confirmed directly from source and surrounding documentation, while others depend on environment, migration or real-device verification.",
      body: `
        <div class="three-col">
          <div class="card">
            <div class="badge confirmed">Confirmed</div>
            ${list([
              "Customer booking and fare calculation services",
              "Driver onboarding flow",
              "Admin payment review logic",
              "OTP trip controls",
              "Receipt routes",
              "Subscription pricing and approval logic",
            ])}
          </div>
          <div class="card">
            <div class="badge partial">Partial or inconsistent</div>
            ${list([
              "Commission percentage consistency",
              "Go XL versus Go Plus naming consistency",
              "Dispatch expiry timing documentation versus code",
              "Some operational tables depend on migration alignment",
            ])}
          </div>
          <div class="card">
            <div class="badge runtime">Runtime-dependent</div>
            ${list([
              "Closed-app push notification delivery",
              "Background location continuity on native devices",
              "Storage and signed URL policy behaviour in real environments",
              "Fully authenticated dashboard screenshots with real data",
            ])}
          </div>
        </div>
      `,
    },
    {
      id: "intended-vs-implemented",
      title: "36. Intended Versus Implemented Behaviour",
      summary: "The platform contains a small number of business-rule or naming mismatches that should be tracked explicitly rather than obscured.",
      body: `
        <div class="card landscape-page">
          ${table(
            ["Product area", "Intended behaviour", "Implemented behaviour", "Business effect"],
            [
              ["Commission", "Single agreed MOOVU commission rule", "9.5% fallback constant plus 10% / 12% ride-option rules", "Historical or fallback rows may diverge from current ride-option pricing"],
              ["Ride naming", "One larger ride-category name", "MOOVU Go XL in fare surfaces and Go Plus in some eligibility labels", "Terminology drift"],
              ["Dispatch expiry", "One agreed trip search timeout", "180 seconds in code, different narrative in operations notes", "Operational expectation mismatch"],
              ["Background operations", "Continuous device delivery and telemetry", "Foreground flows are implemented, but background or closed-app behaviour depends on runtime capabilities", "Requires environment validation"],
            ],
          )}
        </div>
      `,
    },
    {
      id: "operational-playbooks",
      title: "37. Operational Playbooks",
      summary: "The operating model is practical and role-driven. Each recurring operational scenario has a clear owner and result.",
      body: `
        <div class="card landscape-page">
          ${table(
            ["Playbook", "Responsible role", "Expected action"],
            operationalPlaybooks.map((row) => row.map((cell) => esc(cell))),
          )}
        </div>
      `,
    },
    {
      id: "glossary",
      title: "38. Glossary",
      summary: "These terms are central to understanding how MOOVU behaves as a product and business system.",
      body: `
        <div class="card">
          ${table(["Term", "Meaning"], glossary.map((row) => row.map((cell) => esc(cell))))}
        </div>
      `,
    },
    {
      id: "product-summary",
      title: "39. What MOOVU Currently Does",
      summary: "MOOVU currently provides a full booking-to-operations cycle that joins customer requests, driver execution and admin oversight.",
      body: `
        <div class="card">
          <p>MOOVU lets a rider create an account, request a ride, choose a ride category, see a fare estimate, wait for a driver, verify the trip through OTP, chat when a driver is assigned, and receive a receipt afterward. The same platform also lets drivers apply, be reviewed, manage subscriptions, receive offers, execute the ride, and track what they owe MOOVU or what they earned from completed trips.</p>
          <p>On the business side, MOOVU gives administrators visibility into trips, applications, payment proof, receipts, driver status, notifications, subscriptions and commission settlement. That makes the application usable not only by riders and drivers, but by the operating business that must keep the network healthy.</p>
        </div>
      `,
    },
    {
      id: "technical-summary",
      title: "40. How MOOVU Does It",
      summary: "The platform works by coordinating structured web and native-ready interfaces with server-side validation, stored records, and timed operational logic.",
      body: `
        <div class="card">
          <p>MOOVU uses structured server routes to receive trip requests, calculate prices, persist records, trigger dispatch, record trip events, and notify the correct audience. It stores customer, driver, trip, finance and notification state in Supabase, while Google Maps provides location intelligence and Firebase handles visible push notifications.</p>
          <p>Driver and admin access are protected by role and ownership checks, not by client navigation alone. That means a booking, offer acceptance, payment review or completion action is meaningful only after the server confirms the user and the relevant trip or driver relationship.</p>
        </div>
      `,
    },
    {
      id: "beginning-to-end",
      title: "41. MOOVU Explained from Beginning to End",
      summary: "The sequence below explains the whole operating system in one continuous narrative.",
      body: `
        <div class="card">
          <ol>
            <li>A customer joins MOOVU, accepts legal terms, and provides trip details.</li>
            <li>A driver applies through onboarding, including identity and vehicle information.</li>
            <li>An admin reviews the application and approves a driver for operations.</li>
            <li>The driver pays a subscription plan and waits for admin approval.</li>
            <li>The driver goes online once subscription and balance rules allow it.</li>
            <li>The customer books a ride with pickup, destination, optional stops and ride category.</li>
            <li>The server calculates the fare, creates the trip record, and starts dispatch.</li>
            <li>Dispatch searches for eligible drivers, scores them, and offers the trip.</li>
            <li>A driver accepts, the system assigns the trip atomically, and the customer is notified.</li>
            <li>The driver reaches pickup, passes the arrival rule and prepares to start the trip.</li>
            <li>The start OTP is entered so the trip can transition to ongoing.</li>
            <li>The ride proceeds, with live status, messages and route context available.</li>
            <li>Stops and actual route conditions can influence the final price before completion.</li>
            <li>The end OTP is entered, minimum duration is checked, and the trip completes.</li>
            <li>The final fare is stored, commission is applied, driver net is calculated, and receipts become available.</li>
            <li>The admin system continues to oversee payments, subscriptions, commissions and exception handling.</li>
            <li>Notifications connect all participants through the lifecycle where device and runtime support allow.</li>
          </ol>
        </div>
      `,
    },
  ];
}

function appendicesHtml() {
  return `
    <section class="appendix" id="appendix-a">
      <div class="section-head">
        <div>
          <div class="kicker">Appendix A</div>
          <h2 class="section-title">Ride Pricing Reference</h2>
        </div>
      </div>
      <div class="card">${table(["Ride option", "Key pricing"], reportFacts.rideOptions.map((item) => [esc(item.name), esc(`${item.baseFare} base, ${item.perKm}, ${item.perMinute}, ${item.minFare} minimum, ${item.waiting}`)]))}</div>
    </section>
    <section class="appendix" id="appendix-b">
      <div class="section-head"><div><div class="kicker">Appendix B</div><h2 class="section-title">Driver Eligibility Checklist</h2></div></div>
      <div class="card">${list([
        "Approved or active driver status",
        "Verified review state where applicable",
        "Profile completed",
        "Subscription active and not expired",
        "Balance due below R100 lock threshold",
        "Online and not busy",
        "GPS available and heartbeat fresh",
        "Vehicle capacity matches ride option",
        "No conflicting active trip or active offer",
        "Driver has not already declined this trip",
      ])}</div>
    </section>
    <section class="appendix" id="appendix-c">
      <div class="section-head"><div><div class="kicker">Appendix C</div><h2 class="section-title">Driver Document Checklist</h2></div></div>
      <div class="card">${table(["Document group", "Included items"], [
        ["Identity", "SA ID or passport, driver licence, profile photo, proof of residence"],
        ["Operational", "PDP / PrDP where available, police clearance where supported, transport permit where supported"],
        ["Vehicle", "Vehicle registration, licence disc, roadworthy certificate, insurance proof"],
        ["Visual evidence", "Front, back, left, right, interior and number plate photos"],
      ])}</div>
    </section>
    <section class="appendix" id="appendix-d">
      <div class="section-head"><div><div class="kicker">Appendix D</div><h2 class="section-title">Subscription Reference</h2></div></div>
      <div class="card">${table(["Plan", "Amount", "Duration"], reportFacts.subscriptions.map((row) => [esc(row.plan), esc(row.amount), esc(row.duration)]))}</div>
    </section>
    <section class="appendix" id="appendix-e">
      <div class="section-head"><div><div class="kicker">Appendix E</div><h2 class="section-title">Trip Status Reference</h2></div></div>
      <div class="card">${table(["Status", "Meaning"], [
        ["scheduled", "Future trip waiting for release window"],
        ["requested", "Current trip waiting for dispatch"],
        ["offered", "Offer in progress"],
        ["assigned", "Accepted by one driver"],
        ["arrived", "Driver has reached pickup"],
        ["ongoing", "Trip is active after start OTP"],
        ["completed", "Trip ended and final fare was applied"],
        ["cancelled", "Trip ended without completion"],
      ])}</div>
    </section>
    <section class="appendix" id="appendix-f">
      <div class="section-head"><div><div class="kicker">Appendix F</div><h2 class="section-title">Notification Event Matrix</h2></div></div>
      <div class="card">${table(["Event", "Customer", "Driver", "Admin", "Delivery", "Destination"], notificationMatrix.map((row) => row.map((cell) => esc(cell))))}</div>
    </section>
    <section class="appendix" id="appendix-g">
      <div class="section-head"><div><div class="kicker">Appendix G</div><h2 class="section-title">Role and Permission Matrix</h2></div></div>
      <div class="card">${table(["Role", "Primary permission", "Restriction"], roles.map((row) => row.map((cell) => esc(cell))))}</div>
    </section>
    <section class="appendix" id="appendix-h">
      <div class="section-head"><div><div class="kicker">Appendix H</div><h2 class="section-title">Admin Daily Operations Checklist</h2></div></div>
      <div class="card">${table(["Playbook", "Owner", "Action"], operationalPlaybooks.map((row) => row.map((cell) => esc(cell))))}</div>
    </section>
  `;
}

export function buildReportHtml({ screenshots, generatedOn }) {
  const sections = buildSections({ screenshots, generatedOn });

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${esc(reportTitle)}</title>
        <link rel="stylesheet" href="./report.css" />
      </head>
      <body>
        <div class="report-header">
          <div class="brand-row">
            <img src="${esc(screenshots.logoMain)}" alt="MOOVU" />
            <span>${esc(reportTitle)}</span>
          </div>
          <span>${esc(reportFacts.version)} • ${esc(generatedOn)}</span>
        </div>
        <div class="report-footer">
          <span class="footer-note">MOOVU • Customer • Driver • Dispatch • Operations</span>
          <span class="page-number"></span>
        </div>

        <main class="report">
          <section class="cover">
            <div class="cover-top">
              <div class="cover-chip">MOOVU internal product document</div>
              <img src="${esc(screenshots.logoWhite)}" alt="MOOVU white logo" />
            </div>
            <div class="cover-panel">
              <div>
                <h1>${esc(reportTitle)}</h1>
                <h2>${esc(reportSubtitle)}</h2>
                <div style="margin-top:18px" class="summary-chip">Customer • Driver • Dispatch • Operations</div>
                <div class="cover-card" style="margin-top:22px">
                  <h3>Purpose</h3>
                  <p>This document explains what MOOVU is, how it works, how customers, drivers and administrators use it, how rides move through the system, and how the business earns and governs transport operations.</p>
                </div>
              </div>
              <div class="cover-visual">
                <img src="${esc(screenshots.home || screenshots.goIcon)}" alt="MOOVU application preview" />
              </div>
            </div>
            <div class="cover-meta">
              <div class="cover-meta-card"><strong>Version</strong><span>${esc(reportFacts.version)}</span></div>
              <div class="cover-meta-card"><strong>Generated</strong><span>${esc(generatedOn)}</span></div>
              <div class="cover-meta-card"><strong>Audience</strong><span>Operations, investors, builders</span></div>
              <div class="cover-meta-card"><strong>Category</strong><span>${esc(reportFacts.category)}</span></div>
            </div>
          </section>

          <section class="front-matter">
            <div class="front-grid">
              <div class="card soft">
                <div class="kicker">Document information</div>
                <h2 class="section-title" style="margin-top:8px">MOOVU System Design & Product Specification</h2>
                <p>Organisation: ${esc(reportFacts.organization)}<br/>Product category: ${esc(reportFacts.category)}<br/>Version: ${esc(reportFacts.version)}<br/>Generation date: ${esc(generatedOn)}</p>
                <p>This document is intended to help management, partners, investors, designers, developers, testers, support staff and driver-onboarding staff understand the current MOOVU product and operations model.</p>
              </div>
              <div class="card">
                <div class="kicker">How to use this document</div>
                ${list([
                  "Product sections explain what each application surface does.",
                  "Business-process sections explain how money, eligibility and review flows work.",
                  "User-flow sections explain customer, driver and admin movement through the product.",
                  "Technical sections explain how the platform coordinates data, notifications and controls.",
                  "Operational sections explain how MOOVU runs as a real transport system.",
                ])}
              </div>
            </div>
          </section>

          <section class="toc">
            <div class="card">
              <div class="kicker">Table of contents</div>
              <h2 class="section-title" style="margin-top:8px">Report navigation</h2>
              <div class="toc-list">
                ${sections.map((section) => `
                  <a class="toc-item" href="#${esc(section.id)}">
                    <strong>${esc(section.title)}</strong>
                    <span>${esc(section.summary)}</span>
                  </a>
                `).join("")}
                <a class="toc-item" href="#appendix-a"><strong>Appendices A–H</strong><span>Pricing, eligibility, documents, subscriptions, status, notifications, permissions and admin checklists.</span></a>
              </div>
            </div>
          </section>

          ${sections.map((section) => `
            <section class="section" id="${esc(section.id)}">
              <div class="section-head">
                <div>
                  <div class="kicker">${esc(section.title.split(".")[0])}</div>
                  <h2 class="section-title">${esc(section.title)}</h2>
                </div>
                <div class="section-summary">${esc(section.summary)}</div>
              </div>
              ${section.body}
            </section>
          `).join("")}

          ${appendicesHtml()}
        </main>
      </body>
    </html>
  `;
}
