(function () {
  try {
    var pref = localStorage.getItem('color-scheme');
    if (pref === 'light' || pref === 'dark') {
      document.querySelector('meta[name="color-scheme"]').content = pref;
      document.documentElement.dataset.theme = pref;
    }
  } catch (e) {}
})();
