const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let pendingPrompt;

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  pendingPrompt = event;
});
window.addEventListener("appinstalled", () => { pendingPrompt = undefined; });

export function addInstallOption(parent) {
  if (standalone() || !window.isSecureContext) return;
  const details = document.createElement("details");
  const label = document.createElement("summary");
  label.textContent = "홈 화면에 추가";
  details.append(label);
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    while (label.nextSibling) label.nextSibling.remove();
    const prompt = pendingPrompt;
    if (prompt) {
      const install = document.createElement("button");
      install.type = "button";
      install.textContent = "크누타운 설치";
      install.onclick = async () => {
        if (pendingPrompt !== prompt) return;
        pendingPrompt = undefined;
        try {
          await prompt.prompt();
        } catch {
          // A dismissed or expired browser prompt can no longer be reused.
        } finally {
          details.open = false;
        }
      };
      details.append(install);
      return;
    }
    const tip = document.createElement("p");
    const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    tip.textContent = appleMobile
      ? "Safari에서 공유 버튼을 누르고 ‘홈 화면에 추가’를 선택하세요."
      : "브라우저 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택하세요.";
    details.append(tip);
  });
  parent.append(details);
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The regular browser game remains available if the browser disallows workers.
    });
  });
}
