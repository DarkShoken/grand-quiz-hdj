const QUESTIONS=[
{t:"Travail",q:"Un collègue vous coupe la parole en réunion et reprend votre idée comme si c’était la sienne.",r:"Que pouvez-vous dire ou faire, sur le moment ou après ?",o:["Lui dire calmement : « c’est l’idée que je venais de développer »","Rester silencieux et ne plus rien proposer","En reparler au responsable en dehors de la réunion"],s:"La prochaine fois, je pourrais dire :"},
{t:"Travail",q:"On vous demande de faire une tâche en plus, alors que votre planning est déjà plein.",r:"Comment refuser sans passer pour quelqu’un de négatif ?",o:["« Je peux prendre celle-ci, mais il faudra décaler autre chose »","Accepter sans rien dire","Refuser sèchement"],s:"La prochaine fois, je pourrais dire :"},
{t:"Travail",q:"Un collègue vous critique devant les autres.",r:"Quelle réaction aide à garder la tête froide ?",o:["Répondre calmement en privé plus tard","Montrer tout de suite que ça vous touche","Ignorer complètement et changer de sujet"],s:"La prochaine fois, je pourrais dire :"},
{t:"Famille",q:"Un membre de votre famille insiste pour que vous veniez à un repas alors que vous n’en avez pas envie.",r:"Comment dire non sans culpabiliser ni vous isoler ?",o:["« Cette fois je ne pourrai pas, mais merci d’avoir pensé à moi »","Dire oui pour avoir la paix","Ne plus répondre aux messages"],s:"La prochaine fois, je pourrais dire :"},
{t:"Famille",q:"On vous demande de l’argent que vous ne pouvez pas prêter.",r:"Quelle phrase permet de refuser clairement ?",o:["« Je ne peux pas prêter d’argent, désolé »","Prêter une partie en espérant ne pas être remboursé","Éviter la personne"],s:"La prochaine fois, je pourrais dire :"},
{t:"Famille",q:"Un proche vous répète des conseils que vous connaissez déjà.",r:"Comment lui faire comprendre sans le blesser ?",o:["« Merci, je connais déjà ce conseil »","Lui couper la parole","Éviter de parler de ce sujet"],s:"La prochaine fois, je pourrais dire :"},
{t:"Soins",q:"En consultation, vous n’avez pas compris ce que le médecin vient d’expliquer.",r:"Que pouvez-vous demander pour être sûr d’avoir compris ?",o:["« Pouvez-vous me le réexpliquer avec d’autres mots ? »","Faire semblant d’avoir compris","Chercher sur Internet en rentrant"],s:"La prochaine fois, je pourrais dire :"},
{t:"Soins",q:"Vous avez un effet indésirable avec un traitement et vous hésitez à le signaler.",r:"Pourquoi et comment en parler à l’équipe soignante ?",o:["En parler dès le prochain rendez-vous, même brièvement","Arrêter le traitement seul","Attendre que ça passe tout seul"],s:"La prochaine fois, je pourrais dire :"},
{t:"Soins",q:"On vous propose un rendez-vous à une heure qui ne vous convient pas.",r:"Comment demander un autre horaire ?",o:["« Est-ce qu’un autre créneau serait possible ? »","Prendre le rendez-vous quand même","Ne pas y aller sans prévenir"],s:"La prochaine fois, je pourrais dire :"},
{t:"Amis",q:"Vos amis organisent une sortie et vous n’avez pas envie d’y aller ce soir-là.",r:"Comment refuser tout en restant proche d’eux ?",o:["« Ce soir ça ne va pas pour moi, on se voit une prochaine fois ? »","Y aller en faisant semblant d’apprécier","Ne plus répondre dans le groupe"],s:"La prochaine fois, je pourrais dire :"},
{t:"Amis",q:"Un ami vous raconte quelque chose de difficile et vous ne savez pas quoi répondre.",r:"Que peut-on dire simplement pour montrer qu’on écoute ?",o:["« Ça a l’air dur, tu veux en parler ? »","Donner tout de suite un conseil","Changer de sujet"],s:"La prochaine fois, je pourrais dire :"},
{t:"Voisinage",q:"Le bruit des voisins vous gêne régulièrement le soir.",r:"Comment aborder le sujet sans créer de conflit ?",o:["Aller les voir calmement un soir et expliquer la gêne","Laisser des mots agressifs","Appeler la police dès la première fois"],s:"La prochaine fois, je pourrais dire :"},
{t:"Administrations",q:"On vous demande un papier que vous ne trouvez pas.",r:"Que faire à l’accueil ?",o:["Demander calmement ce qui est accepté à la place","Repartir sans rien dire","S’énerver devant l’agent"],s:"La prochaine fois, je pourrais dire :"},
{t:"Transports",q:"Quelqu’un s’assoit à votre place réservée dans le train et refuse de bouger.",r:"Quelle réaction reste efficace et sûre ?",o:["Montrer calmement votre billet et demander la place","Forcer physiquement","Laisser tomber mais se sentir mal après"],s:"La prochaine fois, je pourrais dire :"},
{t:"Transports",q:"Vous êtes en retard à un rendez-vous important à cause des transports.",r:"Qui prévenir, et comment s’excuser brièvement ?",o:["Prévenir par message : « J’arrive dans 15 min, désolé »","Arriver sans rien dire","Annuler sans prévenir"],s:"La prochaine fois, je pourrais dire :"}
];
const EMOTIONS=[
{e:"joie",ok:"Joie",o:["Joie","Tristesse","Colère","Peur"]},
{e:"tristesse",ok:"Tristesse",o:["Colère","Tristesse","Surprise","Neutre"]},
{e:"colere",ok:"Colère",o:["Peur","Joie","Colère","Neutre"]},
{e:"peur",ok:"Peur",o:["Peur","Surprise","Joie","Colère"]},
{e:"surprise",ok:"Surprise",o:["Surprise","Neutre","Tristesse","Peur"]},
{e:"neutre",ok:"Neutre",o:["Neutre","Joie","Colère","Tristesse"]},
{e:"joie",ok:"Joie",o:["Tristesse","Peur","Joie","Neutre"]},
{e:"colere",ok:"Colère",o:["Neutre","Colère","Joie","Surprise"]}
];
