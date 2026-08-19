(() => {
  const G = window.GrandQuiz;
  if (!G || typeof G.createTransport !== 'function') return;

  let latestState = null;
  let patchQueued = false;

  function teamDisplayName(team) {
    const generated = latestState?.teamNames?.[team];
    return generated || `Équipe ${team}`;
  }

  function individualRanking() {
    const players = Array.isArray(latestState?.players) ? latestState.players : [];
    return [...players]
      .map((player) => ({
        id: player.id,
        name: player.name || 'Joueur',
        score: Number(player.score) || 0,
        team: player.team || 'Orange',
      }))
      .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name), 'fr'));
  }

  function scoreGroups(players) {
    const groups = [];
    for (const player of players) {
      let group = groups[groups.length - 1];
      if (!group || group.score !== player.score) {
        group = { rank: groups.length + 1, score: player.score, players: [] };
        groups.push(group);
      }
      group.players.push(player);
    }
    return groups;
  }

  function rankedPlayers(players) {
    return scoreGroups(players).flatMap((group) => group.players.map((player) => ({
      ...player,
      denseRank: group.rank,
      tied: group.players.length > 1,
    })));
  }

  function schedulePatch() {
    if (patchQueued) return;
    patchQueued = true;
    requestAnimationFrame(() => {
      patchQueued = false;
      patchFinalRanking();
    });
  }

  function patchFinalRanking() {
    if (latestState?.phase !== 'finished') return;
    const stage = document.getElementById('stage');
    const card = stage?.querySelector('.ranking-card');
    if (!card || card.querySelector('.final-complete-ranking')) return;

    const rawPlayers = individualRanking();
    const groups = scoreGroups(rawPlayers);
    const players = rankedPlayers(rawPlayers);
    const medals = ['🥇', '🥈', '🥉'];
    const lastGroup = groups.length >= 2 ? groups[groups.length - 1] : null;
    const penultimateGroup = groups.length >= 4 ? groups[groups.length - 2] : null;
    const title = latestState.mode === 'teams' ? 'Scores individuels' : 'Tous les scores';

    const rows = players.length
      ? players.map((player) => {
          const topClass = player.denseRank <= 3 ? ` top-${player.denseRank}` : '';
          const isLantern = Boolean(lastGroup && player.score === lastGroup.score && player.denseRank > 3);
          const isChocolate = Boolean(penultimateGroup && player.score === penultimateGroup.score && player.denseRank > 3);
          const specialClass = isLantern ? ' special-lantern' : isChocolate ? ' special-chocolate' : '';
          const special = isLantern
            ? '<span class="final-special-award">🏮 Lanterne rouge</span>'
            : isChocolate
              ? '<span class="final-special-award">🍫 Médaille en chocolat</span>'
              : '';
          const tie = player.tied ? '<span class="final-tie-label">ex æquo</span>' : '';
          const team = latestState.mode === 'teams'
            ? `<span class="final-player-team">${G.escapeHtml(teamDisplayName(player.team))}</span>`
            : '';
          return `<div class="final-score-row${topClass}${specialClass}"><div class="final-rank-position">${medals[player.denseRank - 1] || player.denseRank}</div><div class="final-rank-player"><strong>${G.escapeHtml(player.name)} ${tie}</strong>${team}${special}</div><div class="final-rank-points">${player.score} pts</div></div>`;
        }).join('')
      : '<div class="muted">Aucun participant classé.</div>';

    const section = document.createElement('section');
    section.className = 'final-complete-ranking';
    section.innerHTML = `<h3>${title}</h3><div class="final-score-list">${rows}</div>`;
    card.classList.add('final-complete-card');
    card.appendChild(section);
  }

  const style = document.createElement('style');
  style.textContent = `
    .ranking-card.final-complete-card{justify-content:flex-start;overflow:hidden;padding-top:12px}
    .ranking-card.final-complete-card .question-text{margin:4px auto 6px}
    .ranking-card.final-complete-card .podium{margin:4px auto 8px;min-height:0}
    .podium-tie-label{margin:3px 0 1px;font-size:.72rem;font-weight:1000;letter-spacing:.08em;text-transform:uppercase;color:var(--cyan)}
    .final-complete-ranking{width:min(1100px,100%);min-height:0;margin:2px auto 0;display:flex;flex-direction:column;overflow:hidden}
    .final-complete-ranking h3{margin:0 0 7px;text-align:center;font-size:clamp(1rem,2.2vh,1.45rem);text-transform:uppercase;letter-spacing:.08em;color:var(--cyan)}
    .final-score-list{min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 10px;padding:2px 5px 6px}
    .final-score-row{min-width:0;display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px 11px;border-radius:13px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.08)}
    .final-score-row.top-1,.final-score-row.top-2,.final-score-row.top-3{font-size:1.06em;font-weight:900;border-width:2px}
    .final-score-row.top-1{background:rgba(255,200,61,.15);border-color:rgba(255,200,61,.6)}
    .final-score-row.top-2{background:rgba(210,220,235,.12);border-color:rgba(210,220,235,.45)}
    .final-score-row.top-3{background:rgba(205,132,78,.13);border-color:rgba(205,132,78,.48)}
    .final-score-row.special-chocolate{border-color:rgba(190,120,65,.62)}
    .final-score-row.special-lantern{border-color:rgba(255,92,92,.68)}
    .final-rank-position{font-size:1.3rem;font-weight:1000;text-align:center}
    .final-rank-player{min-width:0;display:flex;flex-direction:column;line-height:1.05}
    .final-rank-player strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .final-player-team{margin-top:3px;color:var(--muted);font-size:.72rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .final-tie-label{font-size:.68em;color:var(--cyan);font-weight:900}
    .final-special-award{margin-top:4px;font-size:.76rem;font-weight:900;letter-spacing:.02em}
    .final-rank-points{font-weight:1000;white-space:nowrap;color:var(--yellow)}
    @media(max-width:760px){.final-score-list{grid-template-columns:1fr}}
    @media(max-height:760px){.ranking-card.final-complete-card .podium{transform:scale(.9);transform-origin:center top;margin-bottom:-12px}.final-score-row{padding:6px 9px}.final-complete-ranking h3{margin-bottom:4px}}
  `;
  document.head.appendChild(style);

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithCompleteRanking(options = {}) {
    const originalOnMessage = options.onMessage;
    return originalCreateTransport({
      ...options,
      onMessage(message) {
        if (options.role === 'screen' && message?.type === 'state') latestState = message.payload || null;
        originalOnMessage?.(message);
        if (options.role === 'screen' && message?.type === 'state') schedulePatch();
      },
    });
  };

  const observer = new MutationObserver(schedulePatch);
  const start = () => observer.observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
