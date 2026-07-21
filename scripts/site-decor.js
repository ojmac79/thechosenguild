(function () {
  const relicCatalog = {
    sword: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/2694.svg",
    axe: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1fa93.svg",
    staff: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1fa84.svg",
    dagger: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1f5e1.svg"
  };

  const routeProfiles = {
    home: { sword: 1, axe: 1, staff: 5, dagger: 2 },
    forums: { sword: 4, axe: 4, staff: 1, dagger: 2 },
    stories: { sword: 2, axe: 1, staff: 5, dagger: 3 },
    roster: { sword: 4, axe: 3, staff: 1, dagger: 2 },
    discord: { sword: 2, axe: 2, staff: 2, dagger: 3 },
    eqlInformation: { sword: 1, axe: 1, staff: 4, dagger: 3 },
    login: { sword: 1, axe: 1, staff: 4, dagger: 2 },
    default: { sword: 2, axe: 2, staff: 2, dagger: 2 }
  };

  function randomInRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  function getRouteProfile() {
    const path = window.location.pathname;
    if (path === "/") {
      return routeProfiles.home;
    }
    if (path.startsWith("/forums")) {
      return routeProfiles.forums;
    }
    if (path.startsWith("/stories")) {
      return routeProfiles.stories;
    }
    if (path.startsWith("/roster")) {
      return routeProfiles.roster;
    }
    if (path.startsWith("/discord")) {
      return routeProfiles.discord;
    }
    if (path.startsWith("/eql-information")) {
      return routeProfiles.eqlInformation;
    }
    if (path.startsWith("/login")) {
      return routeProfiles.login;
    }
    return routeProfiles.default;
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
    const count = window.innerWidth < 800 ? 6 : 10;

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

  window.addEventListener("DOMContentLoaded", placeRelics);
  window.addEventListener("resize", () => {
    window.clearTimeout(window.__chosenRelicResizeTimer);
    window.__chosenRelicResizeTimer = window.setTimeout(placeRelics, 180);
  });
})();
