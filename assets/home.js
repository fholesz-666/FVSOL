/* Úvodní stránka: menu, filtr portfolia, náhled výkresů, kontaktní formulář (EmailJS beze změny nastavení). */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const year = $("#copy-year");
  if (year) year.textContent = new Date().getFullYear();

  // mobilní menu
  const toggle = $(".nav-toggle"), nav = $("#nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Zavřít" : "Menu";
    });
    nav.addEventListener("click", (e) => {
      if (e.target.closest("a") && nav.classList.contains("open")) toggle.click();
    });
  }

  // filtr portfolia
  const works = $$(".work");
  $$(".filters button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const f = btn.dataset.filter;
      $$(".filters button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      works.forEach((w) => { w.hidden = f !== "*" && !w.dataset.cats.split(" ").includes(f); });
    });
  });

  // náhled výkresu
  const lb = $("#lightbox");
  if (lb && typeof lb.showModal === "function") {
    const img = $("img", lb), cap = $("figcaption p", lb);
    let idx = 0;
    const visible = () => works.filter((w) => !w.hidden);
    const show = (i) => {
      const list = visible();
      idx = (i + list.length) % list.length;
      const b = $("button", list[idx]);
      img.src = b.dataset.full;
      img.alt = $("img", b).alt;
      cap.textContent = b.dataset.caption;
    };
    works.forEach((w) => $("button", w).addEventListener("click", () => {
      show(visible().indexOf(w));
      lb.showModal();
    }));
    lb.addEventListener("click", (e) => {
      const step = e.target.closest("[data-step]");
      if (step) show(idx + Number(step.dataset.step));
      if (e.target.closest("[data-close]") || e.target === lb) lb.close();
    });
    lb.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") show(idx + 1);
      if (e.key === "ArrowLeft") show(idx - 1);
    });
    lb.addEventListener("close", () => { img.removeAttribute("src"); });
  } else {
    // starší prohlížeč: otevřít obrázek přímo
    works.forEach((w) => $("button", w).addEventListener("click", (e) => { location.href = e.currentTarget.dataset.full; }));
  }

  // termíny: první tři čísla doběhnou z 9 na cílovou hodnotu, nadstandardní dokumenty běží dokola 1–9 (jako původní web)
  const counters = $("[data-counters]");
  if (counters) {
    const unit = (n) => (n === 1 ? "týden" : n >= 2 && n <= 4 ? "týdny" : "týdnů");
    const setNum = (el, n, withUnit = true) => {
      el.textContent = String(n);
      const u = el.parentElement.querySelector(".unit");
      if (u && withUnit) u.textContent = unit(n);
    };
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const loopEl = $("[data-loop]", counters);
    let loopTimer = null, started = false, inView = false, current = 1;
    const loopMax = Number(loopEl?.dataset.loop) || 9;
    const startLoop = () => {
      if (!loopEl || loopTimer || reduced) return;
      loopTimer = setInterval(() => {
        current = current >= loopMax ? 1 : current + 1;
        loopEl.textContent = String(current);
      }, 400);
    };
    const stopLoop = () => { clearInterval(loopTimer); loopTimer = null; };
    const run = () => {
      started = true;
      $$("[data-to]", counters).forEach((el) => {
        const end = Number(el.dataset.to), from = 9, t0 = performance.now(), dur = 3000;
        setNum(el, from);
        const step = (t) => {
          const p = Math.min(1, (t - t0) / dur);
          const swing = 0.5 - Math.cos(p * Math.PI) / 2;
          setNum(el, Math.max(end, Math.floor(from + (end - from) * swing)));
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      if (loopEl) loopEl.textContent = "1";
      startLoop();
    };
    if (!reduced && "IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        inView = entries.some((e) => e.isIntersecting);
        if (inView && !started) run();
        else if (inView) startLoop();
        else stopLoop();
      }, { rootMargin: "0px 0px -5% 0px" }).observe(counters);
      document.addEventListener("visibilitychange", () => { if (document.hidden) stopLoop(); else if (started && inView) startLoop(); });
    }
  }

  // kontaktní formulář – EmailJS (stejné ID služby a šablony jako dříve)
  const form = $("#contactForm");
  if (form) {
    const warning = $("#form-message-warning"), success = $("#form-message-success");
    let inited = false;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      warning.style.display = "none";
      success.style.display = "none";
      if (!form.checkValidity()) {
        warning.textContent = "Vyplňte prosím jméno, platný e-mail a zprávu.";
        warning.style.display = "block";
        form.querySelector(":invalid")?.focus();
        return;
      }
      if (!window.emailjs) {
        warning.textContent = "Odeslání teď nefunguje. Napište mi prosím na projekce@fvsol.cz.";
        warning.style.display = "block";
        return;
      }
      if (!inited) { window.emailjs.init("jcI-Mfxs2Tj1RcLNA"); inited = true; }
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      window.emailjs.sendForm("service_amm7txp", "template_g18lk2i", form).then(
        () => { success.style.display = "block"; form.reset(); btn.disabled = false; },
        (error) => {
          warning.textContent = "Nepodařilo se odeslat. Zkuste to prosím znovu.";
          warning.style.display = "block";
          btn.disabled = false;
          console.error("EmailJS error:", error);
        },
      );
    });
  }
})();
