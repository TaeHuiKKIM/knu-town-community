import { clock } from './study-time.js';
import { canWearStyle, LOOKS, outfitName, studyStyle, STUDY_STYLES } from './wardrobe.js';

const $ = id => document.getElementById(id);
const views = ['south', 'southwest', 'west', 'northwest', 'north', 'northeast', 'east', 'southeast'];

export class WardrobeUI {
  constructor({ art, appearance, rewardMs, owned, canApply, apply }) {
    Object.assign(this, { art, appearance, rewardMs, owned, canApply, apply });
    this.cards = new Map();
    this.previewVersion = 0;
    this.coats = [...document.querySelectorAll('button[data-coat]')];
    this.look = 'coat';
    this.tabs = [...document.querySelectorAll('button[data-look]')];
    for (const tab of this.tabs) {
      tab.id = 'wardrobe-tab-' + tab.dataset.look;
      tab.setAttribute('aria-controls', 'wardrobe-look-panel');
      tab.addEventListener('click', () => this.switchLook(tab.dataset.look));
      tab.addEventListener('keydown', event => {
        const tabs = this.tabs.filter(item => !item.hidden);
        const index = tabs.indexOf(tab);
        const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        this.switchLook(tabs[next].dataset.look);
        tabs[next].focus();
      });
    }
    for (const button of this.coats) button.addEventListener('click', () => this.select(button.dataset.coat));
    $('rotate-preview').addEventListener('click', () => {
      this.facing = views[(views.indexOf(this.facing) + 1) % views.length];
      this.render();
    });
    $('retry-outfit-preview').addEventListener('click', () => void this.loadPreview());
    $('apply-outfit').addEventListener('click', () => void this.commit());
  }

  open() {
    const { avatar, coat, style } = this.appearance();
    this.avatar = avatar;
    this.facing = 'south';
    this.choices = new Map();
    this.buildCards();
    this.look = studyStyle(style)?.look ?? 'coat';
    this.select(coat, style);
  }

  switchLook(look) {
    if (this.applying || this.look === look) return;
    this.look = look;
    const choice = this.choices.get(look);
    const first = look === 'coat' ? null : STUDY_STYLES.find(style => style.avatar === this.avatar && style.look === look)?.id;
    this.select(choice?.coat ?? this.coat, choice ? choice.style : first);
  }

  buildCards() {
    if (this.cardAvatar === this.avatar) return;
    this.cardAvatar = this.avatar;
    this.cards.clear();
    $('study-outfit-list').replaceChildren();
    for (const style of STUDY_STYLES.filter(entry => entry.avatar === this.avatar)) {
      const button = document.createElement('button');
      const label = document.createElement('strong'), detail = document.createElement('span');
      button.type = 'button';
      button.className = 'study-outfit-card';
      button.dataset.style = style.id;
      label.textContent = style.name;
      const icon = document.createElement('img');
      icon.src = '/campus/assets/icons/outfit-' + style.id + '.png';
      icon.alt = '';
      icon.width = 30;
      icon.height = 40;
      button.append(icon, label, detail);
      button.addEventListener('click', () => this.select(this.coat, style.id));
      this.cards.set(style.id, { button, detail });
      $('study-outfit-list').append(button);
    }
  }

  select(coat, style = null) {
    if (this.applying) return;
    this.coat = coat;
    this.style = style ?? null;
    this.choices.set(this.look, { coat, style: this.style });
    this.previewVersion++;
    this.previewError = false;
    $('outfit-error').textContent = '';
    this.render();
    if (style && !this.art.hasStyle(style)) void this.loadPreview();
  }

  async loadPreview() {
    const style = this.style, version = ++this.previewVersion;
    if (!style) return;
    this.previewError = false;
    this.render();
    try { await this.art.loadStyle(style); }
    catch { if (version === this.previewVersion) this.previewError = true; }
    if (version === this.previewVersion) this.render();
  }

  refresh() {
    if ($('wardrobe-dialog').open) this.render();
  }

