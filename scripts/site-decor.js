(function () {
  const relicCatalog = Object.freeze({
    sword: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/2694.svg",
    axe: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1fa93.svg",
    shield: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1f6e1.svg",
    staff: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1fa84.svg",
    dagger: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1f5e1.svg",
    crystal: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1f52e.svg"
  });

  const routeProfiles = Object.freeze({
    home: { sword: 2, axe: 1, shield: 3, staff: 5, dagger: 2, crystal: 2 },
    forums: { sword: 4, axe: 4, shield: 3, staff: 1, dagger: 2, crystal: 1 },
    stories: { sword: 2, axe: 1, shield: 1, staff: 5, dagger: 3, crystal: 4 },
    roster: { sword: 4, axe: 3, shield: 4, staff: 1, dagger: 2, crystal: 1 },
    discord: { sword: 2, axe: 2, shield: 2, staff: 2, dagger: 3, crystal: 2 },
    eqlInformation: { sword: 1, axe: 1, shield: 1, staff: 4, dagger: 3, crystal: 5 },
    login: { sword: 1, axe: 1, shield: 2, staff: 4, dagger: 2, crystal: 3 },
    default: { sword: 2, axe: 2, shield: 2, staff: 2, dagger: 2, crystal: 2 }
  });
  // Route zones mirror iconic Norrath locations to give each section a distinct EverQuest mood.
  const routeZones = Object.freeze({
    home: "qeynos",
    forums: "knowledge",
    stories: "luclin",
    roster: "commonlands",
    discord: "felwithe",
    eqlInformation: "library",
    login: "nexus",
    default: "norrath"
  });

  function randomInRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  function getRouteKey() {
    const path = window.location.pathname;
    if (path === "/") {
      return "home";
    }
    if (path.startsWith("/forums")) {
      return "forums";
    }
    if (path.startsWith("/stories")) {
      return "stories";
    }
    if (path.startsWith("/roster")) {
      return "roster";
    }
    if (path.startsWith("/discord")) {
      return "discord";
    }
    if (path.startsWith("/eql-information")) {
      return "eqlInformation";
    }
    if (path.startsWith("/login")) {
      return "login";
    }
    return "default";
  }

  function getRouteProfile() {
    return routeProfiles[getRouteKey()] || routeProfiles.default;
  }

  function getRouteZone() {
    return routeZones[getRouteKey()] || routeZones.default;
  }

  function buildWeightedPool(profile) {
    const pool = [];
    Object.keys(profile).forEach((kind) => {
      const weight = Math.max(0, Math.floor(profile[kind]));
      for (let i = 0; i < weight; i += 1) {
        pool.push(kind);
      }
    });
    return pool.length ? pool : Object.keys(relicCatalog);
  }

  function pickRelic(pool) {
    const index = Math.floor(Math.random() * pool.length);
    const kind = pool[index];
    return { kind, src: relicCatalog[kind] };
  }

  function placeRelics() {
    const existing = document.querySelector(".floating-relics");
    if (existing) {
      existing.remove();
    }

    const container = document.createElement("div");
    container.className = "floating-relics";
    container.setAttribute("aria-hidden", "true");

    const profile = getRouteProfile();
    const relicPool = buildWeightedPool(profile);
    const count = window.innerWidth < 800 ? 8 : 14;

    for (let i = 0; i < count; i += 1) {
      const relic = document.createElement("img");
      const picked = pickRelic(relicPool);
      const leftSide = Math.random() > 0.5;
      const x = leftSide ? randomInRange(2, 18) : randomInRange(82, 98);
      const y = randomInRange(10, 92);
      const size = randomInRange(26, 44);
      const rotation = randomInRange(-35, 35);
      const opacity = randomInRange(0.16, 0.32);

      relic.className = `floating-relic floating-relic--${picked.kind}`;
      relic.src = picked.src;
      relic.alt = "";
      relic.loading = "lazy";
      relic.style.left = `${x}%`;
      relic.style.top = `${y}%`;
      relic.style.width = `${size}px`;
      relic.style.height = `${size}px`;
      relic.style.opacity = `${opacity.toFixed(2)}`;
      relic.style.transform = `translate(-50%, -50%) rotate(${rotation.toFixed(1)}deg)`;

      container.appendChild(relic);
    }

    document.body.appendChild(container);
  }

  function injectOwnerNavigation() {
    const nav = document.querySelector('.site-nav');
    if (!nav || nav.querySelector('[data-guild-management-link]')) {
      return;
    }

    const guildAccess = window.TheChosenGuildAccess;
    if (!guildAccess) {
      return;
    }

    const storedMember = window.localStorage.getItem(guildAccess.CURRENT_MEMBER_STORAGE_KEY);
    if (!storedMember) {
      return;
    }

    let parsedMember = null;
    let parsedDirectory = null;
    try {
      parsedMember = JSON.parse(storedMember);
    } catch (error) {
      parsedMember = null;
    }

    const email = String(parsedMember && parsedMember.email ? parsedMember.email : '').trim().toLowerCase();
    if (!email) {
      return;
    }

    try {
      parsedDirectory = JSON.parse(window.localStorage.getItem(guildAccess.DIRECTORY_STORAGE_KEY) || 'null');
    } catch (error) {
      parsedDirectory = null;
    }

    const members = Array.isArray(parsedDirectory && parsedDirectory.members) ? parsedDirectory.members : [];
    const matchingRecord = members.find((member) => String(member && member.email ? member.email : '').trim().toLowerCase() === email);
    if (!matchingRecord || !matchingRecord.access || matchingRecord.access.management !== true) {
      return;
    }

    const link = document.createElement('a');
    link.className = 'site-nav__link';
    link.href = '/guild-management/';
    link.dataset.guildManagementLink = 'true';
    link.textContent = 'Guild Management';
    if (window.location.pathname.startsWith('/guild-management/')) {
      link.classList.add('active');
    }
    nav.appendChild(link);
  }

  window.addEventListener("DOMContentLoaded", () => {
    document.body.setAttribute("data-eq-zone", getRouteZone());
    placeRelics();
    injectOwnerNavigation();
  });
  window.addEventListener("resize", () => {
    window.clearTimeout(window.__chosenRelicResizeTimer);
    window.__chosenRelicResizeTimer = window.setTimeout(placeRelics, 180);
  });
})();
