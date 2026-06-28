(() => {
  const storageKey = "privateChatTheme";
  const darkClass = "is-dark";

  function getSavedTheme() {
    return localStorage.getItem(storageKey) || "light";
  }

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.body.classList.toggle(darkClass, isDark);
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.innerHTML = '<span class="theme-toggle-icon" aria-hidden="true"></span>';
      button.classList.toggle("is-sun", isDark);
      button.title = isDark ? "라이트 모드" : "다크 모드";
      button.setAttribute("aria-label", isDark ? "라이트 모드로 변경" : "다크 모드로 변경");
      button.setAttribute("aria-pressed", String(isDark));
    });
  }

  function toggleTheme() {
    const nextTheme = document.body.classList.contains(darkClass) ? "light" : "dark";
    localStorage.setItem(storageKey, nextTheme);
    applyTheme(nextTheme);
  }

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(getSavedTheme());

    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", toggleTheme);
    });
  });
})();