  render() {
    if (!this.avatar) return;
    const reward = this.rewardMs(), selected = studyStyle(this.style), current = this.appearance();
    const ready = !selected || this.art.hasStyle(selected.id);
    const available = canWearStyle(this.style, this.avatar, reward, this.owned());
    const equipped = current.coat === this.coat && (current.style ?? null) === this.style;
    for (const tab of this.tabs) {
      const active = tab.dataset.look === this.look;
      tab.hidden = tab.dataset.look !== 'coat' && !STUDY_STYLES.some(style => style.avatar === this.avatar && style.look === tab.dataset.look);
      tab.tabIndex = active ? 0 : -1;
      tab.disabled = !!this.applying;
      if (active) $('wardrobe-look-panel').setAttribute('aria-labelledby', tab.id);
      tab.setAttribute('aria-selected', String(active));
      tab.classList.toggle('selected', active);
    }
    $('coat-grid').hidden = this.look !== 'coat';
    let shown = 0;
    for (const [id, { button }] of this.cards) { const inLook = studyStyle(id).look === this.look; button.hidden = !inLook; if (inLook) shown++; }
    $('look-empty').hidden = this.look === 'coat' || shown > 0;
    $('look-empty').textContent = `${LOOKS.find(look => look.id === this.look).name}은 이 캐릭터용 옷을 준비하고 있어요.`;
    for (const button of this.coats) {
      button.setAttribute('aria-pressed', String(!selected && button.dataset.coat === this.coat));
      button.classList.toggle('selected', !selected && button.dataset.coat === this.coat);
      button.disabled = !!this.applying;
      this.art.paint(button.querySelector('canvas'), { avatar: this.avatar, coat: button.dataset.coat });
    }
    for (const [id, { button, detail }] of this.cards) {
      const style = studyStyle(id);
      button.setAttribute('aria-pressed', String(this.style === id));
      button.disabled = !!this.applying;
      detail.textContent = current.style === id ? '입는 중' : canWearStyle(id, this.avatar, reward, this.owned()) ? '해금됨' : `${style.hours}시간 해금`;
    }
    const name = outfitName(this.coat, this.style), state = equipped ? '입는 중' : '미리보기';
    if ($('fitting-name').textContent !== name) $('fitting-name').textContent = name;
    if ($('fitting-state').textContent !== state) $('fitting-state').textContent = state;
    $('wardrobe-sprite').hidden = !ready;
    $('rotate-preview').disabled = !ready;
    if (ready) this.art.paint($('wardrobe-sprite'), { avatar: this.avatar, coat: this.coat, style: this.style, facing: this.facing });
    $('outfit-preview-status').hidden = ready;
    $('outfit-preview-status').textContent = ready ? '' : this.previewError ? '코디 그림을 아직 불러오지 못했어요.' : '코디 그림을 불러오는 중';
    $('retry-outfit-preview').hidden = ready || !this.previewError;
    $('outfit-reward').hidden = !selected;
    if (selected) {
      const duration = Math.min(reward, selected.requiredMs), label = `확인 공부 ${clock(duration)} / ${selected.hours}시간`;
      $('outfit-reward-label').textContent = available && duration < selected.requiredMs ? '코디 상자에서 획득' : label;
      $('outfit-reward-bar').hidden = available && duration < selected.requiredMs;
      $('outfit-reward-bar').max = selected.requiredMs;
      $('outfit-reward-bar').value = duration;
    }
    const submit = $('apply-outfit');
    submit.textContent = this.applying ? '적용하는 중' : !available ? '공부 보상 잠김' : '입기';
    submit.disabled = !!this.applying || !this.canApply() || !ready || !available || equipped || this.avatar !== current.avatar;
  }

  async commit() {
    if ($('apply-outfit').disabled) return;
    const { coat, style } = this;
    if (!this.canApply() || !canWearStyle(style, this.avatar, this.rewardMs(), this.owned()) || style && !this.art.hasStyle(style)) return;
    this.applying = true;
    $('outfit-error').textContent = '';
    this.render();
    try {
      await this.apply({ coat, style });
      $('wardrobe-dialog').close();
    } catch (error) {
      if (!error.stale) $('outfit-error').textContent = error.message;
    } finally {
      this.applying = false;
      this.refresh();
    }
  }
}
