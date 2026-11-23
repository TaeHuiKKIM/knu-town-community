import {decorate} from "./pixel-icons.js";

const storageKey = "knu-tutor-invite";

export function tutorInvite(value) {
  try {
    const url = new URL(value.trim());
    const [a,b] = url.hostname.split(".").map(Number);
    const local = /^(\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) &&
      (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127);
    if (!local && url.hostname !== "localhost") return null;
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (url.pathname === "/") url.pathname = "/r/main";
    if (!/^\/r\/[a-zA-Z0-9_-]{1,64}\/?$/.test(url.pathname)) return null;
    url.search = "";
    url.hash = "tutor";
    return url.href;
  } catch { return null; }
}

export function addTutorLink(section, add) {
  const box = add(section, "details", "");
  decorate(add(box, "summary", "AI 튜터"), "tutor");
  const label = add(box, "label", "방장의 LAN 초대 링크 (같은 Wi-Fi)");
  const input = add(label, "input", "");
  input.type = "url";
  input.autocapitalize = "none";
  input.spellcheck = false;
  input.placeholder = "http://…/r/main";
  try { input.value = localStorage.getItem(storageKey) || ""; } catch {}
  const link = decorate(add(box, "a", "튜터 열기"), "study");
  link.classList.add("tutor-room-link");
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const message = add(box, "small", "");
  message.setAttribute("aria-live", "polite");
  const update = () => {
    const url = tutorInvite(input.value);
    if (url) link.href = url;
    else link.removeAttribute("href");
    link.hidden = !url;
    message.textContent = input.value && !url ? "LAN 초대 링크를 확인하세요." : "";
    return url;
  };
  input.addEventListener("input", update);
  link.addEventListener("click", () => {
    const url = update();
    if (url) try { localStorage.setItem(storageKey, url.split("#")[0]); } catch {}
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && update()) { event.preventDefault(); link.click(); }
  });
  update();
}
