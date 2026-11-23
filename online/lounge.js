import {sceneFurniture,furnitureWidths} from "../public/campus/furniture.js";

export const tables=sceneFurniture("lounge").map(item=>({...item,width:furnitureWidths[item.kind]}));
export const chairs=tables.flatMap(table=>table.seats.map(seat=>({...seat,table})));

const heights={desk:106,"long-table":112,"round-table":95,sofa:89,"lecture-desk":93};
export function drawFurniture(ctx,t,art){
  const image=art[t.kind], h=heights[t.kind];
  if(image.naturalWidth)ctx.drawImage(image,t.x-t.width/2,t.y-h,t.width,h);
}
export function drawChair(ctx,c,art,backrestOnly=false){
  if(c.table.kind==="sofa")return;
  if(c.table.kind==="lecture-desk"){
    // 강의실 검정 의자는 56px 높이. 앉으면 윗등받이 27px만 사람 앞에 그린다.
    const image=art[c.facing==="south"?"lecture-chair-front":"lecture-chair-back"];
    if(!image?.naturalWidth)return;
    const height=backrestOnly?27:56;
    ctx.drawImage(image,0,0,image.naturalWidth,image.naturalHeight*height/56,c.x-18,c.y-56,36,height);
    return;
  }
  const image=art[c.facing==="south"?"chair-front":"chair-back"];
  if(!image.naturalWidth)return;
  // Only the upper wooden backrest is in front of the person.
  const height=backrestOnly?24:47;
  ctx.drawImage(image,0,0,image.naturalWidth,image.naturalHeight*height/47,c.x-18,c.y-47,36,height);
}
