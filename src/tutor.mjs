// AI 튜터: 방장 노트북에서 도는 Ollama(로컬 언어 모델)에 질문을 넘기고 답을 조금씩 돌려준다.
// 외부 AI 서비스로 아무것도 보내지 않는다. 질문·답은 저장하지 않고 이 요청이 끝나면 버린다.
// 설정(환경 변수)
//   TUTOR_MODEL  Ollama 모델 이름 (기본 exaone3.5:7.8b, 사양이 낮으면 exaone3.5:2.4b)
//   OLLAMA_HOST  Ollama 주소 (기본 http://127.0.0.1:11434)
//   TUTOR=off    튜터 끄기
//   TUTOR_DAILY  학생 1명이 하루에 할 수 있는 질문 수 (기본 30)

export const TUTOR_LIMITS = { question: 600, turns: 6, turnText: 1200, body: 32768, concurrent: 1, waiting: 4, gapMs: 3000, daily: Number(process.env.TUTOR_DAILY) > 0 ? Number(process.env.TUTOR_DAILY) : 30 };

const SYSTEM = `너는 경북대학교 컴퓨터학부 학생들이 함께 공부하는 '크누타운' 공부방의 AI 튜터야.
답하는 규칙:
1. 한국어로 핵심부터 답해. 보통 3~8문장, 길어도 15줄을 넘기지 마. 학생이 더 자세히 원하면 그때 늘려.
2. 수식은 LaTeX(\\[, \\frac 등)를 쓰지 말고 (i - 1) / 2 처럼 평범한 글자로 써.
3. 코드는 개념을 보여 주는 5~15줄 조각만 쓰고 \`\`\`로 감싸. 배열 인덱스는 0부터 시작한다고 보고 설명해.
4. 학생이 과제·시험 문제의 "전체 코드", "정답", "대신 짜줘"를 요청하면 완성 코드를 주지 마. 대신 함수 뼈대(빈 칸은 주석 /* TODO */), 단계별 알고리즘, 스스로 확인할 테스트 예시를 줘. 학생이 직접 쓴 코드를 보여 주면 틀린 곳을 짚어 줘.
5. 확실하지 않거나 학교 행정·일정처럼 확인할 수 없는 정보는 추측하지 말고 모른다고 말해.
6. 너는 공부 도우미야. 전공·교양 공부, 코딩, 공부 방법, 시험 준비처럼 공부와 관계된 질문만 답해. 잡담, 연애·인간관계 상담, 특정 사람에 대한 평가·험담, 정치 의견, 공부와 무관한 글쓰기 대행은 한 문장으로 정중히 거절하고 공부 질문을 해 달라고 해.
7. 욕설·성적인 내용·남을 해치거나 법을 어기는 방법(남의 계정 침입, 악성코드 배포 등)은 돕지 마. 보안 개념을 배우는 질문은 원리와 방어 방법 위주로 설명해.`;

const clean = (value, max) => typeof value === 'string' ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, max) : '';

// 과제·시험 대행으로 보이는 질문. 작은 로컬 모델은 앞쪽 규칙을 잘 잊어서, 이런 질문에는 질문 바로 뒤에 지시를 한 번 더 붙인다.
const SOLVE = /(전체|완성|풀)\s*(코드|소스)|코드\s*(를|좀)?\s*(짜|작성|만들)|(짜|풀어|작성해)\s*(줘|주세요|달라)|정답|답\s*(알려|좀)|과제|숙제|시험\s*문제/;
export const asksForSolution = question => SOLVE.test(question.replace(/\s+/g, ' '));
const GUARD = `\n\n(튜터 지시: 이 질문은 과제·시험 풀이를 대신해 달라는 요청일 수 있어. 코드는 한 줄도 쓰지 마. 먼저 "직접 풀 수 있게 도와줄게요"라고 말하고, 단계별 알고리즘(번호 목록 5개 이내), 막히기 쉬운 부분의 힌트 2개, 스스로 확인할 입력·출력 예시 하나만 글로 줘.)`;
// 지시를 어기고 코드를 쓰기 시작하면 서버가 그 자리에서 답을 끊는다.
export const SOLUTION_CUT = '\n\n(과제 풀이 요청이라 코드는 보여 주지 않아요. 위 단계대로 직접 써 보고, 막히면 쓴 코드를 붙여서 어디가 틀렸는지 물어보세요.)';

