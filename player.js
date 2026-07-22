(() => {
  const G=window.GrandQuiz,room=G.cleanRoom(G.qs('room','QUIZ')),app=document.getElementById('app'),connection=document.getElementById('connection');
  document.getElementById('roomLabel').textContent=room;
  const storageKey=`grandquiz:${room}`;
  let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}')}catch{}
  let playerId=saved.playerId||G.uid(),name=saved.name||'',team=saved.team||'Orange',joined=false,currentState=null,answeredQuestionId=null,pendingQuestionId=null;
  let transport=null;

  transport=G.createTransport({
    room,
    role:'player',
    onMessage:handleMessage,
    onStatus:({ready,mode})=>{
      connection.textContent=ready?(mode==='online'?'🟢 Connecté':'🟡 Démo locale'):'Connexion…';
      connection.className=`badge ${ready?'ok':'warn'}`;
      if(ready){
        setTimeout(()=>{
          transport?.send('state_request',{from:'player',playerId});
          if(name)join();
        },0);
      }
    }
  });

  function persist(){localStorage.setItem(storageKey,JSON.stringify({playerId,name,team}));}

  function join(){
    if(!name)return;
    joined=true;persist();
    transport.send('join',{playerId,name,team});
    render();
  }

  function handleMessage(msg){
    if(msg.type==='state'){
      currentState=msg.payload;
      if(currentState.mode!=='teams')team='Orange';
      if(currentState.question?.id && currentState.answeredPlayerIds?.includes(playerId)) answeredQuestionId=currentState.question.id;
      render();
      return;
    }
    if(msg.type==='answer_ack'){
      const p=msg.payload||{};
      if(p.playerId!==playerId)return;
      if(p.accepted){answeredQuestionId=p.questionId;pendingQuestionId=null;}
      else if(p.questionId===pendingQuestionId){pendingQuestionId=null;}
      render();
    }
  }

  function myPlayer(){return currentState?.players?.find(p=>p.id===playerId)}

  function render(){
    if(!name||!joined){renderJoin();return;}
    if(!currentState||currentState.phase==='lobby'||currentState.phase==='setup'){
      const teamSwitch=currentState?.mode==='teams'
        ?`<div style="margin-top:14px"><strong>Ton équipe</strong><div class="team-choice" style="margin-top:8px"><button id="waitTeamOrange" class="team-btn orange ${team==='Orange'?'selected':''}">🟠 Orange</button><button id="waitTeamBlue" class="team-btn blue ${team==='Bleue'?'selected':''}">🔵 Bleue</button></div></div>`:'';
      app.innerHTML=`<div class="join-title">✅ Tu es dans la partie !</div><div class="join-sub">${G.escapeHtml(name)} · regarde l’écran principal</div><div class="feedback">Joueurs connectés : <strong>${currentState?.players?.length||0}</strong></div>${teamSwitch}`;
      document.getElementById('waitTeamOrange')?.addEventListener('click',()=>changeTeam('Orange'));
      document.getElementById('waitTeamBlue')?.addEventListener('click',()=>changeTeam('Bleue'));
      return;
    }
    if(currentState.phase==='question')renderQuestion();
    else if(currentState.phase==='reveal')renderReveal();
    else if(currentState.phase==='leaderboard')renderRanking(false);
    else if(currentState.phase==='finished')renderRanking(true);
  }

  function changeTeam(nextTeam){team=nextTeam;persist();transport.send('join',{playerId,name,team});render();}

  function renderJoin(){
    const teams=currentState?.mode==='teams';
    app.innerHTML=`<div class="join-title">Rejoins la partie</div><div class="join-sub">Choisis ton pseudo${teams?' et ton équipe':''}</div><div class="field"><label for="nameInput">Pseudo</label><input id="nameInput" maxlength="24" value="${G.escapeHtml(name)}" placeholder="Ex : Magali"></div>${teams?`<div style="margin-top:14px"><strong>Équipe</strong><div class="team-choice" style="margin-top:8px"><button id="teamOrange" class="team-btn orange ${team==='Orange'?'selected':''}">🟠 Orange</button><button id="teamBlue" class="team-btn blue ${team==='Bleue'?'selected':''}">🔵 Bleue</button></div></div>`:''}<button id="joinBtn" class="btn primary big" style="width:100%;margin-top:16px">JOUER 🚀</button>`;
    document.getElementById('teamOrange')?.addEventListener('click',()=>{team='Orange';renderJoin()});
    document.getElementById('teamBlue')?.addEventListener('click',()=>{team='Bleue';renderJoin()});
    document.getElementById('joinBtn').addEventListener('click',()=>{
      name=document.getElementById('nameInput').value.trim().slice(0,24);
      if(!name)return;
      join();
    });
  }

  function alreadyAnswered(){
    const questionId=currentState?.question?.id;
    return Boolean(questionId && (answeredQuestionId===questionId || currentState?.answeredPlayerIds?.includes(playerId)));
  }

  async function sendAnswer(value){
    const questionId=currentState?.question?.id;
    if(!questionId||alreadyAnswered()||pendingQuestionId===questionId)return;
    pendingQuestionId=questionId;
    renderQuestion();
    const result=await transport.send('answer',{playerId,name,team,questionId,value});
    if(result===false && pendingQuestionId===questionId){pendingQuestionId=null;renderQuestion();}
  }

  function renderQuestion(){
    const q=currentState.question;if(!q)return;
    const locked=alreadyAnswered();
    const pending=pendingQuestionId===q.id;
    let controls='';
    if(q.type==='mcq'||q.type==='truefalse'){
      controls=`<div class="mobile-options">${q.options.map((opt,i)=>`<button class="mobile-option ${locked||pending?'locked':''}" data-value="${q.type==='truefalse'?(i===0?'true':'false'):i}" ${locked||pending?'disabled':''}>${String.fromCharCode(65+i)} · ${G.escapeHtml(opt)}</button>`).join('')}</div>`;
    }else if(q.type==='numeric'){
      controls=`<div class="numeric-row"><input id="numericInput" inputmode="decimal" type="number" placeholder="Ta réponse" ${locked||pending?'disabled':''}><button id="numericBtn" class="btn green" ${locked||pending?'disabled':''}>Envoyer</button></div>`;
    }else{
      controls=`<button id="buzzBtn" class="big-buzzer" ${currentState.buzzedPlayerId?'disabled':''}>BUZZ !</button><div class="feedback">${currentState.buzzedPlayer?`🚨 ${G.escapeHtml(currentState.buzzedPlayer)} a été le plus rapide !`:'Appuie dès que tu connais la réponse.'}</div>`;
    }

    app.innerHTML=`<div style="display:flex;justify-content:space-between;gap:8px"><span class="badge">Question ${currentState.questionNumber}/${currentState.totalQuestions}</span><span class="badge">${G.escapeHtml(q.category)}</span></div><div class="mobile-question">${G.escapeHtml(q.question)}</div>${controls}${pending?'<div class="feedback">⏳ Envoi de la réponse…</div>':''}${locked?'<div class="feedback">✅ Réponse enregistrée. Regarde l’écran !</div>':''}`;
    document.querySelectorAll('.mobile-option').forEach(btn=>btn.addEventListener('click',()=>sendAnswer(btn.dataset.value)));
    document.getElementById('numericBtn')?.addEventListener('click',()=>{const v=document.getElementById('numericInput').value;if(v!=='')sendAnswer(v)});
    document.getElementById('numericInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'){const v=e.currentTarget.value;if(v!=='')sendAnswer(v)}});
    document.getElementById('buzzBtn')?.addEventListener('click',()=>transport.send('buzz',{playerId,name,team,questionId:q.id}));
  }

  function renderReveal(){
    const result=currentState.lastResults?.[playerId]||{points:0,correct:false};
    const score=myPlayer()?.score||0;
    if(result.points>0)G.confetti(35);
    app.innerHTML=`<div class="join-title">${result.points>0?'🎉 Bien joué !':'📺 Réponse'}</div><div class="feedback"><div>${G.escapeHtml(currentState.correctLabel||'')}</div><div class="points">+${result.points||0} pts</div><div class="muted">Score total : ${score} pts</div></div><div class="join-sub" style="margin-top:14px">${G.escapeHtml(currentState.question?.explanation||'')}</div>`;
  }

  function renderRanking(final){
    const ranking=currentState.ranking||[];
    let pos=-1;
    if(currentState.mode==='individual')pos=ranking.findIndex(p=>p.id===playerId);
    const score=myPlayer()?.score||0;
    app.innerHTML=`<div class="join-title">${final?'🏆 Partie terminée':'🏆 Classement'}</div><div class="feedback">${currentState.mode==='individual'&&pos>=0?`Tu es <strong>${pos+1}${pos===0?'er':'e'}</strong> avec <div class="points">${score} pts</div>`:'Regarde le classement sur l’écran principal.'}</div>`;
  }

  render();
})();
