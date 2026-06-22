const menuToggle = document.getElementById("menu-toggle");
const navLinks = document.getElementById("nav-links");
const navAnchors = document.querySelectorAll("#nav-links a");
const signupForm = document.getElementById("signup-form");
const submitButton = document.getElementById("submit-button");
const formStatus = document.getElementById("form-status");
const yearElements = document.querySelectorAll("#year");

const defaultSubmitText = "Send tilmelding";

yearElements.forEach((year) => {
  year.textContent = new Date().getFullYear();
});

function closeMenu() {
  if (!menuToggle || !navLinks) return;

  menuToggle.classList.remove("active");
  navLinks.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
  document.body.classList.remove("menu-open");
}

if (menuToggle && navLinks) {
  menuToggle.addEventListener("click", () => {
    const nowOpen = !navLinks.classList.contains("open");

    navLinks.classList.toggle("open", nowOpen);
    menuToggle.classList.toggle("active", nowOpen);
    menuToggle.setAttribute("aria-expanded", String(nowOpen));
    document.body.classList.toggle("menu-open", nowOpen);
  });

  navAnchors.forEach((anchor) => {
    anchor.addEventListener("click", closeMenu);
  });

  document.addEventListener("click", (event) => {
    if (
      window.innerWidth <= 900 &&
      navLinks.classList.contains("open") &&
      !event.target.closest(".navbar")
    ) {
      closeMenu();
    }
  });
}

function setStatus(message, type = "") {
  if (!formStatus) return;

  formStatus.textContent = message;
  formStatus.classList.remove("is-success", "is-error");

  if (type === "success") {
    formStatus.classList.add("is-success");
  }

  if (type === "error") {
    formStatus.classList.add("is-error");
  }
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPostcode(postcode) {
  return postcode === "" || /^\d{4}$/.test(postcode);
}

function isValidInterestArea(interestArea) {
  return [
    "",
    "membership",
    "newsletter",
    "volunteering",
    "local-branch",
    "general"
  ].includes(interestArea);
}

if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(signupForm);

    const payload = {
      firstName: normalizeText(formData.get("firstName")),
      lastName: normalizeText(formData.get("lastName")),
      email: normalizeText(formData.get("email")).toLowerCase(),
      postcode: normalizeText(formData.get("postcode")),
      interestArea: normalizeText(formData.get("interestArea")),
      sourcePage:
        normalizeText(formData.get("sourcePage")) ||
        "statskonservative-homepage",
      botField: normalizeText(formData.get("botField")),
      consent: signupForm.elements.consent.checked
    };

    if (payload.firstName.length < 2) {
      setStatus("Skriv et fornavn på mindst 2 tegn.", "error");
      return;
    }

    if (payload.lastName.length < 2) {
      setStatus("Skriv et efternavn på mindst 2 tegn.", "error");
      return;
    }

    if (!isValidEmail(payload.email)) {
      setStatus("Skriv en gyldig e-mailadresse.", "error");
      return;
    }

    if (!isValidPostcode(payload.postcode)) {
      setStatus("Postnummer skal være præcis 4 cifre.", "error");
      return;
    }

    if (!isValidInterestArea(payload.interestArea)) {
      setStatus("Vælg et gyldigt interesseområde.", "error");
      return;
    }

    if (!payload.consent) {
      setStatus("Du skal give samtykke, før du kan sende formularen.", "error");
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Sender...";
    }

    setStatus("Sender din tilmelding...");

    try {
      const response = await fetch("/api/tilmeld", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(payload)
      });

      let result;

      try {
        result = await response.json();
      } catch {
        result = {
          ok: false,
          message: "Serveren gav et uventet svar."
        };
      }

      if (!response.ok || !result.ok) {
        throw new Error(result.message || "Tilmeldingen kunne ikke sendes.");
      }

      signupForm.reset();

      setStatus(
        result.message || "Tak. Din tilmelding er blevet gemt.",
        "success"
      );
    } catch (error) {
      setStatus(
        error.message || "Noget gik galt. Prøv igen om lidt.",
        "error"
      );
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = defaultSubmitText;
      }
    }
  });
}