// 입력 가드레일: 모델에 보내기 전에 서버가 먼저 거른다. 단어 목록이라 표현을 바꾸면 빠져나갈 수 있는 기본 장치다.
// 1) 위기 신호: 모델 대신 정해진 안내를 보낸다.
const CRISIS = /죽고\s*싶|자살|자해|극단적\s*(인\s*)?선택|살기\s*싫|사라지고\s*싶|목숨을?\s*끊|손목을?\s*긋|뛰어내리고\s*싶|삶을?\s*끝내/;
export const CRISIS_REPLY = `많이 힘든 마음이 느껴져요. 이건 AI 튜터가 도울 수 있는 일보다 훨씬 중요한 이야기라, 꼭 사람과 이야기해 주세요.

- 자살예방상담전화 109 (24시간, 전화·문자)
- 청소년·청년 모바일 상담 '다 들어줄 개' 앱, 정신건강위기상담 1577-0199
- 학교 학생상담센터 (재학생 무료 상담)
- 지금 위험하다면 112 또는 119

옆에 있는 친구나 믿을 수 있는 사람에게 지금 연락해 보는 것도 좋아요.`;
// 2) 유해 요청: 욕설·성적 내용·범죄 방법. 보안 개념 질문(예: SQL 인젝션 원리)은 막지 않고, 남을 해치려는 표현만 거른다.
const HARMFUL = [
  /씨\s*발|시\s*발(?!점|역|택|생)|ㅅ\s*ㅂ|병\s*신|ㅂ\s*ㅅ|좆|존\s*나|개\s*새\s*끼|지랄|닥\s*쳐/,
  /섹\s*스|야\s*동|포\s*르\s*노|성\s*관\s*계/,
  /(폭탄|폭발물|총기?|마약|필로폰|대마)\s*(을|를)?\s*(만드|제조|구하|사는|구매)/,
  /(남|친구|교수|조교|다른\s*사람|선배|후배)[^.?!\n]{0,15}(계정|비밀번호|비번|카톡|인스타|메일)[^.?!\n]{0,12}(해킹|털|훔치|알아내|뚫)/,
  /(해킹|디도스|ddos)\s*(하는|해\s*주|해줘|방법)|(악성\s*코드|랜섬웨어|바이러스)\s*(만들|배포|퍼뜨)/i,
];
export const guardrail = question => {
  const text = question.replace(/\s+/g, ' ');
  if (CRISIS.test(text)) return 'crisis';
  if (HARMFUL.some(r => r.test(text))) return 'harmful';
  return null;
};
export const HARMFUL_REPLY = '그 요청은 도와줄 수 없어요. 공부하다 막힌 개념이나 풀이 방향을 물어봐 주세요. 보안이 궁금하다면 "SQL 인젝션은 어떻게 막아?"처럼 원리와 방어 방법으로 물어보면 설명해 줄게요.';

export function tutorMessages({ question, history = [], study = null }) {
  const turns = (Array.isArray(history) ? history : []).slice(-TUTOR_LIMITS.turns)
    .filter(t => t && (t.role === 'user' || t.role === 'assistant'))
    .map(t => ({ role: t.role, content: clean(t.content, TUTOR_LIMITS.turnText) }))
    .filter(t => t.content);
  const context = study ? `\n지금 학생이 공부 중인 과목: ${study.subject}\n이번 목표: ${study.goal}` : '';
  return [{ role: 'system', content: SYSTEM + context }, ...turns, { role: 'user', content: asksForSolution(question) ? question + GUARD : question }];
}

