(() => {
  const G = window.GrandQuiz, BANK = window.GRAND_QUIZ_QUESTIONS || [];
  let room = G.cleanRoom(G.qs('room','QUIZ'));
  let transport = null, timer = null, selectedQuestions = [], currentQuestion = null;
  const players = new Map(), answers = new Map();
  let state = { phase:'lobby', mode:'individual', questionIndex:-1, totalQuestions:0, question:null, answerCount:0, durationMs:20000, deadline:null, buzzedPlayer:null, ranking:[], lastResults:{}, updatedAt:Date.now() };

  const roomInput=document.getElementById('roomInput'), connection=document.getElementById('connection'), hostStage=document.getElementById('hostStage');
  roomInput.value=room; G.setRoomInUrl(room);
  const categories=[...new Set(BANK.map(q=>q.category))].sort();
  document.getElementById('categories').innerHTML=categories.map((c,i)=>`<label class="check"><input type="checkbox" value="${G.escapeHtml(c)}" ${i<10?'checked':''}> <span>${G.escapeHtml(c)}</span></label>`).join('');

  function connect(){
    transport?.close();
    transport=G.createTransport({room,role:'host',onMessage:handleMessage,onStatus:({ready,mode})=>{
      connection.textContent=ready?(mode==='online'?'🟢 En ligne':'🟡 Démo locale'):'Connexion…';
      connection.className=`badge ${ready?'ok':'warn'}`;
      if(ready) broadcastState();
    }});
    updateLinks();
  }

  function updateLinks(){
    document.getElementById('screenLink').href=new URL(`index.html?room=${room}`,location.href).href;
    document.getElementById('playerLink').href=G.makePlayUrl(room);
  }

  roomInput.addEventListener('change',()=>{
    room=G.cleanRoom(roomInput.value);roomInput.value=room;G.setRoomInUrl(room);
    players.clear();answers.clear();state.phase='lobby';connect();render();
  });

  function upsertPlayer(payload){
    if(!payload?.playerId)return null;
    const existing=players.get(payload.playerId);
    const player={
      id:payload.playerId,
      name:String(payload.name||existing?.name||'Joueur').slice(0,24),
      team:payload.team==='Bleue'?'Bleue':(existing?.team||'Orange'),
      score:existing?.score||0
    };
    players.set(player.id,player);
    return player;
  }

  function publicPlayers(){ return [...players.values()].map(({id,name,team,score})=>({id,name,team,score})); }

  function ranking(){
    if(state.mode==='teams'){
      const totals={Orange:0,Bleue:0};
      for(const p of players.values()) totals[p.team==='Bleue'?'Bleue':'Orange']+=(p.score||0);
      return Object.entries(totals).map(([name,score])=>({name:`Équipe ${name}`,score})).sort((a,b)=>b.score-a.score);
    }
    return [...players.values()].map(p=>({id:p.id,name:p.name,score:p.score||0})).sort((a,b)=>b.score-a.score);
  }

  function sanitizeQuestion(q){
    if(!q)return null;
    const base={id:q.id,category:q.category,difficulty:q.difficulty,type:q.type,question:q.question,explanation:q.explanation||''};
    if(q.type==='mcq')base.options=q.options;
    if(q.type==='truefalse')base.options=['Vrai','Faux'];
    if(q.type==='numeric')base.unit=q.unit||'';
    return base;
  }

  function snapshot(){
    return {
      ...state,
      room,
      players:publicPlayers(),
      ranking:ranking(),
      answeredPlayerIds:[...answers.keys()],
      updatedAt:Date.now()
    };
  }

  function broadcastState(){
    state.updatedAt=Date.now();
    transport?.send('state',snapshot());
    renderMetrics();
  }

  function standardAnswerResult(q,answer){
    let correct=false;
    if(q.type==='mcq')correct=Number(answer.value)===Number(q.answer);
    if(q.type==='truefalse')correct=String(answer.value)===String(q.answer);
    let points=0;
    if(correct){
      points=1000;
      if(state.speedBonus) points+=Math.max(0,Math.round(500*(1-Math.min(1,answer.elapsed/state.durationMs))));
    }
    return {correct,points};
  }

  function handleMessage(msg){
    const p=msg.payload||{};
    if(msg.type==='state_request'){ broadcastState(); return; }

    if(msg.type==='join'){
      upsertPlayer(p);
      broadcastState();render();return;
    }

    if(msg.type==='answer' && state.phase==='question' && currentQuestion && currentQuestion.type!=='buzzer'){
      if(!p.playerId || p.questionId!==currentQuestion.id){
        transport?.send('answer_ack',{playerId:p.playerId,questionId:p.questionId,accepted:false});
        return;
      }
      const player=upsertPlayer(p);
      if(!player || answers.has(p.playerId)){
        transport?.send('answer_ack',{playerId:p.playerId,questionId:p.questionId,accepted:true});
        return;
      }

      const answer={value:p.value,answeredAt:Date.now(),elapsed:Math.max(0,Date.now()-(state.startedAt||Date.now()))};
      if(currentQuestion.type==='mcq' || currentQuestion.type==='truefalse'){
        const result=standardAnswerResult(currentQuestion,answer);
        answer.correct=result.correct;
        answer.points=result.points;
        player.score=(player.score||0)+result.points;
      }
      answers.set(p.playerId,answer);
      state.answerCount=answers.size;
      transport?.send('answer_ack',{playerId:p.playerId,questionId:p.questionId,accepted:true});
      broadcastState();render();return;
    }

    if(msg.type==='buzz' && state.phase==='question' && currentQuestion?.type==='buzzer' && !state.buzzedPlayerId){
      const player=upsertPlayer(p);
      if(!player)return;
      state.buzzedPlayerId=player.id;state.buzzedPlayer=player.name;
      broadcastState();render();
    }
  }

  function selectedCategories(){ return [...document.querySelectorAll('#categories input:checked')].map(x=>x.value); }

  function startGame(){
    const cats=selectedCategories();
    if(!cats.length){alert('Sélectionne au moins une catégorie.');return;}
    const count=Number(document.getElementById('countSelect').value)||15;
    state.mode=document.getElementById('modeSelect').value;
    state.durationMs=Number(document.getElementById('durationSelect').value)||20000;
    state.speedBonus=document.getElementById('speedSelect').value==='on';
    const pool=BANK.filter(q=>cats.includes(q.category));
    selectedQuestions=G.shuffle(pool).slice(0,Math.min(count,pool.length));
    if(!selectedQuestions.length)return;
    for(const p of players.values())p.score=0;
    state.totalQuestions=selectedQuestions.length;state.questionIndex=-1;state.lastResults={};state.ranking=[];
    nextQuestion();
  }

  function nextQuestion(){
    clearTimeout(timer);answers.clear();state.answerCount=0;state.buzzedPlayer=null;state.buzzedPlayerId=null;state.lastResults={};
    state.questionIndex+=1;
    if(state.questionIndex>=selectedQuestions.length){finishGame();return;}
    currentQuestion=selectedQuestions[state.questionIndex];
    state.phase='question';state.question=sanitizeQuestion(currentQuestion);state.questionNumber=state.questionIndex+1;
    state.startedAt=Date.now();state.deadline=currentQuestion.type==='buzzer'?null:Date.now()+state.durationMs;
    broadcastState();render();
    if(currentQuestion.type!=='buzzer')timer=setTimeout(revealCurrent,state.durationMs+250);
  }

  function scoreNumeric(q){
    const entries=[...answers.entries()]
      .map(([id,a])=>({id,value:Number(a.value),distance:Math.abs(Number(a.value)-Number(q.answer))}))
      .filter(x=>Number.isFinite(x.value))
      .sort((a,b)=>a.distance-b.distance);
    const awards=[1000,700,400];const results={};
    entries.forEach((e,i)=>{
      const points=awards[i]||0;
      const pl=players.get(e.id);
      if(pl)pl.score=(pl.score||0)+points;
      results[e.id]={correct:e.distance===0,points,distance:e.distance};
    });
    for(const id of players.keys())if(!results[id])results[id]={correct:false,points:0};
    return results;
  }

  function revealCurrent(){
    if(state.phase!=='question'||!currentQuestion)return;
    clearTimeout(timer);
    if(currentQuestion.type==='buzzer'){if(!state.buzzedPlayerId)return;return;}

    if(currentQuestion.type==='numeric'){
      state.lastResults=scoreNumeric(currentQuestion);
    }else{
      const results={};
      for(const [id,a] of answers) results[id]={correct:Boolean(a.correct),points:Number(a.points)||0};
      for(const id of players.keys())if(!results[id])results[id]={correct:false,points:0};
      state.lastResults=results;
    }

    state.phase='reveal';state.deadline=null;state.celebrate=Object.values(state.lastResults).some(r=>r.points>0);
    if(currentQuestion.type==='mcq'){
      state.correctIndex=currentQuestion.answer;state.correctLabel=currentQuestion.options[currentQuestion.answer];
    }else if(currentQuestion.type==='truefalse'){
      state.correctIndex=currentQuestion.answer?0:1;state.correctLabel=currentQuestion.answer?'Vrai':'Faux';
    }else{
      state.correctLabel=`${currentQuestion.answer}${currentQuestion.unit?' '+currentQuestion.unit:''}`;
    }
    broadcastState();render();
  }

  function resolveBuzz(correct){
    if(!currentQuestion||currentQuestion.type!=='buzzer'||!state.buzzedPlayerId)return;
    const id=state.buzzedPlayerId,pl=players.get(id);
    if(correct){
      if(pl)pl.score=(pl.score||0)+1000;
      state.lastResults={[id]:{correct:true,points:1000}};state.phase='reveal';state.correctLabel=currentQuestion.answerText;state.celebrate=true;
      broadcastState();render();
    }else{
      state.lastResults={[id]:{correct:false,points:0}};state.buzzedPlayer=null;state.buzzedPlayerId=null;
      broadcastState();render();
    }
  }

  function showLeaderboard(){state.phase='leaderboard';state.ranking=ranking();broadcastState();render();}
  function finishGame(){clearTimeout(timer);currentQuestion=null;state.phase='finished';state.ranking=ranking();state.question=null;broadcastState();render();}

  function resetGame(){
    clearTimeout(timer);selectedQuestions=[];currentQuestion=null;answers.clear();
    for(const p of players.values())p.score=0;
    state={...state,phase:'lobby',questionIndex:-1,totalQuestions:0,question:null,answerCount:0,deadline:null,buzzedPlayer:null,buzzedPlayerId:null,lastResults:{}};
    broadcastState();render();
  }

  function renderMetrics(){
    document.getElementById('metricPlayers').textContent=players.size;
    document.getElementById('metricAnswers').textContent=state.answerCount||0;
    document.getElementById('metricQuestion').textContent=state.totalQuestions?`${Math.max(0,state.questionIndex+1)}/${state.totalQuestions}`:'—';
  }

  function renderPlayers(){
    document.getElementById('playersPanel').innerHTML=players.size
      ?[...players.values()].sort((a,b)=>(b.score||0)-(a.score||0)).map(p=>`<div class="player-chip"><strong>${G.escapeHtml(p.name)}</strong><span>${state.mode==='teams'?`Équipe ${G.escapeHtml(p.team)} · `:''}${p.score||0} pts</span></div>`).join('')
      :'<div class="muted">Aucun joueur pour le moment.</div>';
  }

  function render(){
    renderMetrics();renderPlayers();
    if(state.phase==='lobby'){
      hostStage.innerHTML='<div class="muted">La partie est en attente. Les joueurs peuvent déjà rejoindre la salle.</div>';
      return;
    }

    if(state.phase==='question'){
      let special='';
      if(currentQuestion.type==='buzzer'){
        special=state.buzzedPlayer
          ?`<div class="feedback"><strong>🚨 ${G.escapeHtml(state.buzzedPlayer)} a buzzé</strong><div class="actions" style="justify-content:center;margin-top:12px"><button id="buzzGood" class="btn green">✅ Bonne réponse</button><button id="buzzBad" class="btn danger">❌ Mauvaise réponse · Rouvrir</button></div></div>`
          :'<div class="muted">En attente du premier buzz…</div>';
      }
      hostStage.innerHTML=`<span class="badge">Question ${state.questionNumber}/${state.totalQuestions}</span><div class="host-question">${G.escapeHtml(currentQuestion.question)}</div><div class="muted">${G.escapeHtml(currentQuestion.category)} · ${G.escapeHtml(currentQuestion.difficulty)} · ${G.escapeHtml(currentQuestion.type)}</div>${special}<div class="answer-log" style="margin-top:14px">${[...answers.entries()].map(([id,a])=>`<div class="answer-log-row"><span>${G.escapeHtml(players.get(id)?.name||'Joueur')}</span><strong>Réponse reçue${a.points!==undefined?` · ${a.points} pts`:''}</strong></div>`).join('')}</div><div class="actions" style="margin-top:16px">${currentQuestion.type!=='buzzer'?'<button id="revealBtn" class="btn primary">👁️ Afficher la réponse</button>':''}<button id="rankBtn" class="btn">🏆 Classement</button></div>`;
      document.getElementById('revealBtn')?.addEventListener('click',revealCurrent);
      document.getElementById('rankBtn')?.addEventListener('click',showLeaderboard);
      document.getElementById('buzzGood')?.addEventListener('click',()=>resolveBuzz(true));
      document.getElementById('buzzBad')?.addEventListener('click',()=>resolveBuzz(false));
      return;
    }

    if(state.phase==='reveal'){
      hostStage.innerHTML=`<span class="badge">Réponse</span><div class="host-question">✅ ${G.escapeHtml(state.correctLabel||'')}</div><div class="muted">${G.escapeHtml(currentQuestion?.explanation||'')}</div><div class="actions" style="margin-top:16px"><button id="nextBtn" class="btn green">Question suivante ➜</button><button id="rankBtn" class="btn">🏆 Afficher le classement</button></div>`;
    }else if(state.phase==='leaderboard'){
      hostStage.innerHTML='<div class="host-question">🏆 Classement affiché sur la TV</div><div class="actions"><button id="nextBtn" class="btn green">Continuer ➜</button></div>';
    }else if(state.phase==='finished'){
      hostStage.innerHTML='<div class="host-question">🏆 Partie terminée</div><div class="actions"><button id="resetInline" class="btn primary">Nouvelle partie</button></div>';
    }

    document.getElementById('nextBtn')?.addEventListener('click',nextQuestion);
    document.getElementById('rankBtn')?.addEventListener('click',showLeaderboard);
    document.getElementById('resetInline')?.addEventListener('click',resetGame);
  }

  document.getElementById('modeSelect').addEventListener('change',()=>{state.mode=document.getElementById('modeSelect').value;broadcastState();render();});
  document.getElementById('startBtn').addEventListener('click',startGame);
  document.getElementById('resetBtn').addEventListener('click',resetGame);
  connect();render();
})();
