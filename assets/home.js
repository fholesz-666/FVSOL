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
