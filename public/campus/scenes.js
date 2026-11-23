// Each strip follows the paving between the flower beds and the pond railing.
const pondRing = [
  [[1144,562],[1148,589]], [[1242,568],[1234,602]], [[1292,583],[1272,620]],
  [[1385,603],[1358,629]], [[1448,623],[1404,648]], [[1501,690],[1440,679]],
  [[1502,740],[1444,715]], [[1456,797],[1419,756]], [[1422,819],[1396,786]],
  [[1382,866],[1361,798]], [[1290,892],[1285,811]], [[1250,882],[1236,826]],
  [[1180,861],[1171,829]], [[1116,855],[1116,824]], [[1062,860],[1056,812]],
  [[991,881],[988,812]], [[913,853],[934,798]], [[912,811],[929,777]],
  [[865,768],[907,751]], [[833,733],[911,718]], [[845,670],[891,686]],
  [[873,652],[905,654]], [[943,615],[946,633]], [[1010,590],[1015,617]],
  [[1080,566],[1070,601]]
];
const pondPaths = pondRing.map(([outer,inner],index)=>{
  const [nextOuter,nextInner]=pondRing[(index+1)%pondRing.length];
  return [outer,nextOuter,nextInner,inner];
});
const plazaSquare=[[[211,466],[850,466],[1000,475],[1000,485],[960,505],[905,540],[840,580],[785,625],[740,675],[710,725],[720,780],[745,815],[780,850],[850,890],[955,930],[960,939],[211,939]],
      [[840,466],[960,440],[1150,455],[1110,490],[990,520],[920,515]],
      [[916,455],[978,390],[1180,390],[1205,455],[1105,475]]];