export function createTutor({ host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434', model: configuredModel = process.env.TUTOR_MODEL, enabled = process.env.TUTOR !== 'off', fetchImpl = fetch, now = Date.now } = {}) {
  host = host.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(host)) host = `http://${host}`;
  const preferred=configuredModel || 'exaone3.5:7.8b';
  let model=preferred, checkedModel=false, warming=null;
  let running = 0;
  const queue = [], lastAsk = new Map(), daily = new Map();
  // 하루 질문 수: 방장 노트북의 날짜 기준. 서버를 다시 켜면 처음부터 센다.
  const today = () => new Date(now()).toDateString();
  const used = profileId => { const d = daily.get(profileId); return d?.day === today() ? d.count : 0; };
  const left = profileId => Math.max(0, TUTOR_LIMITS.daily - used(profileId));

  async function status(profileId) {
    if (!enabled) return { ready: false, model, reason: 'off', message: '방장이 AI 튜터를 꺼 두었어요.' };
    try {
      const res = await fetchImpl(`${host}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) throw Error();
      const { models = [] } = await res.json();
      const names = models.map(m => m.name);
      const installed=name=>names.includes(name)||names.includes(name+':latest');
      model=!configuredModel && !installed(preferred) && installed('exaone3.5:2.4b')?'exaone3.5:2.4b':preferred;
      const found=installed(model);
      checkedModel=found;
      if (!found) return { ready: false, model, reason: 'model', message: `방장 노트북에 ${model} 모델이 없어요.` };
      return { ready: true, model, left: left(profileId), daily: TUTOR_LIMITS.daily };
    } catch {
      return { ready: false, model, reason: 'ollama', message: '방장 노트북에서 Ollama가 켜져 있지 않아요.' };
    }
  }

  // 모델을 미리 메모리에 올려 둔다. 첫 질문의 로딩 대기를 줄이려는 것이라 실패해도 무시한다.
  function warm() {
    if (!enabled || warming) return;
    warming=fetchImpl(`${host}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [], keep_alive: '30m' }), signal: AbortSignal.timeout(120000) })
      .then(r => r.body?.cancel()).catch(() => {}).finally(()=>{warming=null;});
  }

  // 자리가 없으면 바로(동기로) 던져서 응답 머리를 보내기 전에 429로 돌려준다.
  function slot(signal) {
    if (running < TUTOR_LIMITS.concurrent) { running++; return Promise.resolve(); }
    if (queue.length >= TUTOR_LIMITS.waiting) throw (Object.assign(Error('튜터에게 질문이 몰렸어요. 잠시 후 다시 물어봐 주세요.'), { status: 429, code: 'TUTOR_BUSY' }));
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      queue.push(entry);
      signal.addEventListener('abort', () => { const i = queue.indexOf(entry); if (i >= 0) { queue.splice(i, 1); reject(Object.assign(Error('cancelled'), { code: 'ABORT' })); } }, { once: true });
    });
  }
  function release() { const next = queue.shift(); if (next) next.resolve(); else running--; }

  // onEvent로 {wait}, {text}, {done} 을 차례로 보낸다. 실패하면 status·code가 붙은 오류를 던진다.
  async function ask({ profileId, question, history, study, signal, onEvent }) {
    if (!enabled) throw Object.assign(Error('방장이 AI 튜터를 꺼 두었어요.'), { status: 503, code: 'TUTOR_OFF' });
    question = clean(question, TUTOR_LIMITS.question);
    if (question.length < 2) throw Object.assign(Error('질문을 2자 이상 입력해 주세요.'), { status: 400 });
    const at = now();
    if (at - (lastAsk.get(profileId) ?? -Infinity) < TUTOR_LIMITS.gapMs) throw Object.assign(Error('잠깐 기다렸다 다시 물어봐 주세요.'), { status: 429, code: 'TUTOR_COOLDOWN' });
    lastAsk.set(profileId, at);
    if (lastAsk.size > 512) lastAsk.delete(lastAsk.keys().next().value);
    const blocked = guardrail(question);
    if (blocked) { onEvent({ text: blocked === 'crisis' ? CRISIS_REPLY : HARMFUL_REPLY }); onEvent({ done: true, guard: blocked }); return; }
    if (!left(profileId)) throw Object.assign(Error(`오늘 질문 ${TUTOR_LIMITS.daily}개를 모두 썼어요. 내일 다시 물어봐 주세요.`), { status: 429, code: 'TUTOR_DAILY' });
    const waiting = slot(signal);
    // 질문 수는 줄에 선 순간 센다. 튜터가 답을 못 만들면(Ollama 꺼짐 등) 돌려준다.
    daily.set(profileId, { day: today(), count: used(profileId) + 1 });
    if (daily.size > 2048) daily.delete(daily.keys().next().value);
    const refund = () => { const d = daily.get(profileId); if (d?.day === today() && d.count > 0) d.count--; };
    if (queue.length) onEvent({ wait: queue.length });
    await waiting;
    let answered = false, shown = 0, full = '';
    try {
      let res;
      if(!configuredModel && !checkedModel)await status(profileId);
      try {
        res = await fetchImpl(`${host}/api/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ model, stream: true, keep_alive: '30m', messages: tutorMessages({ question, history, study }), options: { temperature: 0.4, num_ctx: 4096, num_predict: 900 } }),
        });
      } catch (error) {
        if (signal.aborted) throw Object.assign(Error('cancelled'), { code: 'ABORT' });
        throw Object.assign(Error('방장 노트북에서 Ollama가 켜져 있지 않아요.'), { status: 503, code: 'TUTOR_OFFLINE' });
      }
      if (res.ok) onEvent({ left: left(profileId) });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw Object.assign(Error(/not found/i.test(detail) ? `방장 노트북에 ${model} 모델이 없어요.` : '튜터가 답을 만들지 못했어요. 다시 물어봐 주세요.'), { status: 503, code: 'TUTOR_FAILED' });
      }
      const decoder = new TextDecoder(), guarded = asksForSolution(question);
      let buffered = '';
      // 과제 대행 질문이면 ``` 가 나오기 직전까지만 보낸다. 조각 경계에 걸친 ` 는 다음 조각까지 잠시 붙잡아 둔다.
      const emit = piece => {
        if (!guarded) return onEvent({ text: piece });
        full += piece;
        const fence = full.indexOf('```'), end = fence >= 0 ? fence : full.length - (/`{1,2}$/.exec(full)?.[0].length ?? 0);
        if (end > shown) { onEvent({ text: full.slice(shown, end) }); shown = end; }
        return fence >= 0;
      };
      for await (const chunk of res.body) {
        buffered += decoder.decode(chunk, { stream: true });
        let split;
        while ((split = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, split).trim(); buffered = buffered.slice(split + 1);
          if (!line) continue;
          let data; try { data = JSON.parse(line); } catch { continue; }
          if (data.error) throw Object.assign(Error('튜터가 답을 만들지 못했어요. 다시 물어봐 주세요.'), { status: 503, code: 'TUTOR_FAILED' });
          if (data.message?.content) answered = true;
          if (data.message?.content && emit(data.message.content)) { onEvent({ text: SOLUTION_CUT }); onEvent({ done: true, guarded: true }); return; }
          if (data.done) { onEvent({ done: true, ...(data.done_reason === 'length' ? { cut: true } : {}) }); return; }
        }
      }
      onEvent({ done: true });
    } catch (error) {
      if (!shown && !full && !answered) refund();
      throw error;
    } finally { release(); }
  }

  return { get model(){return model;}, status, warm, ask };
}
