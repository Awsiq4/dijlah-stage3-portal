try {
  const preference = localStorage.getItem("dijlah-stage3-theme");
  const dark = preference ? preference === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
} catch {
  document.documentElement.dataset.theme = "light";
}
