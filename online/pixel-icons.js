export const icons = {
  rotate:'rotate', map:'map', invite:'invite', wave:'actions-frame-2', step:'jump',
  friends:'friends', outfit:'dock-wardrobe', chat:'chat', tutor:'tutor',
  study:'dock-study', records:'dock-records', shop:'seed-chest', wallet:'seed-wallet',
  seat:'library-desk', heart:'emote-heart', cheer:'emote-cheer', coffee:'emote-coffee', idea:'emote-idea',
};
export function iconUrl(key){return '/icons/'+icons[key]+'.png';}
export function decorate(node,key){
  if(!icons[key])return node;
  node.classList.add('pixel-control');
  node.style.setProperty('--glyph',`url("${iconUrl(key)}")`);
  return node;
}