// IT4 and IT5 were painted from the same forecourt, so they share one floor outline.
const itForecourt=[[[468,500],[1082,500],[1103,545],[1215,545],[1365,895],[929,895],[929,1015],[608,1015],[608,895],[178,895],[232,745],[12,745],[12,615],[293,615],[321,549],[447,549]]];
export const SCENES={
  plaza:{id:'plaza',name:'일청담 광장',image:'/campus/assets/knu-plaza-v4.png',alt:'경북대학교 본관과 일청담 광장',play:true,
    floors:[...plazaSquare,
      [[811,875],[888,921],[986,883],[966,863],[921,842],[898,857]],
      [[1017,493],[1055,476],[1112,503],[1141,535],[1151,574],[1129,581],[1123,549],[1103,525]],
      ...pondPaths],
    obstacles:[{id:'southwest-planter',polygon:[[210,925],[229,943],[246,972],[210,999]]},{id:'entrance-lamp',circle:[850,493,12]}],
    spawn:{x:860,y:520},portals:[{id:'plaza-ginkgo',x:300,y:700,target:'ginkgo'},{id:'plaza-library',x:1080,y:410,target:'lounge'},{id:'plaza-it',x:430,y:900,target:'it'}],
    canopies:[{box:[344,250,154,115],root:397},{box:[553,255,151,119],root:405},{box:[955,822,247,190],root:1023},{box:[402,10,183,168],root:240}],ambient:'leaves'},
  ginkgo:{id:'ginkgo',name:'은행나무길',image:'/campus/assets/ginkgo-walk-v2.png',alt:'농대 앞 은행나무 가로수 사이로 북문 조형물이 보이는 캠퍼스 산책길',play:true,
    // The avenue narrows toward the North Gate in the painting, so the upper and lower halves are separate trapezoids.
    floors:[[[618,180],[912,180],[1043,632],[480,632]],[[450,752],[1075,752],[1135,1015],[392,1015]],[[12,625],[1523,625],[1523,757],[12,757]]],obstacles:[],spawn:{x:760,y:860},
    portals:[{id:'ginkgo-plaza',x:760,y:930,target:'plaza'},{id:'ginkgo-library',x:1340,y:690,target:'lounge'},{id:'ginkgo-it',x:110,y:690,target:'it'}],
    canopies:[{box:[120,0,470,340],root:560},{box:[960,0,460,350],root:560},{box:[0,800,200,220],root:1023},{box:[1330,800,206,220],root:1023}],ambient:'leaves'},
  lounge:{id:'lounge',name:'도서관 라운지',image:'/campus/assets/library-lounge-v2.png',alt:'나무 북갤러리 서가와 블록 마루, 카페가 있는 중앙도서관 1층',play:false,
    floors:[[[355,286],[1205,286],[1244,416],[1363,666],[1490,945],[929,945],[929,1014],[626,1014],[626,945],[168,945],[257,790],[325,590],[355,445]]],
    obstacles:[],spawn:{x:760,y:820},portals:[{id:'library-plaza',x:690,y:910,target:'plaza'},{id:'library-ginkgo',x:855,y:910,target:'ginkgo'}],
    canopies:[{box:[110,245,115,125],root:365},{box:[1255,160,140,185],root:345},{box:[1415,680,125,165],root:880},{box:[0,820,110,180],root:1000}],ambient:'light'},
  it:{id:'it',name:'IT대학 융복합관',image:'/campus/assets/it-college-v2.png',alt:'회색 루버와 노란 패널이 있는 IT대학 융복합관 정문과 앞마당',play:true,
    floors:itForecourt,
    obstacles:[],spawn:{x:768,y:700},
    portals:[{id:'it-plaza',x:768,y:960,target:'plaza'},{id:'it-ginkgo',x:70,y:680,target:'ginkgo'},{id:'it-it4',x:1230,y:800,target:'it4'}],
    canopies:[{box:[14,250,260,310],root:560},{box:[1305,320,230,270],root:590},{box:[0,835,225,189],root:1023},{box:[1335,895,200,129],root:1023}],ambient:'leaves'},
  it4:{id:'it4',name:'IT대학 4호관',image:'/campus/assets/it4-building-v4.png',alt:'회색 콘크리트 격자 벽과 컴퓨터학부 간판이 있는 IT대학 4호관, 왼쪽 아래 주차된 차 두 대와 자전거',
    // Real lettering over the blank gold plates painted on the canopy (generated art cannot spell Korean).
    signs:[{text:'컴퓨터학부',x:778,y:349,width:196}],play:true,
    floors:itForecourt,obstacles:[],spawn:{x:768,y:700},
    portals:[{id:'it4-it',x:1230,y:800,target:'it'},{id:'it4-lecture',x:768,y:540,target:'lecture'}],
    canopies:[{box:[14,250,260,310],root:560},{box:[1305,320,230,270],root:590},{box:[1335,895,200,129],root:1023}],ambient:'leaves'},
  // IT4 lecture room: the floor is empty in the painting; desks and chairs are furniture so students can sit.
  lecture:{id:'lecture',name:'IT4 강의실',image:'/campus/assets/lecture-hall-v3.png',alt:'흰 화이트보드와 흰 책상이 놓인 밝은 IT대학 4호관 강의실',play:false,
    floors:[[[418,305],[1098,305],[1196,955],[873,955],[873,1015],[656,1015],[656,955],[340,955]]],
    obstacles:[],spawn:{x:768,y:900},
    portals:[{id:'lecture-it4',x:768,y:975,target:'it4'}],
    canopies:[],ambient:'light'},
};
export const sceneInfo=id=>typeof id==='string'&&Object.hasOwn(SCENES,id)?SCENES[id]:null;
export const sameScene=(a,b)=>(a?.scene||'plaza')===(b?.scene||'plaza');
export function nearbyPortal(scene,x,y){return sceneInfo(scene)?.portals.filter(p=>Math.hypot(p.x-x,p.y-y)<=78).sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0]||null;}

const arrivals = {
  'plaza-library':[1040,456,'southwest'], 'plaza-ginkgo':[358,700,'east'],
  'ginkgo-plaza':[760,865,'north'], 'ginkgo-library':[1272,690,'west'], 'ginkgo-it':[178,690,'east'],
  'library-plaza':[690,848,'north'], 'library-ginkgo':[855,848,'north'],
  'plaza-it':[440,840,'north'], 'it-plaza':[768,895,'north'], 'it-ginkgo':[140,680,'east'], 'it-it4':[1165,800,'west'], 'it4-it':[1165,800,'west'], 'it4-lecture':[768,610,'south'], 'lecture-it4':[768,905,'north']
};
export function arrivalFrom(origin,destination){
  const reverse=sceneInfo(destination)?.portals.find(gate=>gate.target===origin);
  if(!reverse)return null;
  const [x,y,facing]=arrivals[reverse.id];
  return {x,y,facing};
}

// Existing LAN processes may still validate moves against the square alone.
export const originalPlazaFloor={...SCENES.plaza,floors:plazaSquare};
